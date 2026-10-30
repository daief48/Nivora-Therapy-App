import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { apiAudio } from '../api/client';
import { useSettings } from '../store/settings';
import { firstAudio, paceRateNow, paceWait } from './realtimeClient';

type Lang = import('../api/types').Locale;

/**
 * Thin wrapper around the native speech-recognition module. The module is not bundled in Expo Go, so it is loaded
 * lazily; when it is absent every caller must fall back to text input.
 */
type Recog = typeof import('expo-speech-recognition');
let mod: Recog | null | undefined;
export function recognition(): Recog | null {
  if (mod !== undefined) return mod;
  try {
    const m = require('expo-speech-recognition') as Recog;
    mod = m.ExpoSpeechRecognitionModule?.isRecognitionAvailable?.() ? m : null;
  } catch { mod = null; }
  return mod;
}
export const _resetRecognitionCache = () => { mod = undefined; };
export const speechLocale = (lang: Lang) => (lang === 'auto' ? 'auto' : lang === 'en' ? 'en-US' : lang === 'hi' ? 'hi-IN' : lang === 'ne' ? 'ne-NP' : 'bn-BD');

// ------------------------------------------------------------------ text preparation ------------------------------------------------------------------

const BANGLA = /[ঀ-৿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const OTHER_SCRIPT = /[\u0370-\u03FF\u0400-\u04FF\u0590-\u06FF\u0750-\u077F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

/** Removes markdown, links and emoji so they are never read aloud, and tidies whitespace. */
export function prepareSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>`~|]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The language a piece of text is actually in (more reliable than the session setting for mixed replies). */
/** Hindi and Nepali share the Devanagari script; the session language (set by speak/speakStream) says which one to voice. */
let devLang: 'hi' | 'ne' = 'hi';
const noteLang = (l: Lang) => { if (l === 'hi' || l === 'ne') devLang = l; };
export function detectLang(text: string): Lang {
  const bn = BANGLA.test(text), en = LATIN.test(text);
  if (bn) return en ? 'mixed' : 'bn';
  if (DEVANAGARI.test(text)) return devLang;
  if (OTHER_SCRIPT.test(text) && !en) return 'auto'; // Arabic, Chinese, ...: let the server voice speak it natively
  return 'en';
}

/**
 * Splits a reply into sentence-sized chunks. The first chunk is short so audio starts quickly; later chunks are larger.
 * Understands the Bangla danda (।) as well as . ! ? and line breaks.
 */
export function splitChunks(text: string, firstMax = 110, max = 260): string[] {
  const sentences = (text.match(/[^।.!?\n]+[।.!?]*\s*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) { pieces.push(s); continue; }
    let rest = s;
    while (rest.length > max) { // very long sentence: break at a comma or space
      const cut = Math.max(rest.lastIndexOf(',', max), rest.lastIndexOf('،', max), rest.lastIndexOf(' ', max));
      const at = cut > max * 0.4 ? cut + 1 : max;
      pieces.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const limit = chunks.length === 0 ? firstMax : max;
    if (cur && (cur + ' ' + p).length > limit) { chunks.push(cur); cur = p; } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Splits mixed text into runs of Bangla and English so each run gets a matching voice on the device engine. */
export function splitByScript(text: string): { text: string; lang: 'bn' | 'en' | 'hi' }[] {
  const runs: { text: string; lang: 'bn' | 'en' | 'hi' }[] = [];
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const lang: 'bn' | 'en' | 'hi' | null = BANGLA.test(word) ? 'bn' : DEVANAGARI.test(word) ? 'hi' : LATIN.test(word) ? 'en' : null;
    const last = runs[runs.length - 1];
    if (last && (lang === null || lang === last.lang)) last.text += word;
    else runs.push({ text: word, lang: lang ?? 'bn' });
  }
  return runs.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text);
}

// ------------------------------------------------------------------ call feel: pacing, barge-in helpers ------------------------------------------------------------------

/**
 * How long a pause after the last word ends the user's turn. Short answers ("yes", "okay") end quickly; longer thoughts get more room
 * because people pause to think mid-sentence, especially about feelings. Shorter than the old fixed 1.5 s for short turns.
 */
export function endOfSpeechMs(speechMs: number): number {
  if (speechMs < 1200) return 700;
  if (speechMs < 4000) return 1000;
  return 1300;
}

/**
 * True when the words the recogniser "heard" are (mostly) just the assistant's own voice coming back through the speaker, so they must
 * not count as the user interrupting. Needs at least 2 words that are not in what is being spoken.
 */
export function isEcho(heard: string, spoken: string): boolean {
  const words = (x: string) => x.toLowerCase().split(/[\s.,!?;:।'"()\-—]+/).filter(Boolean);
  const h = words(heard);
  if (h.length < 2) return true;
  const sp = new Set(words(spoken));
  return h.filter((w) => sp.has(w)).length / h.length >= 0.7;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ playback ------------------------------------------------------------------

export interface SpeakCallbacks {
  /** Audio is being prepared (network round-trip for natural voice). */
  onPreparing?: () => void;
  /** Sound has actually started. */
  onStart?: () => void;
  /** Finished normally (not called if stopped). */
  onDone?: () => void;
  onBoundary?: () => void;
  onError?: () => void;
  /** The phone has no Bangla voice and natural voice is unavailable, so Bangla will sound poor. */
  onNotice?: (kind: 'noBanglaVoice') => void;
}

let session = 0; // bumped on every speak()/stop so older playback stops reporting
let stopCurrent: (() => void) | null = null;
let fileCounter = 0;

/** Plays one mp3 buffer. Resolves when it ends or is stopped; rejects if it cannot play. */
function playBuffer(buf: ArrayBuffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
      const a = new Audio(url);
      const end = () => { stopCurrent = null; URL.revokeObjectURL(url); resolve(); };
      stopCurrent = () => { a.pause(); end(); };
      a.onended = end;
      a.onerror = () => { stopCurrent = null; URL.revokeObjectURL(url); reject(new Error('audio error')); };
      a.play().catch((e) => { stopCurrent = null; URL.revokeObjectURL(url); reject(e); });
      return;
    }
    // Native: write to the cache directory and play the file with expo-audio.
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    const file = new File(Paths.cache, `shanti-tts-${Date.now()}-${fileCounter++}.mp3`);
    let finished = false;
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    let sub: { remove: () => void } | null = null;
    let guard: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (guard) clearTimeout(guard);
      try { sub?.remove(); } catch { /* */ }
      try { player?.remove(); } catch { /* */ }
      try { file.delete(); } catch { /* */ }
      stopCurrent = null;
    };
    const finish = (err?: unknown) => { if (finished) return; finished = true; cleanup(); err ? reject(err) : resolve(); };
    stopCurrent = () => { try { player?.pause(); } catch { /* */ } finish(); };
    try {
      file.create({ overwrite: true });
      file.write(new Uint8Array(buf));
      void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
      player = createAudioPlayer({ uri: file.uri });
      sub = player.addListener('playbackStatusUpdate', (s: { didJustFinish?: boolean }) => { if (s.didJustFinish) finish(); });
      player.play();
      guard = setTimeout(() => finish(), 90_000); // never hang the call if the player never reports completion
    } catch (e) { finish(e); }
  });
}

// One quick retry for transient failures (network blip, provider hiccup). Quota, auth and consent errors will not fix themselves.
const TRANSIENT = new Set(['NETWORK', 'TTS_UNAVAILABLE', 'TTS_TIMEOUT', 'TTS_BAD_RESPONSE']);
async function fetchTts(text: string): Promise<ArrayBuffer> {
  const body = { text, language: detectLang(text) };
  try { return await apiAudio('/speech', body); }
  catch (e) {
    if (!TRANSIENT.has((e as { code?: string })?.code ?? '')) throw e;
    await sleep(400);
    return apiAudio('/speech', body);
  }
}

/** Natural neural voice from the backend. Throws if the first chunk cannot be fetched so the caller can fall back. */
async function playNatural(text: string, cb: SpeakCallbacks, my: number): Promise<{ spokenAll: boolean; failedFrom: number; chunks: string[] }> {
  const chunks = splitChunks(text);
  const get = (i: number) => {
    const p = fetchTts(chunks[i]!);
    p.catch(() => {}); // avoid unhandled rejections if we stop early; the awaited promise below still throws
    return p;
  };
  const queue: Promise<ArrayBuffer>[] = [];
  queue[0] = get(0);
  if (chunks.length > 1) queue[1] = get(1); // prefetch the next chunk while the first plays
  cb.onPreparing?.();
  for (let i = 0; i < chunks.length; i++) {
    let buf: ArrayBuffer;
    try { buf = await queue[i]!; } catch { if (my !== session) return { spokenAll: false, failedFrom: -1, chunks }; return { spokenAll: false, failedFrom: i, chunks }; }
    if (my !== session) return { spokenAll: false, failedFrom: -1, chunks };
    if (i + 2 < chunks.length) queue[i + 2] = get(i + 2);
    if (i === 0) {
      const w = paceWait(); if (w) await sleep(w);
      if (my !== session) return { spokenAll: false, failedFrom: -1, chunks };
      firstAudio('natural'); cb.onStart?.();
    }
    try { await playBuffer(buf); } catch { return { spokenAll: false, failedFrom: i, chunks }; }
    if (my !== session) return { spokenAll: false, failedFrom: -1, chunks };
  }
  return { spokenAll: true, failedFrom: chunks.length, chunks };
}

// ---- device (built-in) voice, used as the fallback ----
const voiceCache = new Map<string, Speech.Voice | null>();
async function pickVoice(lang: 'bn' | 'en' | 'hi'): Promise<Speech.Voice | null> {
  if (voiceCache.has(lang)) return voiceCache.get(lang)!;
  let best: Speech.Voice | null = null;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const score = (v: Speech.Voice) =>
      (v.language?.toLowerCase().startsWith(lang === 'bn' ? 'bn-bd' : lang === 'hi' ? 'hi-in' : 'en-us') ? 3 : 0) + (v.quality === 'Enhanced' ? 2 : 0) + (v.language?.toLowerCase().startsWith(lang) ? 1 : 0);
    best = voices.filter((v) => v.language?.toLowerCase().startsWith(lang)).sort((a, b) => score(b) - score(a))[0] ?? null;
  } catch { best = null; }
  voiceCache.set(lang, best);
  return best;
}
export const _resetVoiceCache = () => voiceCache.clear();
export async function hasBanglaDeviceVoice(): Promise<boolean> { return (await pickVoice('bn')) !== null; }

function speakSegment(text: string, lang: 'bn' | 'en' | 'hi', voice: Speech.Voice | null, cb: SpeakCallbacks, my: number): Promise<void> {
  return new Promise<void>((resolve) => {
    Speech.speak(text, {
      language: lang === 'bn' ? 'bn-BD' : lang === 'hi' ? 'hi-IN' : 'en-US', voice: voice?.identifier,
      rate: (lang === 'en' ? 1 : 0.94) * paceRateNow(), pitch: 1.15, // slightly higher pitch for a sweeter phone-voice fallback
      onBoundary: (() => { if (my === session) cb.onBoundary?.(); }) as any,
      onDone: () => resolve(), onStopped: () => resolve(), onError: () => { cb.onError?.(); resolve(); },
    });
  });
}

async function playDevice(text: string, cb: SpeakCallbacks, my: number, alreadyStarted: boolean): Promise<void> {
  const segments = splitByScript(text);
  const needsBn = segments.some((s) => s.lang === 'bn');
  const needsHi = segments.some((s) => s.lang === 'hi');
  const [bn, en, hi] = await Promise.all([needsBn ? pickVoice('bn') : Promise.resolve(null), pickVoice('en'), needsHi ? pickVoice('hi') : Promise.resolve(null)]);
  if (my !== session) return;
  if (needsBn && !bn) cb.onNotice?.('noBanglaVoice');
  stopCurrent = () => Speech.stop();
  if (!alreadyStarted) { firstAudio('device'); cb.onStart?.(); }
  for (const seg of segments) {
    if (my !== session) return;
    await speakSegment(seg.text, seg.lang, seg.lang === 'bn' ? bn : seg.lang === 'hi' ? hi : en, cb, my);
  }
  stopCurrent = null;
  if (my === session) cb.onDone?.();
}

/**
 * Speaks an AI reply. Uses the natural neural voice when enabled (best Bangla), and falls back to the phone's own voice if it
 * is off, offline, or unavailable. Callers only deal with the callbacks; they never need to know which engine ran.
 */
export async function speak(text: string, _lang: Lang, cb: SpeakCallbacks = {}): Promise<void> {
  noteLang(_lang);
  stopSpeaking();
  const my = ++session;
  const clean = prepareSpeech(text);
  if (!clean) { cb.onDone?.(); return; }
  if (useSettings.getState().naturalVoice) {
    const r = await playNatural(clean, cb, my);
    if (my !== session) return;
    if (r.spokenAll) { cb.onDone?.(); return; }
    // fall back to the built-in voice for whatever was not spoken
    const rest = r.chunks.slice(Math.max(0, r.failedFrom)).join(' ');
    await playDevice(rest, cb, my, r.failedFrom > 0);
    return;
  }
  await playDevice(clean, cb, my, false);
}

export function stopSpeaking() {
  session++; // invalidates any in-flight playback so it stops reporting
  try { stopCurrent?.(); } catch { /* */ }
  stopCurrent = null;
  Speech.stop();
}

// ------------------------------------------------------------------ streaming speech (first audio while the reply is still being written) ------------------------------------------------------------------

export interface SpeechStream {
  /** The reply written so far (cumulative). Complete sentences start being fetched and played immediately. */
  push(full: string): void;
  /** The server replaced the text (output safety). Anything queued or playing is dropped; end() then speaks the replacement from the start. */
  replace(): void;
  /** The final reply. Speaks whatever has not been spoken yet and reports onDone when everything has played. */
  end(full: string): void;
  cancel(): void;
}

/** Index just past the last complete sentence in `text` (a terminator followed by whitespace), or 0. */
export function sentenceBoundary(text: string): number {
  let at = 0;
  const re = /[।.!?\n]+(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) at = m.index + m[0].length;
  return at;
}

/**
 * Speaks a reply sentence by sentence while it is still streaming in. With the natural voice every finished sentence is fetched at once
 * (in parallel) and played in order, so the first sound starts after the FIRST sentence instead of after the whole reply. With the
 * device voice the final text is spoken with speak(); if the natural voice fails part-way the rest is spoken with the device voice.
 */
export function speakStream(lang: Lang, cb: SpeakCallbacks = {}): SpeechStream {
  noteLang(lang);
  stopSpeaking();
  let my = ++session;
  let consumed = 0;
  let ended = false;
  let started = false;
  let failed = false;
  let fallbackText = '';
  let items: { text: string; p: Promise<ArrayBuffer> }[] = [];
  let loop: Promise<void> | null = null;
  const natural = () => useSettings.getState().naturalVoice;

  async function run(mine: number) {
    let i = 0;
    for (;;) {
      if (mine !== session) return;
      const it = items[i];
      if (!it) {
        if (ended) break;
        await sleep(25); continue;
      }
      let buf: ArrayBuffer | null = null;
      try { buf = await it.p; } catch { buf = null; }
      if (mine !== session) return;
      if (buf && !started) {
        started = true;
        const w = paceWait(); if (w) await sleep(w);
        if (mine !== session) return;
        firstAudio('natural'); cb.onStart?.();
      }
      let ok = !!buf;
      if (buf) { try { await playBuffer(buf); } catch { ok = false; } }
      if (mine !== session) return;
      if (!ok) { // natural voice failed: the device voice takes over from this sentence
        failed = true; fallbackText = items.slice(i).map((x) => x.text).join(' ');
        if (ended) await playDevice(fallbackText, cb, mine, started);
        return;
      }
      i++;
    }
    cb.onDone?.();
  }

  const enqueue = (raw: string) => {
    const clean = prepareSpeech(raw);
    if (!clean) return;
    for (const c of splitChunks(clean)) {
      const p = fetchTts(c);
      p.catch(() => {}); // surfaced by the awaited promise in run()
      items.push({ text: c, p });
    }
    if (!started) cb.onPreparing?.();
    loop ??= run(my);
  };

  return {
    push(full) {
      if (!natural() || ended || failed) return;
      const cut = sentenceBoundary(full.slice(consumed));
      if (cut > 0) { const head = full.slice(consumed, consumed + cut); consumed += cut; enqueue(head); }
    },
    replace() { stopSpeaking(); my = ++session; consumed = 0; items = []; loop = null; started = false; failed = false; fallbackText = ''; },
    end(full) {
      ended = true;
      if (!natural()) { void speak(full, lang, cb); return; }
      if (failed) { void playDevice(`${fallbackText} ${prepareSpeech(full.slice(consumed))}`.trim(), cb, my, started); return; }
      enqueue(full.slice(consumed));
      if (!loop) cb.onDone?.(); // nothing speakable at all
    },
    cancel() { stopSpeaking(); },
  };
}
