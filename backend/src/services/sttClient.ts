import { AppError, providerError } from '../utils/errors.js';

export interface SttConfig { apiKey: string; baseUrl: string; model: string; timeoutMs: number }
export type SttLang = 'en' | 'bn' | 'hi' | 'ne' | 'mixed';
export interface SttClient { transcribe(audio: Buffer, mime: string, lang: SttLang, signal?: AbortSignal): Promise<string> }
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
  hi: 'यह हिंदी में बातचीत है। बीच-बीच में अंग्रेज़ी शब्द हो सकते हैं।',
  ne: 'यो नेपालीमा कुराकानी हो। बीचबीचमा अंग्रेजी शब्दहरू हुन सक्छन्।',
};

export function createSttClient(cfg: SttConfig, fetchImpl: FetchLike = fetch): SttClient {
  return {
    async transcribe(audio, mime, lang, signal) {
      if (!cfg.apiKey) throw providerError('Voice listening is not configured.', 'STT_NOT_CONFIGURED', 503);
      const base = mime.split(';')[0]!.trim().toLowerCase();
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const send = (withHint: boolean) => {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audio)], { type: base }), `speech.${EXT[base] ?? 'm4a'}`);
        form.append('model', cfg.model);
        if (withHint && lang !== 'mixed') form.append('language', lang);
        if (lang !== 'en' && PROMPTS[lang]) form.append('prompt', PROMPTS[lang]);
        return fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', signal: s, headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form });
      };
      let res: Response;
      try {
        res = await send(true);
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
      // Whisper-style models sometimes echo the prompt on silence; treat that as "heard nothing".
      return Object.values(PROMPTS).some((p) => p && text === p.trim()) ? '' : text;
    },
  };
}
