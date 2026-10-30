import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { apiAudio } from '../api/client';
import { useSettings } from '../store/settings';

type Lang = 'en' | 'bn' | 'mixed';

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
export const speechLocale = (lang: Lang) => (lang === 'bn' ? 'bn-BD' : lang === 'en' ? 'en-US' : 'bn-BD');

// ------------------------------------------------------------------ text preparation ------------------------------------------------------------------

const BANGLA = /[ঀ-৿]/;
const LATIN = /[A-Za-z]/;

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
export function detectLang(text: string): Lang {
  const bn = BANGLA.test(text), en = LATIN.test(text);
  return bn && en ? 'mixed' : bn ? 'bn' : 'en';
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
export function splitByScript(text: string): { text: string; lang: 'bn' | 'en' }[] {
  const runs: { text: string; lang: 'bn' | 'en' }[] = [];
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const lang: 'bn' | 'en' | null = BANGLA.test(word) ? 'bn' : LATIN.test(word) ? 'en' : null;
    const last = runs[runs.length - 1];
    if (last && (lang === null || lang === last.lang)) last.text += word;
    else runs.push({ text: word, lang: lang ?? 'bn' });
  }
  return runs.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text);
}

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

/** Natural neural voice from the backend. Throws if the first chunk cannot be fetched so the caller can fall back. */
async function playNatural(text: string, cb: SpeakCallbacks, my: number): Promise<{ spokenAll: boolean; failedFrom: number; chunks: string[] }> {
  const chunks = splitChunks(text);
  // One quick retry for transient failures (network blip, provider hiccup). Quota, auth and consent errors will not fix themselves.
  const TRANSIENT = new Set(['NETWORK', 'TTS_UNAVAILABLE', 'TTS_TIMEOUT', 'TTS_BAD_RESPONSE']);
  const fetchChunk = async (i: number) => {
    const body = { text: chunks[i], language: detectLang(chunks[i]!) };
    try { return await apiAudio('/speech', body); }
    catch (e) {
      if (!TRANSIENT.has((e as { code?: string })?.code ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 400));
      return apiAudio('/speech', body);
    }
  };
  const get = (i: number) => {
    const p = fetchChunk(i);
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
    if (i === 0) cb.onStart?.();
    try { await playBuffer(buf); } catch { return { spokenAll: false, failedFrom: i, chunks }; }
    if (my !== session) return { spokenAll: false, failedFrom: -1, chunks };
  }
  return { spokenAll: true, failedFrom: chunks.length, chunks };
}

// ---- device (built-in) voice, used as the fallback ----
const voiceCache = new Map<string, Speech.Voice | null>();
async function pickVoice(lang: 'bn' | 'en'): Promise<Speech.Voice | null> {
  if (voiceCache.has(lang)) return voiceCache.get(lang)!;
  let best: Speech.Voice | null = null;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const score = (v: Speech.Voice) =>
      (v.language?.toLowerCase().startsWith(lang === 'bn' ? 'bn-bd' : 'en-us') ? 3 : 0) + (v.quality === 'Enhanced' ? 2 : 0) + (v.language?.toLowerCase().startsWith(lang) ? 1 : 0);
    best = voices.filter((v) => v.language?.toLowerCase().startsWith(lang)).sort((a, b) => score(b) - score(a))[0] ?? null;
  } catch { best = null; }
  voiceCache.set(lang, best);
  return best;
}
export const _resetVoiceCache = () => voiceCache.clear();
export async function hasBanglaDeviceVoice(): Promise<boolean> { return (await pickVoice('bn')) !== null; }

function speakSegment(text: string, lang: 'bn' | 'en', voice: Speech.Voice | null, cb: SpeakCallbacks, my: number): Promise<void> {
  return new Promise<void>((resolve) => {
    Speech.speak(text, {
      language: lang === 'bn' ? 'bn-BD' : 'en-US', voice: voice?.identifier,
      rate: lang === 'bn' ? 0.94 : 1, pitch: 1.15, // slightly higher pitch for a sweeter phone-voice fallback
      onBoundary: (() => { if (my === session) cb.onBoundary?.(); }) as any,
      onDone: () => resolve(), onStopped: () => resolve(), onError: () => { cb.onError?.(); resolve(); },
    });
  });
}

async function playDevice(text: string, cb: SpeakCallbacks, my: number, alreadyStarted: boolean): Promise<void> {
  const segments = splitByScript(text);
  const needsBn = segments.some((s) => s.lang === 'bn');
  const [bn, en] = await Promise.all([needsBn ? pickVoice('bn') : Promise.resolve(null), pickVoice('en')]);
  if (my !== session) return;
  if (needsBn && !bn) cb.onNotice?.('noBanglaVoice');
  stopCurrent = () => Speech.stop();
  if (!alreadyStarted) cb.onStart?.();
  for (const seg of segments) {
    if (my !== session) return;
    await speakSegment(seg.text, seg.lang, seg.lang === 'bn' ? bn : en, cb, my);
  }
  stopCurrent = null;
  if (my === session) cb.onDone?.();
}

/**
 * Speaks an AI reply. Uses the natural neural voice when enabled (best Bangla), and falls back to the phone's own voice if it
 * is off, offline, or unavailable. Callers only deal with the callbacks; they never need to know which engine ran.
 */
export async function speak(text: string, _lang: Lang, cb: SpeakCallbacks = {}): Promise<void> {
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
