import { Platform } from 'react-native';
import { API_URL } from '../config';
import { getTokens, refreshSession } from '../api/client';

// Client for the backend realtime voice relay (wss .../api/v1/realtime). The OpenAI key never reaches the app: the relay holds it.
// The relay only streams speech-to-text and speaks text the conversation service chose, so safety and storage stay on the server.
//
// WEB: real capture (getUserMedia + AudioWorklet / ScriptProcessor -> PCM16 24 kHz) and gap-free streamed playback with an immediate
// stop on barge-in. NATIVE: Expo's managed runtime has no PCM microphone stream, so `realtimeSupported()` is false and the existing
// turn-based path is used. Nothing is faked.

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
  /** The relay or upstream went away mid-call: switch to the turn-based path. */
  onUnavailable?: (reason: string) => void;
}
export type ConnectResult = { ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' };
export interface RealtimeClient {
  connect(sessionId: string): Promise<ConnectResult>;
  interrupt(): void;
  setMuted(muted: boolean): void;
  close(): void;
}

export function createRealtimeClient(h: RealtimeHandlers): RealtimeClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let muted = false;
  let ready = false;
  // playback
  let out: AudioContext | null = null;
  let nextAt = 0;
  const sources = new Set<AudioBufferSourceNode>();
  let replyStarted = false;
  let doneSeen = false;
  // capture
  let inCtx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioNode | null = null;
  let pending: Float32Array = new Float32Array(0);

  const send = (m: unknown) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const Ctx = (): typeof AudioContext => (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;

  function stopPlayback() {
    for (const s of sources) { s.onended = null; try { s.stop(); } catch { /* not started */ } try { s.disconnect(); } catch { /* */ } }
    sources.clear(); nextAt = 0; replyStarted = false; doneSeen = false;
  }
  function maybeDrained() {
    if (doneSeen && sources.size === 0) { doneSeen = false; replyStarted = false; h.onPlaybackEnd?.(); }
  }
  function play(b64: string) {
    if (muted) return;
    out ??= new (Ctx())({ sampleRate: RT_RATE });
    if (out.state === 'suspended') void out.resume();
    const f = pcm16ToFloat(base64ToPcm16(b64));
    if (!f.length) return;
    const buf = out.createBuffer(1, f.length, RT_RATE);
    buf.copyToChannel(f as Float32Array<ArrayBuffer>, 0);
    const src = out.createBufferSource();
    src.buffer = buf; src.connect(out.destination);
    const at = Math.max(out.currentTime + 0.03, nextAt);
    src.start(at); nextAt = at + buf.duration;
    sources.add(src);
    src.onended = () => { sources.delete(src); maybeDrained(); };
    if (!replyStarted) { replyStarted = true; h.onAudioStart?.(); }
  }

  async function startCapture(): Promise<'ok' | 'denied'> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch { return 'denied'; }
    inCtx = new (Ctx())();
    const rate = inCtx.sampleRate;
    const src = inCtx.createMediaStreamSource(stream);
    const push = (f: Float32Array) => {
      if (!ready) return;
      const r = resample(f, rate, RT_RATE);
      const merged = new Float32Array(pending.length + r.length); merged.set(pending); merged.set(r, pending.length);
      let off = 0;
      while (merged.length - off >= CHUNK_SAMPLES) { send({ type: 'audio', data: pcm16ToBase64(floatToPcm16(merged.subarray(off, off + CHUNK_SAMPLES))) }); off += CHUNK_SAMPLES; }
      pending = merged.slice(off);
    };
    const silent = inCtx.createGain(); silent.gain.value = 0; silent.connect(inCtx.destination); // some browsers only pull nodes that reach the destination
    try {
      const code = 'class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("nivora-capture",P)';
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await inCtx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const w = new AudioWorkletNode(inCtx, 'nivora-capture');
      w.port.onmessage = (e: MessageEvent) => push(e.data as Float32Array);
      src.connect(w); w.connect(silent); node = w;
    } catch {
      const sp = inCtx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(sp); sp.connect(silent); node = sp;
    }
    if (inCtx.state === 'suspended') void inCtx.resume();
    return 'ok';
  }

  function teardown() {
    closed = true; ready = false;
    try { node?.disconnect(); } catch { /* */ }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; node = null;
    void inCtx?.close().catch(() => {}); inCtx = null;
    stopPlayback();
    void out?.close().catch(() => {}); out = null;
    try { ws?.close(); } catch { /* */ }
    ws = null;
  }

  function onMessage(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.type) {
      case 'speech_started': stopPlayback(); h.onSpeechStarted?.(); break; // barge-in: silence the assistant right now
      case 'partial_transcript': h.onPartial?.(m.text); break;
      case 'final_transcript': h.onFinal?.(m.text); break;
      case 'assistant_text_delta': h.onAssistantDelta?.(m.text); break;
      case 'audio': play(m.data); break;
      case 'assistant_done': doneSeen = true; h.onAssistantDone?.(!!m.crisis); if (muted || sources.size === 0) maybeDrained(); break;
      case 'interrupted': stopPlayback(); h.onInterrupted?.(); break;
      case 'error': h.onError?.(m.code); break;
      case 'unavailable': h.onUnavailable?.(m.reason); break;
    }
  }

  async function open(sessionId: string, token: string): Promise<'ready' | 'unauthorized' | 'unavailable'> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: 'ready' | 'unauthorized' | 'unavailable') => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { try { s.close(); } catch { /* */ } done('unavailable'); }, READY_TIMEOUT_MS);
      let s: WebSocket;
      try { s = new WebSocket(realtimeUrl()); } catch { clearTimeout(timer); resolve('unavailable'); return; }
      ws = s;
      s.onopen = () => s.send(JSON.stringify({ type: 'hello', token, sessionId }));
      s.onmessage = (e) => {
        const data = typeof e.data === 'string' ? e.data : '';
        if (!settled) {
          try {
            const m = JSON.parse(data);
            if (m.type === 'ready') { ready = true; done('ready'); return; }
            if (m.type === 'error' && m.code === 'UNAUTHORIZED') { done('unauthorized'); return; }
            if (m.type === 'unavailable' || m.type === 'error') { done('unavailable'); return; }
          } catch { /* ignore */ }
          return;
        }
        onMessage(data);
      };
      s.onerror = () => done('unavailable');
      s.onclose = () => { if (!settled) done('unavailable'); else if (!closed) { ready = false; h.onUnavailable?.('socket_closed'); } };
    });
  }

  return {
    async connect(sessionId) {
      if (!realtimeSupported()) return { ok: false, reason: 'unsupported' };
      const mic = await startCapture();
      if (mic === 'denied') { teardown(); return { ok: false, reason: 'denied' }; }
      let r = await open(sessionId, getTokens()?.accessToken ?? '');
      if (r === 'unauthorized' && (await refreshSession())) { try { ws?.close(); } catch { /* */ } r = await open(sessionId, getTokens()?.accessToken ?? ''); }
      if (r !== 'ready') { teardown(); return { ok: false, reason: 'unavailable' }; }
      return { ok: true };
    },
    interrupt() { stopPlayback(); send({ type: 'interrupt' }); },
    setMuted(m) { muted = m; if (m) stopPlayback(); },
    close() { teardown(); },
  };
}
