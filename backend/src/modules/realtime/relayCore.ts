import { assessSafely, type Severity } from '../../services/safetyService.js';
import { SPOKEN_MAX_SENTENCES } from '../../services/spokenReply.js';
import { cleanForSpeech } from '../../services/ttsClient.js';
import { classifyTranscript, holdDelay, isEcho, type SpokenText } from './transcriptFilter.js';

// State machine + message protocol for the realtime voice relay. No sockets and no network: everything it needs comes in through RelayDeps
// (only timers are used, for the hold window and token expiry), so it is unit-tested with a fake upstream.
//
// HYBRID design (keeps safety and persistence intact): the upstream realtime connection is used ONLY for streaming speech-to-text and for
// streaming text-to-speech of text WE choose. The words the assistant says always come from conversationService (full context, safety,
// persistence), never from the realtime model itself.
//
// PROTOCOL (JSON text frames)
//  client -> server
//    {type:'hello', token, sessionId, resume?:true}  first frame. resume = reconnect of the same session (same handling, no side effects)
//    {type:'auth', token}                            token refresh; answered with {type:'auth_ok'}; a bad token => error UNAUTHORIZED + close
//    {type:'audio', data}                            base64 PCM16 mono 24 kHz
//    {type:'interrupt'}                              explicit stop: cancels the reply and discards any not-yet-answered words
//    {type:'ping'}                                   answered with {type:'pong'}; any frame counts as a heartbeat (ws.ts closes after 40 s of silence)
//  server -> client
//    {type:'ready', sampleRate:24000, format:'pcm16'}
//    {type:'state', state:'listening'|'thinking'|'speaking'}   on EVERY change and once after ready: the source of truth for the screen
//    {type:'speech_started'} {type:'partial_transcript', text} {type:'final_transcript', text}   (text = the whole held thought)
//    {type:'ignored', reason:'echo'|'noise'|'empty'}           a transcript was dropped (informational)
//    {type:'assistant_text_delta', text} {type:'audio', data}  streamed reply text / speech
//    {type:'assistant_done', crisis}                           exactly one per answered reply, after its last audio
//    {type:'interrupted'} {type:'audio_reset'}                 reply cancelled / drop queued + playing audio
//    {type:'token_expiring', inSec}                            ~60 s before the access token expires: send {type:'auth'}
//    {type:'replaced'}                                         the same user opened this session elsewhere; this connection is closed
//    {type:'auth_ok'} {type:'error', code, message} {type:'unavailable', reason} {type:'pong'}
//    If no refresh arrives before expiry: {type:'error', code:'TOKEN_EXPIRED'} then close, so the client reconnects.
//
// TURNS: `turn` increases on every new reply and every cancel; each async step (safety, model, speech queue) captures its turn id and does
// nothing when it is stale. A final transcript that arrives while a reply is thinking/speaking CANCELS that reply and is answered afterwards;
// words of a reply that was cancelled before the model finished are merged back in front of the next transcript, so nothing the user said is lost.

/** Client -> server (JSON text frames). */
export type ClientMsg =
  | { type: 'hello'; token: string; sessionId: string; resume?: boolean }
  | { type: 'auth'; token: string }
  | { type: 'audio'; data: string } // base64 PCM16 mono 24 kHz
  | { type: 'interrupt' }
  | { type: 'ping' };

/** Server -> client (JSON text frames). */
export type ServerMsg =
  | { type: 'ready'; sampleRate: 24000; format: 'pcm16' }
  | { type: 'state'; state: 'listening' | 'thinking' | 'speaking' }
  | { type: 'speech_started' }
  | { type: 'partial_transcript'; text: string }
  | { type: 'final_transcript'; text: string }
  | { type: 'ignored'; reason: 'echo' | 'noise' | 'empty' }
  | { type: 'assistant_text_delta'; text: string }
  | { type: 'audio'; data: string }
  | { type: 'assistant_done'; crisis: boolean }
  | { type: 'interrupted' }
  | { type: 'audio_reset' } // drop any queued/playing assistant audio: a newer reply replaces it
  | { type: 'token_expiring'; inSec: number }
  | { type: 'replaced' }
  | { type: 'auth_ok' }
  | { type: 'error'; code: string; message: string }
  | { type: 'unavailable'; reason: string }
  | { type: 'pong' };

export interface UpstreamPort { send(event: Record<string, unknown>): void; close(): void }

export interface RelayDeps {
  send(m: ServerMsg): void;
  /** Verifies an access token (same rules as middleware/authenticate.ts). expiresAt = epoch ms of the token's expiry, when known. */
  authenticate(token: string): Promise<{ userId: string; expiresAt?: number } | null>;
  /** Returns the session if it belongs to the user and is active, else null. */
  openSession(userId: string, sessionId: string): Promise<{ language: string } | null>;
  /** Global per-user connection cap (a second connection for the SAME session is handled by the caller as a replacement). Return false to refuse. */
  admit?(userId: string, sessionId?: string): boolean;
  /** Opens the upstream speech connection, or null if it is unavailable / not configured. */
  connectUpstream(session: { language: string }): Promise<UpstreamPort | null>;
  /** Normal turn: full context, safety and persistence live in conversationService. Resolves to the reply text. */
  converse(i: { userId: string; sessionId: string; text: string; signal: AbortSignal; onDelta: (t: string) => void }): Promise<string>;
  /** HIGH / IMMINENT only: returns the fixed, reviewed crisis reply. The model is never called on this path. */
  crisis(i: { userId: string; sessionId: string; text: string; severity: Severity }): Promise<string>;
  /** Content-free structured log. */
  log?(event: string, fields?: Record<string, unknown>): void;
  /** Called once when the relay closes itself or is closed (so the socket owner can close the socket). */
  onClose?(reason: string): void;
  now?: () => number;
  maxChars?: number;
  /** Max base64 chars in one audio frame. */
  maxAudioFrame?: number;
  /** Max non-audio client frames per second. */
  maxControlPerSec?: number;
  /** Max audio base64 chars per second. */
  maxAudioPerSec?: number;
  /** Base wait after a final transcript for the user to carry on (people pause mid-thought). 0 = answer at once. Adaptive: see holdDelay. */
  holdMs?: number;
  /** Overrides of the adaptive hold: finished sentence / no clear signal / ends mid-thought. Defaults: holdMs, 1.5 x, 2.5 x (capped ~1.6 s). */
  holdCompleteMs?: number;
  holdOpenMs?: number;
  holdMidMs?: number;
  /** If more speech started but never yields words (noise), answer what we already have after this long. Default 6000. */
  speechGraceMs?: number;
  /** How long after the assistant spoke its own words may come back as an "echo" transcript. Default 12000. */
  echoWindowMs?: number;
  /** token_expiring is sent this long before expiry. Default 60000. */
  tokenWarnMs?: number;
}

export type RelayState = 'awaiting_auth' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'closed';

const SPEECH_RULES = 'Read the text between the markers aloud EXACTLY as written, word for word, in the voice of a cute, sweet, cheerful young woman around 18 years old: light, slightly higher, playful, warm and gentle, never childish or squeaky at a natural conversational pace (not slow, not rushed). Do not add, remove, answer or comment on anything. Do not read the markers. The text may be Bangla, Hindi, Nepali or English: speak it like a native speaker of that language, enunciate every word and conjunct consonant clearly, pause only briefly at punctuation, and say any English words in English.';

export function speechInstructions(text: string): string {
  return `${SPEECH_RULES}\n<<<TEXT\n${text}\nTEXT>>>`;
}

const FIRST_CHUNK_MIN = 12; // chars: the first sentence starts speaking as soon as it is complete
const CHUNK_MIN = 30;       // later sentences are grouped so the voice does not stutter
const ROLLING_MS = 45_000;
const ROLLING_N = 3;
const SEVERE = (s: Severity) => s === 'HIGH' || s === 'IMMINENT';

/** Index just after the first sentence end (plus following whitespace) in buf whose text is at least `min` chars, or 0. */
function sentenceCut(buf: string, min: number): number {
  const re = /[.!?।॥…؟\n]+["'”’)\]]*(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    const end = m.index + m[0].length;
    if (buf.slice(0, end).trim().length >= min) {
      let e = end;
      while (e < buf.length && /\s/.test(buf[e]!)) e++;
      return e;
    }
  }
  return 0;
}

interface Reply {
  turn: number;
  text: string;          // what the user said (kept only in memory, to merge back if the reply is cancelled before the model finished)
  crisis: boolean;
  queue: string[];       // sentence-sized chunks waiting for TTS, spoken strictly one after another
  sending: boolean;      // a response.create is in flight upstream
  modelDone: boolean;    // the full reply text is known and queued
  silent: boolean;       // speech failed: still finish the turn, say nothing more
  spoke: boolean;        // some chunk was queued/spoken
  deltaText: string;     // all streamed deltas
  fed: number;           // chars of deltaText already turned into chunks
  buf: string;           // streamed text not yet cut into a chunk
  sentences: number;     // sentences already queued for speech
  capped: boolean;       // a call answer is short: after SPOKEN_MAX_SENTENCES nothing more is spoken (the saved reply is cut the same way)
}

interface Entry { id?: string; created: boolean; cancelled: boolean; turn: number; at: number; sp: SpokenText }

export function createRelay(d: RelayDeps) {
  const now = d.now ?? Date.now;
  const maxChars = d.maxChars ?? 4000;
  const maxAudioFrame = d.maxAudioFrame ?? 96_000;
  const maxControl = d.maxControlPerSec ?? 30;
  const maxAudioRate = d.maxAudioPerSec ?? 400_000;
  const holdMs = d.holdMs ?? 0;
  const graceMs = d.speechGraceMs ?? 6000;
  const echoWindow = d.echoWindowMs ?? 12_000;
  const tokenWarnMs = d.tokenWarnMs ?? 60_000;
  const log = d.log ?? (() => {});

  let state: RelayState = 'awaiting_auth';
  let userId = '';
  let sessionId = '';
  let up: UpstreamPort | null = null;
  let turn = 0; // bumped on every new reply and every cancel; stale async work compares against it
  let abort: AbortController | null = null;
  let reply: Reply | null = null;
  let inflight: Entry[] = []; // upstream responses we asked for, oldest first; matched to response.created in order
  let spoken: SpokenText[] = [];
  let partial = '';
  let held = ''; // transcript fragments of one spoken thought, waiting for the hold window to pass
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let rolling: { text: string; at: number }[] = [];
  let tokenWarnTimer: ReturnType<typeof setTimeout> | null = null;
  let tokenExpTimer: ReturnType<typeof setTimeout> | null = null;
  let ctlWindow = { at: 0, n: 0 };
  let audioWindow = { at: 0, bytes: 0 };
  let authing = false;
  let resumed = false;

  const fail = (code: string, message: string) => d.send({ type: 'error', code, message });
  const upSend = (ev: Record<string, unknown>) => { try { up?.send(ev); } catch { log('upstream_send_failed'); } };

  function setState(s: Exclude<RelayState, 'closed'>) {
    if (state === s) return;
    state = s;
    if (s === 'listening' || s === 'thinking' || s === 'speaking') d.send({ type: 'state', state: s });
  }

  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
  const setHold = (ms: number) => { clearHold(); holdTimer = setTimeout(flushHeld, ms); };
  function flushHeld() {
    holdTimer = null;
    const t = held; held = '';
    if (t && state !== 'closed') void utterance(t);
  }
  const holdFor = (text: string) => holdDelay(text, holdMs, { completeMs: d.holdCompleteMs, openMs: d.holdOpenMs, midMs: d.holdMidMs });
  /** After a dropped transcript: words we were holding must still be answered, and soon. */
  const rearmHeld = () => { if (held && state !== 'closed') setHold(holdMs > 0 ? holdFor(held) : 300); };

  function clearToken() {
    if (tokenWarnTimer) { clearTimeout(tokenWarnTimer); tokenWarnTimer = null; }
    if (tokenExpTimer) { clearTimeout(tokenExpTimer); tokenExpTimer = null; }
  }
  function armToken(expiresAt?: number) {
    clearToken();
    if (!expiresAt || state === 'closed') return;
    const MAX = 2 ** 31 - 1;
    const remaining = expiresAt - now();
    const warn = () => { tokenWarnTimer = null; if (state !== 'closed') d.send({ type: 'token_expiring', inSec: Math.max(0, Math.ceil((expiresAt - now()) / 1000)) }); };
    tokenExpTimer = setTimeout(() => { tokenExpTimer = null; if (state === 'closed') return; fail('TOKEN_EXPIRED', 'Access token expired'); close('token_expired'); }, Math.min(MAX, Math.max(0, remaining)));
    if (remaining <= 0) return;
    if (remaining <= tokenWarnMs) warn();
    else tokenWarnTimer = setTimeout(warn, Math.min(MAX, remaining - tokenWarnMs));
  }

  function close(reason = 'closed') {
    if (state === 'closed') return;
    state = 'closed'; turn++; clearHold(); clearToken(); held = ''; reply = null; inflight = []; rolling = [];
    abort?.abort(); abort = null;
    try { up?.close(); } catch { /* already closed */ }
    up = null;
    log('relay_closed', { reason });
    try { d.onClose?.(reason); } catch { /* owner's problem */ }
  }

  /** Another connection took over this session: tell the client and go away. */
  function replace() {
    if (state === 'closed') return;
    d.send({ type: 'replaced' });
    close('replaced');
  }

  // ---- upstream speech bookkeeping ----

  function rememberSpoken(text: string): SpokenText {
    const sp: SpokenText = { text, at: now(), live: true };
    spoken.push(sp);
    const cutoff = now() - 60_000;
    spoken = spoken.filter((s) => s.live || s.at >= cutoff);
    return sp;
  }

  /** Cancels whatever upstream is saying and forgets the queue. Late events of those responses are dropped by id (see onUpstream). */
  function cancelSpeech() {
    const live = inflight.filter((e) => !e.cancelled);
    for (const e of live) { e.cancelled = true; e.sp.live = false; e.sp.at = now(); }
    if (live.length) {
      const id = live.length === 1 ? live[0]!.id : undefined;
      upSend({ type: 'response.cancel', ...(id ? { response_id: id } : {}) });
    }
    if (inflight.length > 8) inflight = inflight.slice(-8);
  }

  /**
   * Stops the current reply (barge-in, new transcript, explicit interrupt). `restore`: words the model had not answered yet go back in
   * front of `held`, so the next transcript answers them together. Returns whether a reply was in progress.
   */
  function cancelReply(reason: string, restore: boolean): boolean {
    const r = reply;
    const wasBusy = state === 'thinking' || state === 'speaking';
    const hadAudio = !!r?.spoke || state === 'speaking' || inflight.some((e) => !e.cancelled);
    turn++; abort?.abort(); abort = null; reply = null;
    cancelSpeech();
    if (hadAudio) d.send({ type: 'audio_reset' });
    if (restore && r && !r.modelDone && r.text) held = held ? `${r.text} ${held}` : r.text;
    if (state !== 'closed') setState('listening');
    if (wasBusy) { d.send({ type: 'interrupted' }); log('interrupted', { reason }); }
    return wasBusy;
  }

  /** Explicit client stop. */
  function interrupt(reason: string) {
    if (state === 'closed' || state === 'awaiting_auth' || state === 'connecting') return;
    clearHold(); held = '';
    cancelReply(reason, false);
  }

  function finishReply(r: Reply) {
    if (r !== reply) return;
    reply = null; abort = null;
    setState('listening');
    d.send({ type: 'assistant_done', crisis: r.crisis });
  }

  /** Speaks the next queued chunk, strictly after the previous one finished; finishes the reply when everything was said. */
  function pump(r: Reply) {
    if (r !== reply || r.turn !== turn || !up || state === 'closed') return;
    if (r.sending) return;
    if (r.silent) r.queue.length = 0;
    const chunk = r.queue.shift();
    if (chunk !== undefined) {
      const cutoff = now() - 15_000;
      inflight = inflight.filter((e) => e.created || e.at >= cutoff); // a response.create that never got created must not steal ids
      const sp = rememberSpoken(chunk);
      inflight.push({ created: false, cancelled: false, turn: r.turn, at: now(), sp });
      r.sending = true;
      setState('speaking');
      // `input: []` = an empty prompt context. Without it the model also sees the user's audio from the session and ANSWERS it in its own
      // words (in whatever language it likes), once per spoken sentence, instead of reading the text we chose.
      upSend({ type: 'response.create', response: { output_modalities: ['audio'], conversation: 'none', input: [], instructions: speechInstructions(chunk) } });
      return;
    }
    if (r.modelDone) finishReply(r);
    else setState('thinking'); // waiting for the model to finish the next sentence
  }

  function enqueue(r: Reply, text: string) {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    r.queue.push(clean); r.spoke = true;
    pump(r);
  }

  /** Streamed text: cut complete sentences and start speaking the first one without waiting for the whole reply. */
  function feed(r: Reply, delta: string) {
    r.deltaText += delta;
    if (r.capped) return;
    r.buf += delta;
    for (;;) {
      const cut = sentenceCut(r.buf, r.spoke ? CHUNK_MIN : FIRST_CHUNK_MIN);
      if (cut <= 0) break;
      const piece = r.buf.slice(0, cut);
      r.buf = r.buf.slice(cut); r.fed += piece.length;
      enqueue(r, piece);
      r.sentences += (piece.match(/[।.?!…]/g) ?? []).length || 1;
      if (r.sentences >= SPOKEN_MAX_SENTENCES) { r.capped = true; r.buf = ''; break; }
    }
  }

  function speechFailed(r: Reply) {
    for (const e of inflight) { e.cancelled = true; e.sp.live = false; }
    r.sending = false; r.silent = true; r.queue.length = 0;
    fail('SPEECH_FAILED', 'The voice could not be played.');
    pump(r);
  }

  // ---- turns ----

  const roll = (text: string) => {
    const t = now();
    rolling = [...rolling, { text, at: t }].filter((x) => t - x.at <= ROLLING_MS).slice(-ROLLING_N);
  };
  const rollingText = () => { const t = now(); return rolling.filter((x) => t - x.at <= ROLLING_MS).slice(-ROLLING_N).map((x) => x.text).join(' '); };

  async function utterance(text: string) {
    const t = text.trim();
    if (!t || state === 'closed') return;
    if (t.length > maxChars) { fail('MESSAGE_TOO_LONG', 'Message is too long'); return; }
    if (reply) cancelReply('replaced', false); // defensive: callers cancel first
    turn++; const my = turn;
    const ac = new AbortController(); abort = ac;
    const r: Reply = { turn: my, text: t, crisis: false, queue: [], sending: false, modelDone: false, silent: false, spoke: false, deltaText: '', fed: 0, buf: '', sentences: 0, capped: false };
    reply = r;
    setState('thinking');
    // SAFETY GATE: the transcript is assessed before ANY model call. HIGH / IMMINENT => fixed reply, model not called, text not stored.
    // Both the merged held text and the last few fragments together (a crisis can be spread over several short utterances).
    const own = assessSafely(t).severity;
    const recent = rollingText();
    const joint = recent && recent !== t ? assessSafely(recent).severity : 'NONE';
    const severity: Severity = SEVERE(own) ? own : joint;
    try {
      if (SEVERE(severity)) {
        log('crisis_gate', { severity, across: !SEVERE(own) });
        rolling = [];
        r.crisis = true;
        const text2 = SEVERE(own) ? t : recent;
        const out = await d.crisis({ userId, sessionId, text: text2, severity });
        if (my !== turn) return;
        d.send({ type: 'assistant_text_delta', text: out });
        enqueue(r, out); r.modelDone = true; pump(r);
        return;
      }
      const full = await d.converse({
        userId, sessionId, text: t, signal: ac.signal,
        onDelta: (x) => { if (my !== turn) return; d.send({ type: 'assistant_text_delta', text: x }); feed(r, x); },
      });
      if (my !== turn) return;
      // Whatever was streamed is a prefix of the final reply (the final one may add a footer or replace unsafe text).
      const a = full.trim(); const b = r.deltaText.trim();
      let tail = full;
      if (r.capped) { r.modelDone = true; pump(r); return; } // already said everything we will say; conversationService saved the same short reply
      // Everything already queued/spoken must be an unchanged prefix of the final text; then only the rest is said. Otherwise (and only
      // then) the reply is said again from the top. A trailing space or a shortened ending alone must never make the user hear it twice.
      const fedAt = r.deltaText.trimStart().slice(0, Math.max(0, r.fed - (r.deltaText.length - r.deltaText.trimStart().length))).trimEnd().length;
      let same = 0; while (same < a.length && same < b.length && a[same] === b[same]) same++;
      if (r.deltaText && same >= fedAt) tail = a.slice(fedAt);
      else if (r.spoke) { cancelSpeech(); r.queue.length = 0; r.sending = false; r.fed = 0; d.send({ type: 'audio_reset' }); } // the final text differs: say it again from the top
      enqueue(r, tail); r.modelDone = true; pump(r);
    } catch (e) {
      if (my !== turn) return; // cancelled by barge-in
      const code = (e as { code?: string })?.code ?? 'CONVERSATION_FAILED';
      if (r.spoke) { cancelSpeech(); d.send({ type: 'audio_reset' }); }
      reply = null; abort = null;
      setState('listening');
      fail(code, 'Something went wrong. Please try again.');
      log('turn_failed', { code });
    }
  }

  // ---- upstream events ----

  function handleUpstream(ev: any) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        clearHold(); // still talking: do not answer yet, the held words stay and the next fragment is appended
        d.send({ type: 'speech_started' });
        partial = '';
        if (state === 'speaking' || state === 'thinking') cancelReply('speech_started', true);
        if (held) setHold(graceMs);
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (typeof ev.delta === 'string') { partial += ev.delta; d.send({ type: 'partial_transcript', text: partial }); }
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        partial = '';
        const raw = typeof ev.transcript === 'string' ? ev.transcript : '';
        const cls = classifyTranscript(raw);
        if (cls !== 'ok') { d.send({ type: 'ignored', reason: cls }); rearmHeld(); break; }
        if (isEcho(raw, spoken, now(), echoWindow)) { d.send({ type: 'ignored', reason: 'echo' }); rearmHeld(); break; }
        const text = raw.trim();
        // The user spoke over a reply: it is cancelled now and this (last) utterance is answered afterwards.
        if (state === 'thinking' || state === 'speaking') cancelReply('transcript', true);
        roll(text);
        held = held ? `${held} ${text}` : text;
        d.send({ type: 'final_transcript', text: held });
        clearHold();
        if (holdMs <= 0) flushHeld();
        else setHold(holdFor(held)); // a finished sentence is answered sooner than one that trails off
        break;
      }
      case 'response.created': {
        const e = inflight.find((x) => !x.created);
        if (!e) break;
        e.created = true; e.id = ev.response?.id;
        if (e.cancelled) upSend({ type: 'response.cancel', ...(e.id ? { response_id: e.id } : {}) }); // cancelled before upstream told us its id
        break;
      }
      case 'response.audio.delta':
      case 'response.output_audio.delta': {
        if (state !== 'speaking' || !reply || typeof ev.delta !== 'string') break;
        const id = ev.response_id ?? ev.response?.id;
        const e = id ? inflight.find((x) => x.id === id) : inflight.filter((x) => !x.cancelled).at(-1);
        if (!e || e.cancelled || e.turn !== turn) break; // audio of a cancelled response
        d.send({ type: 'audio', data: ev.delta });
        break;
      }
      case 'response.done': {
        const id = ev.response?.id;
        let i = id ? inflight.findIndex((x) => x.id === id) : -1;
        if (i < 0) { const first = inflight.findIndex((x) => !x.created); if (first >= 0 && (inflight[first]!.cancelled || !id)) i = first; } // done without created
        if (i < 0) break;
        const [e] = inflight.splice(i, 1);
        e!.sp.live = false; e!.sp.at = now();
        if (e!.cancelled || !reply || e!.turn !== turn) break;
        if (ev.response?.status === 'failed') { speechFailed(reply); break; }
        reply.sending = false;
        pump(reply);
        break;
      }
      case 'error':
        log('upstream_error', { code: String(ev.error?.code ?? ev.error?.type ?? 'unknown') });
        // Cancelling a response that already finished (or never started) is a harmless race, not a failure of the current speech.
        if (ev.error?.code === 'response_cancel_not_active') break;
        if (reply?.sending) speechFailed(reply);
        break;
      default:
        break;
    }
  }

  function onUpstream(ev: any) {
    if (state === 'closed' || !ev || typeof ev.type !== 'string') return;
    try { handleUpstream(ev); } catch { log('upstream_event_failed'); } // a bad event never takes the process down
  }

  function onUpstreamClose() {
    if (state === 'closed') return;
    d.send({ type: 'unavailable', reason: 'upstream_closed' });
    close('upstream_closed');
  }

  // ---- client frames ----

  async function hello(m: Extract<ClientMsg, { type: 'hello' }>) {
    if (state !== 'awaiting_auth' || authing) { fail('BAD_STATE', 'Already connected'); return; }
    authing = true;
    const user = await d.authenticate(m.token).catch(() => null);
    if ((state as RelayState) === 'closed') return;
    if (!user) { fail('UNAUTHORIZED', 'Invalid or expired token'); close('unauthorized'); return; }
    const s = await d.openSession(user.userId, m.sessionId).catch(() => null);
    if ((state as RelayState) === 'closed') return;
    if (!s) { fail('NOT_FOUND', 'Session not found'); close('no_session'); return; }
    if (d.admit && !d.admit(user.userId, m.sessionId)) { fail('TOO_MANY_CONNECTIONS', 'Too many open voice connections'); close('cap'); return; }
    userId = user.userId; sessionId = m.sessionId; resumed = m.resume === true; state = 'connecting';
    const port = await d.connectUpstream(s).catch(() => null);
    if ((state as RelayState) === 'closed') { port?.close(); return; }
    if (!port) { d.send({ type: 'unavailable', reason: 'upstream_unavailable' }); close('upstream_unavailable'); return; }
    up = port;
    d.send({ type: 'ready', sampleRate: 24000, format: 'pcm16' });
    setState('listening');
    armToken(user.expiresAt);
    log('relay_ready', { resume: resumed });
  }

  async function refresh(m: Extract<ClientMsg, { type: 'auth' }>) {
    if (state === 'awaiting_auth' || state === 'connecting') { fail('BAD_STATE', 'Say hello first'); return; }
    const user = await d.authenticate(m.token).catch(() => null);
    if (state === 'closed') return;
    if (!user || user.userId !== userId) { fail('UNAUTHORIZED', 'Invalid or expired token'); close('unauthorized'); return; }
    armToken(user.expiresAt);
    d.send({ type: 'auth_ok' });
  }

  function parse(raw: string): ClientMsg | null {
    let j: any;
    try { j = JSON.parse(raw); } catch { return null; }
    if (!j || typeof j !== 'object' || typeof j.type !== 'string') return null;
    switch (j.type) {
      case 'hello': return typeof j.token === 'string' && j.token && typeof j.sessionId === 'string' && j.sessionId
        ? { type: 'hello', token: j.token, sessionId: j.sessionId, ...(j.resume === true ? { resume: true } : {}) } : null;
      case 'auth': return typeof j.token === 'string' && j.token ? { type: 'auth', token: j.token } : null;
      case 'audio': return typeof j.data === 'string' && j.data ? { type: 'audio', data: j.data } : null;
      case 'interrupt': return { type: 'interrupt' };
      case 'ping': return { type: 'ping' };
      default: return null;
    }
  }

  /** One client text frame. Never throws. */
  async function onClient(raw: string) {
    if (state === 'closed') return;
    try {
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
        case 'auth': await refresh(m); break;
        case 'audio':
          if (state === 'awaiting_auth' || state === 'connecting') { fail('UNAUTHORIZED', 'Say hello first'); break; }
          upSend({ type: 'input_audio_buffer.append', audio: m.data }); // upstream gone: the close handler reports it
          break;
        case 'interrupt': interrupt('client'); break;
        case 'ping': d.send({ type: 'pong' }); break;
      }
    } catch { log('client_frame_failed'); }
  }

  return { onClient, onUpstream, onUpstreamClose, close, replace, get state() { return state; }, get userId() { return userId; } };
}
export type Relay = ReturnType<typeof createRelay>;

/**
 * The session config sent upstream (GA Realtime API shape; the old beta shape is rejected with beta_api_shape_disabled):
 * speech-to-text with server VAD that NEVER creates a response by itself, plus TTS for the text WE choose.
 */
export function upstreamSessionConfig(o: { transcribeModel: string; language: string; voice: string }) {
  const lang = ['en', 'bn', 'hi', 'ne'].includes(o.language) ? o.language : undefined; // 'mixed': let the model auto-detect
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: 'You only read aloud, exactly, the text you are asked to read. You never add words or answer on your own.',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: o.transcribeModel, ...(lang ? { language: lang } : {}) },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 700, create_response: false, interrupt_response: false },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: o.voice },
      },
    },
  };
}
