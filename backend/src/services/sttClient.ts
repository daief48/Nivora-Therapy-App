import { AppError, providerError } from '../utils/errors.js';

export interface SttConfig { apiKey: string; baseUrl: string; model: string; timeoutMs: number }
export type SttLang = 'en' | 'bn' | 'hi' | 'ne' | 'mixed' | 'auto';
export interface SttClient {
  /** previousContext (optional): the tail of the conversation so far; its last ~200 characters help names, continuity and mixed-language words. */
  transcribe(audio: Buffer, mime: string, lang: SttLang, signal?: AbortSignal, previousContext?: string): Promise<string>;
}
type FetchLike = typeof fetch;

const EXT: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/3gpp': '3gp' };

// Bangla is forced with the language hint (it is far more accurate than auto-detect for short phrases);
// "mixed" leaves detection on, with a prompt that tells the model Bangla and English can both appear.
const PROMPT = 'এটি একটি বাংলা কথোপকথন। মাঝে মাঝে ইংরেজি শব্দ থাকতে পারে।';
// Hindi and Nepali share a script, so the explicit language hint is what keeps them apart.
const PROMPTS: Record<SttLang, string> = {
  en: '',
  bn: PROMPT,
  mixed: PROMPT,
  auto: '', // no hint: the model detects the spoken language itself (accurate for Bangla, Hindi, Nepali, English, Arabic and more)
  hi: 'यह हिंदी में बातचीत है। बीच-बीच में अंग्रेज़ी शब्द हो सकते हैं।',
  ne: 'यो नेपालीमा कुराकानी हो। बीचबीचमा अंग्रेजी शब्दहरू हुन सक्छन्।',
};

const CONTEXT_CHARS = 200;
/** The last ~200 characters of the conversation, whitespace collapsed, ready to be used as (part of) the STT prompt. */
export function contextTail(previousContext?: string): string {
  const t = (previousContext ?? '').replace(/\s+/g, ' ').trim();
  return t.length > CONTEXT_CHARS ? t.slice(-CONTEXT_CHARS).trim() : t;
}

// ---- Server-side noise / hallucination filter ----
// Speech models invent text on silence, breathing and background noise. Returning '' means "heard nothing".
const flat = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const FILLERS = new Set([
  'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'ahh', 'oh', 'hm', 'hmm', 'hmmm', 'mm', 'mmm', 'mhm', 'huh', 'eh',
  'উম', 'আহ', 'হুম', 'উফ', 'अं', 'आह', 'हम्म', 'उम', 'ऊँ', 'ऊं', 'अँ', 'हुँ', 'हँ',
]);
// Typical silence hallucinations (YouTube-style outros, subtitle credits) in English, Bangla, Hindi and Nepali.
const HALLUCINATIONS = [
  'thank you for watching', 'thanks for watching', 'thank you for listening', 'please subscribe', 'like and subscribe', 'subscribe to my channel',
  'see you in the next video', 'subtitles by', 'subtitles made by', 'subtitled by', 'captions by', 'transcribed by', 'translated by', 'amara org',
  'দেখার জন্য ধন্যবাদ', 'দেখার জন্য আপনাকে ধন্যবাদ', 'সাবস্ক্রাইব', 'সাবটাইটেল',
  'देखने के लिए धन्यवाद', 'देखने के लिए शुक्रिया', 'सब्सक्राइब', 'सबटाइटल', 'अगली वीडियो में मिलते हैं',
  'हेर्नुभएकोमा धन्यवाद', 'हेरेकोमा धन्यवाद', 'सब्स्क्राइब', 'सब्सक्राइब गर्नुहोस्',
];
const TAGS = new Set(['music', 'applause', 'laughter', 'silence', 'noise', 'inaudible', 'blank audio', 'संगीत', 'तालियाँ', 'तालियां', 'সঙ্গীত', 'সংগীত', 'করতালি']);

/** True when the recognised text is almost certainly not speech (empty, symbols, filler, known hallucination, prompt echo). */
export function isSttNoise(raw: string, sentPrompt = ''): boolean {
  const text = (raw ?? '').trim();
  if (!text) return true;
  const stripped = text.replace(/[\[(（【][^\])）】]{0,40}[\])）】]/gu, ' ').replace(/[♪♫♬🎵🎶]/gu, ' ');
  const f = flat(stripped);
  if (!/[\p{L}\p{N}]/u.test(f)) return true; // punctuation, music symbols or a bracketed tag such as [Music] only
  if (TAGS.has(f) || FILLERS.has(f)) return true;
  if (/^(.)\1{4,}$/u.test(f.replace(/\s/g, ''))) return true; // "aaaaaa"
  const words = f.split(' ');
  if (words.length >= 5 && new Set(words).size === 1) return true; // "you you you you you"
  if (words.length >= 2 && words.every((w) => FILLERS.has(w))) return true; // "um uh hmm"
  if (f.length <= 90 && HALLUCINATIONS.some((h) => f.includes(h) && f.length <= h.length + 45)) return true;
  // The model repeated the prompt it was given (language prompt and/or conversation tail).
  if (Object.values(PROMPTS).some((p) => p && flat(p) === f)) return true;
  const fp = flat(sentPrompt);
  if (fp && (fp === f || (f.length >= 12 && fp.includes(f)))) return true;
  return false;
}

export function createSttClient(cfg: SttConfig, fetchImpl: FetchLike = fetch): SttClient {
  return {
    async transcribe(audio, mime, lang, signal, previousContext) {
      if (!cfg.apiKey) throw providerError('Voice listening is not configured.', 'STT_NOT_CONFIGURED', 503);
      const base = mime.split(';')[0]!.trim().toLowerCase();
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const prompt = [lang !== 'en' ? PROMPTS[lang] : '', contextTail(previousContext)].filter(Boolean).join(' ');
      const send = (withHint: boolean) => {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audio)], { type: base }), `speech.${EXT[base] ?? 'm4a'}`);
        form.append('model', cfg.model);
        if (withHint && lang !== 'mixed' && lang !== 'auto') form.append('language', lang);
        if (prompt) form.append('prompt', prompt);
        return fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', signal: s, headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form });
      };
      let res: Response;
      try {
        res = await send(true);
        if (res.status >= 500) res = await send(true); // one retry on a transient provider error
        // If the provider rejects the language hint itself (a language it does not list), retry once with auto-detection.
        if (res.status === 400 && (lang === 'hi' || lang === 'ne')) res = await send(false);
      } catch {
        if (signal?.aborted) throw new AppError(499, 'CANCELLED', 'Request cancelled');
        throw providerError('The listening service took too long to respond.', timeout.aborted ? 'STT_TIMEOUT' : 'STT_UNAVAILABLE', timeout.aborted ? 504 : 503);
      }
      if (!res.ok) {
        let code = '';
        try { const j: any = await res.json(); code = String(j?.error?.code ?? ''); } catch { /* not json */ }
        if (code === 'insufficient_quota' || code === 'billing_not_active') throw providerError('Voice listening is not available right now.', 'STT_QUOTA_EXHAUSTED', 503);
        if (res.status === 429) throw providerError('The listening service is busy.', 'STT_RATE_LIMITED', 429);
        if (res.status === 400) throw new AppError(400, 'STT_BAD_AUDIO', 'That recording could not be read.');
        if (res.status === 401 || res.status === 403) throw providerError('Voice listening is not configured correctly.', 'STT_MISCONFIGURED', 503);
        throw providerError('The listening service is temporarily unavailable.', 'STT_UNAVAILABLE', 503);
      }
      const j: any = await res.json().catch(() => null);
      const text = typeof j?.text === 'string' ? j.text.trim() : '';
      // Whisper-style models invent text or echo the prompt on silence; treat that as "heard nothing".
      return isSttNoise(text, prompt) ? '' : text;
    },
  };
}
