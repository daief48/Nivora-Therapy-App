import { AppError, providerError } from '../utils/errors.js';

export interface TtsConfig { apiKey: string; baseUrl: string; model: string; voice: string; timeoutMs: number }
export type SpeechLang = 'en' | 'bn' | 'hi' | 'ne' | 'mixed';
export interface TtsClient { synthesize(text: string, lang: SpeechLang, signal?: AbortSignal): Promise<Buffer> }

type FetchLike = typeof fetch;

// Style: a cute, sweet, bright young woman (matches the princess avatar), spoken slowly and enunciated for CLARITY.
// Measured with a round-trip check (speech -> transcription) on hard Bangla sentences full of conjunct consonants, voice "shimmer":
//   plain cute style .................... 13.0% character error (one sentence 57%)
//   + "slower, enunciate every conjunct" ..  0.9%   <- used below
//   + the API speed=0.9 setting ..........  2.8%   (worse, so it is NOT used)
// (coral: 7.2% -> 1.5%). Re-measure if you change the model, voice or this text.
const STYLE = 'a cute, sweet, bright young woman, like a friendly storybook princess. Soft, gentle and warm with a light, slightly higher pitch and a little smile in the voice.';
const CLARITY = 'Speak a little slower than normal and enunciate every word very distinctly: pronounce every conjunct consonant and every vowel sign fully, never swallow word endings, and pause briefly at commas and at the end of each sentence. Clarity matters more than speed.';
const INSTRUCTIONS: Record<SpeechLang, string> = {
  bn: `Voice: ${STYLE} Speak Bangla (Bengali) as a native speaker from Dhaka, Bangladesh. ${CLARITY} Pronounce any English words in English.`,
  mixed: `Voice: ${STYLE} The text mixes Bangla and English: speak Bangla parts as a native speaker from Dhaka, Bangladesh, and English parts in clear English. ${CLARITY}`,
  en: `Voice: ${STYLE} Speak clear, natural English. ${CLARITY}`,
  hi: `Voice: ${STYLE} Speak Hindi (Devanagari script) as a native speaker from India. ${CLARITY} Pronounce any English words in English.`,
  ne: `Voice: ${STYLE} Speak Nepali (Devanagari script) as a native speaker from Nepal. ${CLARITY} Pronounce any English words in English.`,
};

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
    async synthesize(text, lang, signal) {
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
          body: JSON.stringify({ model: cfg.model, voice: cfg.voice, input, instructions: INSTRUCTIONS[lang], response_format: 'mp3' }),
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
