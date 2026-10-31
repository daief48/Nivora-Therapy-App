import { api } from './client';

export interface Kaizen { counted: boolean; flowers: number }
export interface SafetyResource { name?: string; contactDetails?: string; [k: string]: unknown }
export interface CrisisPayload { crisis: true; safety: { severity: string; crisis: true; resources: SafetyResource[]; message: string } }
export type ThoughtRecordResult = CrisisPayload | { crisis: false; entryId: string | null; kaizen: Kaizen };
export type AlternativeResult = CrisisPayload | { crisis: false; alternative: string; ai: boolean };
export interface ThoughtRecordBody {
  situation: string; thought: string; feeling?: string; alternative?: string; moodBefore?: number; moodAfter?: number; save?: boolean;
}

export const isCrisis = (r: { crisis: boolean }): r is CrisisPayload => r.crisis === true;

/** Each completion counts once per day: a repeat returns counted:false (never an error). */
export const completeBreathing = (minutes = 2) => api<{ kaizen: Kaizen }>('/practice/breathing', { method: 'POST', body: { minutes } });
export const completeGrounding = (minutes = 2) => api<{ kaizen: Kaizen }>('/practice/grounding', { method: 'POST', body: { minutes } });
export const saveThoughtRecord = (body: ThoughtRecordBody) => api<ThoughtRecordResult>('/practice/thought-record', { method: 'POST', body });
/** Needs JOURNAL_AI_SHARING consent (403 CONSENT_REQUIRED otherwise). The AI only offers a gentler alternative; it never judges the thought. */
export const suggestAlternative = (body: { thought: string; situation?: string }) =>
  api<AlternativeResult>('/practice/thought-record/alternative', { method: 'POST', body });
