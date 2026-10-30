import { assessSafely, type Severity } from '../../services/safetyService.js';
import { cleanForSpeech } from '../../services/ttsClient.js';

// Pure state machine + message protocol for the realtime voice relay. No sockets, no timers, no network: everything it needs comes in
// through RelayDeps, so it is unit-tested with a fake upstream.
//
// HYBRID design (keeps safety and persistence intact): the upstream realtime connection is used ONLY for streaming speech-to-text and for
// streaming text-to-speech of text WE choose. The words the assistant says always come from conversationService (full context, safety,
// persistence), never from the realtime model itself.

/** Client -> server (JSON text frames). */
export type ClientMsg =
  | { type: 'hello'; token: string; sessionId: string }
  | { type: 'audio'; data: string } // base64 PCM16 mono 24 kHz
  | { type: 'interrupt' }
  | { type: 'ping' };

/** Server -> client (JSON text frames). */
export type ServerMsg =
  | { type: 'ready'; sampleRate: 24000; format: 'pcm16' }
  | { type: 'speech_started' }
  | { type: 'partial_transcript'; text: string }
  | { type: 'final_transcript'; text: string }
  | { type: 'assistant_text_delta'; text: string }
  | { type: 'audio'; data: string }
  | { type: 'assistant_done'; crisis: boolean }
  | { type: 'interrupted' }
  | { type: 'error'; code: string; message: string }
  | { type: 'unavailable'; reason: string }
  | { type: 'pong' };

export interface UpstreamPort { send(event: Record<string, unknown>): void; close(): void }

export interface RelayDeps {
  send(m: ServerMsg): void;
  /** Verifies an access token (same rules as middleware/authenticate.ts). */
  authenticate(token: string): Promise<{ userId: string } | null>;
  /** Returns the session if it belongs to the user and is active, else null. */
  openSession(userId: string, sessionId: string): Promise<{ language: string } | null>;
  /** Per-user concurrent connection cap. Return false to refuse. */
  admit?(userId: string): boolean;
  /** Opens the upstream speech connection, or null if it is unavailable / not configured. */
  connectUpstream(session: { language: string }): Promise<UpstreamPort | null>;
  /** Normal turn: full context, safety and persistence live in conversationService. Resolves to the reply text. */
  converse(i: { userId: string; sessionId: string; text: string; signal: AbortSignal; onDelta: (t: string) => void }): Promise<string>;
  /** HIGH / IMMINENT only: returns the fixed, reviewed crisis reply. The model is never called on this path. */
  crisis(i: { userId: string; sessionId: string; text: string; severity: Severity }): Promise<string>;
  /** Content-free structured log. */
  log?(event: string, fields?: Record<string, unknown>): void;
  now?: () => number;
  maxChars?: number;
  /** Max base64 chars in one audio frame. */
  maxAudioFrame?: number;
  /** Max non-audio client frames per second. */
  maxControlPerSec?: number;
  /** Max audio base64 chars per second. */
  maxAudioPerSec?: number;
}

export type RelayState = 'awaiting_auth' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'closed';

const SPEECH_RULES = 'Read the text between the markers aloud EXACTLY as written, word for word, in a calm, warm, gentle voice at an unhurried pace. Do not add, remove, answer or comment on anything. Do not read the markers.';

export function speechInstructions(text: string): string {
  return `${SPEECH_RULES}\n<<<TEXT\n${text}\nTEXT>>>`;
}

export function createRelay(d: RelayDeps) {
  const now = d.now ?? Date.now;
  const maxChars = d.maxChars ?? 4000;
  const maxAudioFrame = d.maxAudioFrame ?? 96_000;
  const maxControl = d.maxControlPerSec ?? 30;
  const maxAudioRate = d.maxAudioPerSec ?? 400_000;
  const log = d.log ?? (() => {});

  let state: RelayState = 'awaiting_auth';
  let userId = '';
  let sessionId = '';
  let up: UpstreamPort | null = null;
  let turn = 0; // bumped on every new utterance and every interrupt; stale async work compares against it
  let abort: AbortController | null = null;
  let currentResponse: string | null = null; // upstream response id that is currently allowed to stream audio
  let pendingCreate = false; // response.create sent, response.created not seen yet
  let ignoreCreated = 0; // responses that were cancelled before upstream told us their id
  let doneCrisis = false;
  let partial = '';
  let ctlWindow = { at: 0, n: 0 };
  let audioWindow = { at: 0, bytes: 0 };
  let authing = false;

  const fail = (code: string, message: string) => d.send({ type: 'error', code, message });

  function close(reason = 'closed') {
    if (state === 'closed') return;
    state = 'closed'; turn++;
    abort?.abort(); abort = null;
    try { up?.close(); } catch { /* already closed */ }
    up = null;
    log('relay_closed', { reason });
  }

  function cancelSpeech() {
    if (up && (currentResponse || pendingCreate)) {
      if (pendingCreate && !currentResponse) ignoreCreated++;
      try { up.send({ type: 'response.cancel' }); } catch { /* upstream gone */ }
    }
    currentResponse = null; pendingCreate = false;
  }

  /** Barge-in: stop everything for the current turn. */
  function interrupt(reason: string) {
    if (state === 'closed' || state === 'awaiting_auth' || state === 'connecting') return;
    const wasBusy = state === 'thinking' || state === 'speaking';
    turn++;
    abort?.abort(); abort = null;
    cancelSpeech();
    state = 'listening';
    if (wasBusy) { d.send({ type: 'interrupted' }); log('interrupted', { reason }); }
  }

  function speak(text: string, crisis: boolean, my: number) {
    if (my !== turn || !up) return;
    const clean = cleanForSpeech(text);
    if (!clean) { state = 'listening'; d.send({ type: 'assistant_done', crisis }); return; }
    state = 'speaking'; pendingCreate = true; doneCrisis = crisis;
    up.send({ type: 'response.create', response: { modalities: ['audio', 'text'], conversation: 'none', tool_choice: 'none', instructions: speechInstructions(clean) } });
  }

  async function utterance(text: string) {
    const t = text.trim();
    if (!t || state === 'closed') return;
    if (t.length > maxChars) { fail('MESSAGE_TOO_LONG', 'Message is too long'); return; }
    // A new utterance replaces whatever was in flight.
    turn++; const my = turn;
    abort?.abort(); cancelSpeech();
    const ac = new AbortController(); abort = ac;
    state = 'thinking';
    // SAFETY GATE: the transcript is assessed before ANY model call. HIGH / IMMINENT => fixed reply, model not called, text not stored.
    const severity = assessSafely(t).severity;
    try {
      if (severity === 'HIGH' || severity === 'IMMINENT') {
        log('crisis_gate', { severity });
        const reply = await d.crisis({ userId, sessionId, text: t, severity });
        if (my !== turn) return;
        d.send({ type: 'assistant_text_delta', text: reply });
        speak(reply, true, my);
        return;
      }
      const reply = await d.converse({
        userId, sessionId, text: t, signal: ac.signal,
        onDelta: (x) => { if (my === turn) d.send({ type: 'assistant_text_delta', text: x }); },
      });
      if (my !== turn) return;
      speak(reply, false, my);
    } catch (e) {
      if (my !== turn) return; // cancelled by barge-in
      const code = (e as { code?: string })?.code ?? 'CONVERSATION_FAILED';
      state = 'listening';
      fail(code, 'Something went wrong. Please try again.');
      log('turn_failed', { code });
    }
  }

  function onUpstream(ev: any) {
    if (state === 'closed' || !ev || typeof ev.type !== 'string') return;
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        d.send({ type: 'speech_started' });
        partial = '';
        if (state === 'speaking' || state === 'thinking') interrupt('speech_started');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (typeof ev.delta === 'string') { partial += ev.delta; d.send({ type: 'partial_transcript', text: partial }); }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        partial = '';
        if (typeof ev.transcript === 'string' && ev.transcript.trim()) {
          d.send({ type: 'final_transcript', text: ev.transcript.trim() });
          void utterance(ev.transcript);
        }
        break;
      case 'response.created':
        if (ignoreCreated > 0) { ignoreCreated--; try { up?.send({ type: 'response.cancel' }); } catch { /* */ } break; }
        if (pendingCreate) { pendingCreate = false; currentResponse = ev.response?.id ?? 'unknown'; }
        break;
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (state === 'speaking' && currentResponse && typeof ev.delta === 'string') {
          if (ev.response_id && currentResponse !== 'unknown' && ev.response_id !== currentResponse) break; // audio of a cancelled response
          d.send({ type: 'audio', data: ev.delta });
        }
        break;
      case 'response.done': {
        if (ev.response?.id && currentResponse && ev.response.id !== currentResponse) break;
        if (state === 'speaking' && currentResponse) {
          currentResponse = null; state = 'listening';
          d.send({ type: 'assistant_done', crisis: doneCrisis });
        }
        break;
      }
      case 'error':
        log('upstream_error', { code: String(ev.error?.code ?? ev.error?.type ?? 'unknown') });
        if (state === 'speaking') {
          currentResponse = null; pendingCreate = false; state = 'listening';
          fail('SPEECH_FAILED', 'The voice could not be played.');
          d.send({ type: 'assistant_done', crisis: doneCrisis });
        }
        break;
      default:
        break;
    }
  }

  function onUpstreamClose() {
    if (state === 'closed') return;
    d.send({ type: 'unavailable', reason: 'upstream_closed' });
    close('upstream_closed');
  }

  async function hello(m: Extract<ClientMsg, { type: 'hello' }>) {
    if (state !== 'awaiting_auth' || authing) { fail('BAD_STATE', 'Already connected'); return; }
    authing = true;
    const user = await d.authenticate(m.token).catch(() => null);
    if (!user) { fail('UNAUTHORIZED', 'Invalid or expired token'); close('unauthorized'); return; }
    const s = await d.openSession(user.userId, m.sessionId).catch(() => null);
    if (!s) { fail('NOT_FOUND', 'Session not found'); close('no_session'); return; }
    if (d.admit && !d.admit(user.userId)) { fail('TOO_MANY_CONNECTIONS', 'Too many open voice connections'); close('cap'); return; }
    userId = user.userId; sessionId = m.sessionId; state = 'connecting';
    const port = await d.connectUpstream(s).catch(() => null);
    if ((state as RelayState) === 'closed') { port?.close(); return; }
    if (!port) { d.send({ type: 'unavailable', reason: 'upstream_unavailable' }); close('upstream_unavailable'); return; }
    up = port; state = 'listening';
    d.send({ type: 'ready', sampleRate: 24000, format: 'pcm16' });
    log('relay_ready');
  }

  function parse(raw: string): ClientMsg | null {
    let j: any;
    try { j = JSON.parse(raw); } catch { return null; }
    if (!j || typeof j !== 'object' || typeof j.type !== 'string') return null;
    switch (j.type) {
      case 'hello': return typeof j.token === 'string' && j.token && typeof j.sessionId === 'string' && j.sessionId ? { type: 'hello', token: j.token, sessionId: j.sessionId } : null;
      case 'audio': return typeof j.data === 'string' && j.data ? { type: 'audio', data: j.data } : null;
      case 'interrupt': return { type: 'interrupt' };
      case 'ping': return { type: 'ping' };
      default: return null;
    }
  }

  /** One client text frame. Never throws. */
  async function onClient(raw: string) {
    if (state === 'closed') return;
    const m = parse(raw);
    if (!m) { fail('BAD_MESSAGE', 'Unrecognised message'); return; }
    const t = now();
    if (m.type === 'audio') {
      if (m.data.length > maxAudioFrame) { fail('FRAME_TOO_LARGE', 'Audio frame too large'); return; }
      if (t - audioWindow.at >= 1000) audioWindow = { at: t, bytes: 0 };
      audioWindow.bytes += m.data.length;
      if (audioWindow.bytes > maxAudioRate) { fail('RATE_LIMITED', 'Sending audio too fast'); close('audio_rate'); return; }
    } else {
      if (t - ctlWindow.at >= 1000) ctlWindow = { at: t, n: 0 };
      if (++ctlWindow.n > maxControl) { fail('RATE_LIMITED', 'Too many messages'); close('control_rate'); return; }
    }
    switch (m.type) {
      case 'hello': await hello(m); break;
      case 'audio':
        if (state === 'awaiting_auth' || state === 'connecting') { fail('UNAUTHORIZED', 'Say hello first'); break; }
        try { up?.send({ type: 'input_audio_buffer.append', audio: m.data }); } catch { /* upstream gone: the close handler reports it */ }
        break;
      case 'interrupt': interrupt('client'); break;
      case 'ping': d.send({ type: 'pong' }); break;
    }
  }

  return { onClient, onUpstream, onUpstreamClose, close, get state() { return state; }, get userId() { return userId; } };
}
export type Relay = ReturnType<typeof createRelay>;

/** The session config sent upstream: speech-to-text with server VAD that NEVER creates a response by itself. */
export function upstreamSessionConfig(o: { transcribeModel: string; language: string; voice: string }) {
  const lang = o.language === 'en' ? 'en' : o.language === 'bn' ? 'bn' : undefined; // 'mixed' / hi / ne: let the model auto-detect
  return {
    type: 'session.update',
    session: {
      modalities: ['audio', 'text'],
      voice: o.voice,
      input_audio_format: 'pcm16', output_audio_format: 'pcm16',
      input_audio_transcription: { model: o.transcribeModel, ...(lang ? { language: lang } : {}) },
      turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600, create_response: false, interrupt_response: false },
      tool_choice: 'none',
    },
  };
}
