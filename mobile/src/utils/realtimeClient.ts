import { Platform } from 'react-native';
import { API_URL } from '../config';
import { getTokens, refreshSession } from '../api/client';
import { parseAffect, parseFiller, type Affect, type FillerKind } from './humanFeel';
import { backoffDelay, createRingBuffer, isAuthErrorCode, looksLikeHeadset, PREROLL_SAMPLES, reconcilePhase, rmsOfBytes, smoothEnergy, TOKEN_REFRESH_EVERY_MS, type CallPhase } from './callResilience';

// Client for the backend realtime voice relay (wss .../api/v1/realtime). The OpenAI key never reaches the app: the relay holds it.
// The relay only streams speech-to-text and speaks text the conversation service chose, so safety and storage stay on the server.
//
// WEB: real capture (getUserMedia + AudioWorklet / ScriptProcessor -> PCM16 24 kHz) and gap-free streamed playback with an immediate
// stop on barge-in. The microphone keeps streaming while the assistant talks (echo cancellation on) so the server hears a barge-in at once.
// The link reconnects with backoff (same session, fresh token). NATIVE: Expo's managed runtime has no PCM microphone stream, so
// `realtimeSupported()` is false and the existing turn-based path is used. Nothing is faked.

export const RT_RATE = 24000;
const CHUNK_SAMPLES = 2400; // 100 ms per audio frame
const READY_TIMEOUT_MS = 9000;

// ------------------------------------------------------------------ pure audio helpers (unit-tested) ------------------------------------------------------------------

/** Linear-interpolation resampler. Good enough for speech. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const n = Math.max(0, Math.floor((input.length * to) / from));
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1), f = pos - i0;
    out[i] = input[i0]! * (1 - f) + input[i1]! * f;
  }
  return out;
}
export function floatToPcm16(f: Float32Array): Int16Array {
  const o = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i]!)); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return o;
}
export function pcm16ToFloat(p: Int16Array): Float32Array {
  const o = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) o[i] = p[i]! / (p[i]! < 0 ? 0x8000 : 0x7fff);
  return o;
}
export function pcm16ToBase64(p: Int16Array): string {
  const b = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToPcm16(b64: string): Int16Array {
  const s = atob(b64);
  const b = new Uint8Array(s.length - (s.length % 2));
  for (let i = 0; i < b.length; i++) b[i] = s.charCodeAt(i);
  return new Int16Array(b.buffer, 0, b.length / 2);
}
/** The relay URL. The access token is NOT in it (it is sent as the first message). */
export function realtimeUrl(apiUrl: string = API_URL): string { return `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/v1/realtime`; }

// ------------------------------------------------------------------ time-to-first-audio (dev console only) ------------------------------------------------------------------

let turnT0 = 0;
let turnPause = 0;
let turnRate = 1;
declare const __DEV__: boolean | undefined;
/**
 * Small natural beat before the reply starts (never added on top of model latency): short after a short message, longer after a
 * long one. Adaptive pacing also speaks the device voice a little slower after a long message.
 */
export function replyPauseMs(userText: string): number {
  const n = userText.trim().length;
  return n < 25 ? 150 : n < 120 ? 300 : 500;
}
/** Call when the user's utterance is final. */
export function turnStarted(userText = '') { turnT0 = Date.now(); turnPause = replyPauseMs(userText); turnRate = userText.trim().length > 160 ? 0.93 : 1; }
export function paceRateNow(): number { return turnRate; }
/** Milliseconds still to wait so the reply does not start abruptly; 0 when the model was already slow. */
export function paceWait(): number { return turnT0 ? Math.max(0, turnPause - (Date.now() - turnT0)) : 0; }
/** Call when sound actually starts. Logs only in development; never logs content. */
export function firstAudio(kind: 'realtime' | 'natural' | 'device') {
  if (!turnT0) return;
  const ms = Date.now() - turnT0; turnT0 = 0;
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(`[nivora] time-to-first-audio ${ms} ms (${kind})`);
}

// ------------------------------------------------------------------ capability ------------------------------------------------------------------

export function realtimeSupported(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    return typeof WebSocket !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
      && (typeof AudioContext !== 'undefined' || typeof (globalThis as any).webkitAudioContext !== 'undefined');
  } catch { return false; }
}

// ------------------------------------------------------------------ client ------------------------------------------------------------------

export interface RealtimeHandlers {
  onSpeechStarted?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onAssistantDelta?: (text: string) => void;
  /** First sound of a reply is playing. */
  onAudioStart?: () => void;
  /** The server finished the reply (audio may still be draining). */
  onAssistantDone?: (crisis: boolean) => void;
  /** The last queued sound has finished playing. */
  onPlaybackEnd?: () => void;
  onInterrupted?: () => void;
  onError?: (code: string) => void;
  /** The relay is gone for good (reconnect tries used up): switch to the turn-based path. */
  onUnavailable?: (reason: string) => void;
  /** Server-side phase (source of truth), already reconciled with what is still playing here. */
  onState?: (phase: CallPhase) => void;
  /** The link dropped mid-call; attempt 1..5. */
  onReconnecting?: (attempt: number) => void;
  onReconnected?: () => void;
  /** Another device or tab took over this session. The client has already closed itself. */
  onReplaced?: () => void;
  /** Informational: the server ignored a chunk as echo / noise / empty. */
  onIgnored?: (reason: string) => void;
  /** Smoothed 0..1 loudness of the assistant audio playing right now (0 when silent). */
  onEnergy?: (energy: number) => void;
  /** The microphone could not be (re)started, e.g. permission revoked. */
  onMicLost?: () => void;
  /** How the reply should feel (sent just before it is spoken). Optional; older servers never send it. */
  onAffect?: (a: Affect) => void;
  /** The reply is slow: a short acknowledgement may be shown or played. Optional. */
  onFiller?: (kind: FillerKind) => void;
}
export type ConnectResult = { ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' };
export interface RealtimeClient {
  connect(sessionId: string): Promise<ConnectResult>;
  interrupt(): void;
  setMuted(muted: boolean): void;
  /** Stop listening (app in background) without ending the call. */
  pauseCapture(): void;
  resumeCapture(): Promise<boolean>;
  isPlaying(): boolean;
  /** true / false when known, null when the browser cannot tell. */
  detectHeadset(): Promise<boolean | null>;
  close(): void;
}

export function createRealtimeClient(h: RealtimeHandlers): RealtimeClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let muted = false;
  let ready = false;
  let sid = '';
  let reconnecting = false;
  let authRetried = false;
  let capturePaused = false;
  let tokenTimer: ReturnType<typeof setInterval> | null = null;
  let deviceTimer: ReturnType<typeof setTimeout> | null = null;
  // playback
  let out: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  let energy = 0;
  let nextAt = 0;
  const sources = new Set<AudioBufferSourceNode>();
  let replyStarted = false;
  let doneSeen = false;
  let gated = false; // after a barge-in, late audio of the old reply is dropped until the next reply starts
  // capture
  let inCtx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioNode | null = null;
  let pending: Float32Array = new Float32Array(0);
  const ring = createRingBuffer(PREROLL_SAMPLES); // last ~600 ms, sent first when the link is back so no words are lost

  const send = (m: unknown) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const Ctx = (): typeof AudioContext => (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;

  function stopMeter() {
    if (meterTimer) { clearInterval(meterTimer); meterTimer = null; }
    if (energy !== 0) { energy = 0; h.onEnergy?.(0); }
  }
  function startMeter() {
    if (meterTimer || !analyser || !h.onEnergy) return;
    const buf = new Uint8Array(analyser.fftSize);
    meterTimer = setInterval(() => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(buf);
      const prev = energy;
      energy = smoothEnergy(prev, rmsOfBytes(buf));
      if (Math.abs(energy - prev) > 0.02 || (energy === 0 && prev !== 0)) h.onEnergy?.(energy);
    }, 50);
  }
  /** Leaves no orphaned sources and resets every flag so the NEXT reply's onAudioStart fires. */
  function stopPlayback() {
    for (const s of sources) { s.onended = null; try { s.stop(); } catch { /* not started */ } try { s.disconnect(); } catch { /* */ } }
    sources.clear(); nextAt = 0; replyStarted = false; doneSeen = false;
    stopMeter();
  }
  function bargeStop() { stopPlayback(); gated = true; }
  function maybeDrained() {
    if (doneSeen && sources.size === 0) { doneSeen = false; replyStarted = false; stopMeter(); h.onPlaybackEnd?.(); }
  }
  function play(b64: string) {
    if (muted || gated || closed) return;
    out ??= new (Ctx())({ sampleRate: RT_RATE });
    if (out.state === 'suspended') void out.resume();
    const f = pcm16ToFloat(base64ToPcm16(b64));
    if (!f.length) return;
    if (!analyser && out.createAnalyser) { try { analyser = out.createAnalyser(); analyser.fftSize = 512; analyser.connect(out.destination); } catch { analyser = null; } }
    const buf = out.createBuffer(1, f.length, RT_RATE);
    buf.copyToChannel(f as Float32Array<ArrayBuffer>, 0);
    const src = out.createBufferSource();
    src.buffer = buf; src.connect(analyser ?? out.destination);
    const at = Math.max(out.currentTime + 0.03, nextAt);
    src.start(at); nextAt = at + buf.duration;
    sources.add(src);
    src.onended = () => { sources.delete(src); try { src.disconnect(); } catch { /* */ } maybeDrained(); };
    startMeter();
    if (!replyStarted) { replyStarted = true; h.onAudioStart?.(); }
  }

  function push(f: Float32Array, rate: number) {
    if (capturePaused) return;
    const r = resample(f, rate, RT_RATE);
    if (!ready) { ring.push(r); return; } // link busy or reconnecting: keep the last ~600 ms
    // Mic audio keeps flowing while the assistant talks (echo cancellation is on), so the server can hear a barge-in at once.
    const old = ring.size() ? ring.drain() : null;
    let base = r;
    if (old) { base = new Float32Array(old.length + r.length); base.set(old); base.set(r, old.length); }
    const merged = new Float32Array(pending.length + base.length); merged.set(pending); merged.set(base, pending.length);
    let off = 0;
    while (merged.length - off >= CHUNK_SAMPLES) { send({ type: 'audio', data: pcm16ToBase64(floatToPcm16(merged.subarray(off, off + CHUNK_SAMPLES))) }); off += CHUNK_SAMPLES; }
    pending = merged.slice(off);
  }

  async function startCapture(): Promise<'ok' | 'denied'> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch { return 'denied'; }
    if (closed) { stream.getTracks().forEach((t) => t.stop()); stream = null; return 'ok'; }
    inCtx = new (Ctx())();
    const rate = inCtx.sampleRate;
    const src = inCtx.createMediaStreamSource(stream);
    const feed = (f: Float32Array) => push(f, rate);
    const silent = inCtx.createGain(); silent.gain.value = 0; silent.connect(inCtx.destination); // some browsers only pull nodes that reach the destination
    try {
      const code = 'class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("nivora-capture",P)';
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await inCtx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const w = new AudioWorkletNode(inCtx, 'nivora-capture');
      w.port.onmessage = (e: MessageEvent) => feed(e.data as Float32Array);
      src.connect(w); w.connect(silent); node = w;
    } catch {
      const sp = inCtx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => feed(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(sp); sp.connect(silent); node = sp;
    }
    if (inCtx.state === 'suspended') void inCtx.resume();
    return 'ok';
  }
  function stopCapture() {
    try { node?.disconnect(); } catch { /* */ }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; node = null; pending = new Float32Array(0);
    const c = inCtx; inCtx = null;
    void c?.close().catch(() => {});
  }

  // Headset plugged / unplugged: capture follows the new input, playback follows the new default output.
  const onDeviceChange = () => {
    if (closed || capturePaused) return;
    if (deviceTimer) clearTimeout(deviceTimer);
    deviceTimer = setTimeout(async () => {
      deviceTimer = null;
      if (closed || capturePaused) return;
      stopCapture();
      if ((await startCapture()) === 'denied') h.onMicLost?.();
      try { await (out as any)?.setSinkId?.(''); } catch { /* output switching not supported */ }
    }, 300);
  };
  function watchDevices(on: boolean) {
    try {
      const md = navigator.mediaDevices as any;
      if (on) md.addEventListener?.('devicechange', onDeviceChange); else md.removeEventListener?.('devicechange', onDeviceChange);
    } catch { /* */ }
  }

  function teardown() {
    closed = true; ready = false; reconnecting = false;
    if (tokenTimer) { clearInterval(tokenTimer); tokenTimer = null; }
    if (deviceTimer) { clearTimeout(deviceTimer); deviceTimer = null; }
    watchDevices(false);
    stopCapture();
    stopPlayback();
    analyser = null;
    void out?.close().catch(() => {}); out = null;
    const s = ws; ws = null;
    try { s?.close(); } catch { /* */ }
  }

  async function refreshAndSendAuth() {
    if (!ready || closed) return;
    if (await refreshSession()) send({ type: 'auth', token: getTokens()?.accessToken ?? '' });
  }

  function onMessage(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.type) {
      case 'speech_started': bargeStop(); h.onSpeechStarted?.(); break; // barge-in: silence the assistant right now
      case 'partial_transcript': h.onPartial?.(m.text); break;
      case 'final_transcript': gated = false; h.onFinal?.(m.text); break;
      case 'assistant_text_delta': h.onAssistantDelta?.(m.text); break;
      case 'audio': play(m.data); break;
      case 'assistant_done': doneSeen = true; h.onAssistantDone?.(!!m.crisis); if (muted || gated || sources.size === 0) maybeDrained(); break;
      case 'audio_reset': stopPlayback(); gated = false; break; // a newer reply replaces the old one: drop what is still queued, no UI change
      case 'interrupted': bargeStop(); h.onInterrupted?.(); break;
      case 'state':
        if (m.state === 'speaking') gated = false;
        if (m.state === 'listening' || m.state === 'thinking' || m.state === 'speaking') h.onState?.(reconcilePhase(m.state, { audioPlaying: sources.size > 0 }));
        break;
      case 'token_expiring': void refreshAndSendAuth(); break;
      case 'replaced': { const cb = h.onReplaced; teardown(); cb?.(); break; }
      case 'affect': { const a = parseAffect(m); if (a) h.onAffect?.(a); break; }
      case 'filler': { const k = parseFiller(m); if (k) h.onFiller?.(k); break; }
      case 'ignored': h.onIgnored?.(String(m.reason ?? '')); break;
      case 'error':
        // an expired token is fixed once by reconnecting with a fresh one
        if (isAuthErrorCode(m.code) && !authRetried) { authRetried = true; void reconnect(); break; }
        h.onError?.(m.code); break;
      case 'unavailable': void reconnect(); break;
    }
  }

  async function open(token: string, resume: boolean): Promise<'ready' | 'unauthorized' | 'unavailable'> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: 'ready' | 'unauthorized' | 'unavailable') => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { try { s.close(); } catch { /* */ } done('unavailable'); }, READY_TIMEOUT_MS);
      let s: WebSocket;
      try { s = new WebSocket(realtimeUrl()); } catch { clearTimeout(timer); resolve('unavailable'); return; }
      ws = s;
      s.onopen = () => s.send(JSON.stringify({ type: 'hello', token, sessionId: sid, ...(resume ? { resume: true } : {}) }));
      s.onmessage = (e) => {
        if (ws !== s) return; // a socket that was already replaced
        const data = typeof e.data === 'string' ? e.data : '';
        if (!settled) {
          try {
            const m = JSON.parse(data);
            if (m.type === 'ready') { ready = true; done('ready'); return; }
            if (m.type === 'error' && isAuthErrorCode(m.code)) { done('unauthorized'); return; }
            if (m.type === 'unavailable' || m.type === 'error') { done('unavailable'); return; }
          } catch { /* ignore */ }
          return;
        }
        onMessage(data);
      };
      s.onerror = () => done('unavailable');
      s.onclose = () => { if (ws !== s) return; if (!settled) done('unavailable'); else if (!closed && ready) { ready = false; void reconnect(); } };
    });
  }

  /** Link lost mid-call: retry with backoff, a fresh token and the SAME session (resume), then give up to the turn-based path. */
  async function reconnect() {
    if (closed || reconnecting) return;
    reconnecting = true; ready = false; stopPlayback();
    const old = ws; ws = null; try { old?.close(); } catch { /* */ }
    for (let i = 0; ; i++) {
      const d = backoffDelay(i);
      if (d === null) break;
      h.onReconnecting?.(i + 1);
      await new Promise((r) => setTimeout(r, d));
      if (closed) { reconnecting = false; return; }
      await refreshSession().catch(() => false);
      const r = await open(getTokens()?.accessToken ?? '', true);
      if (closed) { reconnecting = false; return; }
      if (r === 'ready') { reconnecting = false; authRetried = false; h.onReconnected?.(); return; }
      const bad = ws as WebSocket | null; ws = null; try { bad?.close(); } catch { /* */ }
    }
    reconnecting = false;
    teardown();
    h.onUnavailable?.('reconnect_failed');
  }

  return {
    async connect(sessionId) {
      if (!realtimeSupported()) return { ok: false, reason: 'unsupported' };
      sid = sessionId;
      const mic = await startCapture();
      if (mic === 'denied') { teardown(); return { ok: false, reason: 'denied' }; }
      let r = await open(getTokens()?.accessToken ?? '', false);
      if (r === 'unauthorized' && (await refreshSession())) { try { (ws as WebSocket | null)?.close(); } catch { /* */ } r = await open(getTokens()?.accessToken ?? '', false); }
      if (r !== 'ready') { teardown(); return { ok: false, reason: 'unavailable' }; }
      watchDevices(true);
      tokenTimer = setInterval(() => void refreshAndSendAuth(), TOKEN_REFRESH_EVERY_MS);
      return { ok: true };
    },
    interrupt() { bargeStop(); send({ type: 'interrupt' }); },
    setMuted(m) { muted = m; if (m) stopPlayback(); },
    pauseCapture() { capturePaused = true; stopPlayback(); stopCapture(); },
    async resumeCapture() {
      if (closed) return false;
      capturePaused = false;
      if (stream) return true;
      if ((await startCapture()) === 'denied') { h.onMicLost?.(); return false; }
      return true;
    },
    isPlaying: () => sources.size > 0,
    async detectHeadset() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const labels = list.filter((d) => d.label).map((d) => d.label);
        return labels.length ? looksLikeHeadset(labels) : null;
      } catch { return null; }
    },
    close() { teardown(); },
  };
}
