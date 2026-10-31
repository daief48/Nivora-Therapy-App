import { AppError, providerError } from '../utils/errors.js';

export interface TtsConfig { apiKey: string; baseUrl: string; model: string; voice: string; timeoutMs: number }
export type SpeechLang = 'en' | 'bn' | 'hi' | 'ne' | 'mixed' | 'auto';
export interface SynthOpts { affect?: Affect | null; signal?: AbortSignal }
export interface TtsClient { synthesize(text: string, lang: SpeechLang, opts?: SynthOpts | AbortSignal): Promise<Buffer> }

type FetchLike = typeof fetch;

// Style: a cute, sweet, bright young woman (matches the princess avatar), spoken slowly and enunciated for CLARITY.
// Measured with a round-trip check (speech -> transcription) on hard Bangla sentences full of conjunct consonants, voice "shimmer":
//   plain cute style .................... 13.0% character error (one sentence 57%)
//   + "slower, enunciate every conjunct" ..  0.9%   <- used below
//   + the API speed=0.9 setting ..........  2.8%   (worse, so it is NOT used)
// (coral: 7.2% -> 1.5%). Re-measure if you change the model, voice or this text.
// Voice 'marin' with this style is the "cute-marin" sample the owner chose. Round trip (speech -> transcription) on Bangla: 0.6% character error.
const STYLE = 'a cute, sweet, cheerful young woman, around 18 years old, with a light, slightly higher, playful voice and a warm smile in her tone, like a friendly anime or storybook girl. Gentle and soft, never childish or squeaky.';
const CLARITY = 'Speak at a natural conversational pace and enunciate clearly.';
// Same young woman, but for someone who is hurting: softer, slower, lower, calmer. Never cheerful or playful. Still gentle, never flat or clinical.
const SOFT_STYLE = 'the same sweet, gentle young woman, around 18 years old, but now softer, slower, lower and calmer, with a quiet, caring, close-by tone and tiny natural pauses between phrases. Not cheerful, not playful, no smile in the voice, never bright or bubbly, never childish or squeaky.';
const SOFT_CLARITY = 'Speak slowly and softly, with small pauses, and enunciate clearly.';
const LANG_LINE: Record<SpeechLang, string> = {
  bn: 'Speak Bangla (Bengali) as a native speaker from Dhaka, Bangladesh.',
  mixed: 'The text mixes Bangla and English: speak Bangla parts as a native speaker from Dhaka, Bangladesh, and English parts in clear English.',
  en: 'Speak clear, natural English.',
  auto: 'Speak the text in whatever language it is written in, as a native speaker of that language would (Bangla as in Dhaka, Hindi, Nepali, Arabic, English or any other).',
  hi: 'Speak Hindi (Devanagari script) as a native speaker from India.',
  ne: 'Speak Nepali (Devanagari script) as a native speaker from Nepal.',
};
const LANG_TAIL: Record<SpeechLang, string> = {
  bn: ' Pronounce any English words in English.', mixed: '', en: '',
  auto: ' Pronounce any words from another language in that language.',
  hi: ' Pronounce any English words in English.', ne: ' Pronounce any English words in English.',
};
// With no affect the result is byte-identical to the original fixed strings.
const build = (lang: SpeechLang, style: string, clarity: string) => `Voice: ${style} ${LANG_LINE[lang]} ${clarity}${LANG_TAIL[lang]}`;

/** How the person feels right now (from the private emotion read). Only used to pick the delivery; never stored or logged. */
export type Affect = { emotion: string; intensity: 1 | 2 | 3 | 4 | 5 };

const SOFT_EMOTION = /\b(grie[fv]\w*|sad\w*|anxi\w*|hopeless\w*|ashamed|shame\w*|despair\w*|devastat\w*|numb|lonely|panic\w*|terrified|afraid|overwhelm\w*|depress\w*|heartbr\w*)\b|দুঃখ|কষ্ট|ভয়|আতঙ্ক|दुख|उदास|चिंता|डर/i;

/** Hurting (high intensity, or a sad / anxious / grieving / hopeless / ashamed feeling): the voice gets softer and calmer. */
export function isSoftAffect(a?: Affect | null): boolean {
  if (!a) return false;
  return a.intensity >= 4 || SOFT_EMOTION.test(a.emotion);
}

/** The TTS `instructions`: the persona STYLE, plus a softer, slower modifier when the person is hurting. No affect / light mood = the original text. */
export function affectInstructions(lang: SpeechLang, affect?: Affect | null): string {
  return isSoftAffect(affect) ? build(lang, SOFT_STYLE, SOFT_CLARITY) : build(lang, STYLE, CLARITY);
}

/** Removes markdown, emoji and links so they are not read aloud. */
export function cleanForSpeech(text: string): string {
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

export function createTtsClient(cfg: TtsConfig, fetchImpl: FetchLike = fetch): TtsClient {
  return {
    async synthesize(text, lang, o) {
      const opts: SynthOpts = o instanceof AbortSignal ? { signal: o } : o ?? {};
      const signal = opts.signal;
      if (!cfg.apiKey) throw providerError('Natural voice is not configured.', 'TTS_NOT_CONFIGURED', 503);
      const input = cleanForSpeech(text);
      if (!input) throw new AppError(400, 'EMPTY_TEXT', 'Nothing to speak');
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/audio/speech`, {
          method: 'POST', signal: s,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: cfg.model, voice: cfg.voice, input, instructions: affectInstructions(lang, opts.affect), response_format: 'mp3' }),
        });
      } catch {
        if (signal?.aborted) throw new AppError(499, 'CANCELLED', 'Request cancelled');
        throw providerError('The voice service took too long to respond.', timeout.aborted ? 'TTS_TIMEOUT' : 'TTS_UNAVAILABLE', timeout.aborted ? 504 : 503);
      }
      if (!res.ok) {
        let code = '';
        try { const j: any = await res.json(); code = String(j?.error?.code ?? ''); } catch { /* not json */ }
        res.body?.cancel().catch(() => {});
        if (code === 'insufficient_quota' || code === 'billing_not_active') throw providerError('Natural voice is not available right now.', 'TTS_QUOTA_EXHAUSTED', 503);
        if (res.status === 429) throw providerError('The voice service is busy.', 'TTS_RATE_LIMITED', 429);
        if (res.status === 401 || res.status === 403) throw providerError('Natural voice is not configured correctly.', 'TTS_MISCONFIGURED', 503);
        throw providerError('The voice service is temporarily unavailable.', 'TTS_UNAVAILABLE', 503);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) throw providerError('The voice service returned no audio.', 'TTS_BAD_RESPONSE', 502);
      return buf;
    },
  };
}
