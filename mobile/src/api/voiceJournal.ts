import { API_BASE } from '../config';
import type { JournalStep } from './connect';
import { api, ApiError, getTokens, refreshSession } from './client';

export type VoiceLang = 'en' | 'bn' | 'hi' | 'ne' | 'auto';
export interface VoiceSafety { severity: string; crisis: boolean; resources?: { name: string; contactDetails: string; verified?: boolean }[]; message?: string | null }
export interface VoiceEmotions { emotions: string[]; reflection?: string; suggestion?: string; ai?: boolean; step?: JournalStep | null; saved?: boolean; riskMode?: boolean }
export interface VoiceEntry { id: string; entryType: string; content: string; createdAt: string; updatedAt: string; source: 'voice'; hasAudio?: boolean }
export type VoiceResult =
  | { crisis: true; safety: VoiceSafety; entry: null; emotions: null; consentNeeded?: null }
  | { crisis: false; entry: VoiceEntry; emotions: VoiceEmotions | null; consentNeeded: 'JOURNAL_AI_SHARING' | null; safety?: VoiceSafety };

/** POST /journal/voice with the raw recording as the body. Same auth + one token refresh as api(); network failure -> ApiError code NETWORK. */
export async function postVoiceJournal(audio: ArrayBuffer, mime: string, opts: { language: VoiceLang; durationSec: number; keepAudio?: boolean; signal?: AbortSignal }): Promise<VoiceResult> {
  const qs = `language=${opts.language}&durationSec=${Math.max(0, Math.round(opts.durationSec))}&clean=1${opts.keepAudio ? '&keepAudio=1' : ''}`;
  const send = async () => {
    const tk = getTokens();
    try {
      return await fetch(`${API_BASE}/journal/voice?${qs}`, {
        method: 'POST', signal: opts.signal,
        headers: { 'Content-Type': mime, ...(tk ? { Authorization: `Bearer ${tk.accessToken}` } : {}) },
        body: audio as any,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server');
    }
  };
  let res = await send();
  if (res.status === 401 && getTokens() && (await refreshSession())) res = await send();
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* not json */ }
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details);
  }
  return (await res.json()).data as VoiceResult;
}

/** Existing endpoint: (re)read the feelings in an entry's text, e.g. after consent was granted. */
/** The emotions endpoint accepts at most 6000 characters; longer text is cut (the first 6000 are read, the entry itself stays whole). */
export const EMOTION_TEXT_MAX = 6000;
export const readEmotions = (text: string, entryId?: string) => api<VoiceEmotions & { crisis?: boolean; safety?: VoiceSafety }>('/journal-ai/emotions', { method: 'POST', body: { text: text.slice(0, EMOTION_TEXT_MAX), ...(entryId ? { entryId } : {}) } });
/** Existing endpoint: edit the stored transcript. */
export const updateJournalEntry = (id: string, content: string) => api(`/journal/${id}`, { method: 'PATCH', body: { content } });
