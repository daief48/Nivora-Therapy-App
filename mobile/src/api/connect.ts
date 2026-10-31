import { api } from './client';

// ---- journal -> today's small step ----
export interface JournalStep { actionId?: string; category?: string; minutes: number; unit?: string; title: string; why?: string; reason?: string; reasonKey?: string }
export interface StepAddResult { added: boolean; skipped: null | 'RISK'; alreadyDone?: boolean; action: { id: string; title: string } | null; flowers?: number }
/** Needs JOURNAL_AI_SHARING (403 CONSENT_REQUIRED otherwise). {skipped:'RISK'} means show nothing more. */
export const addJournalStep = (entryId: string) => api<StepAddResult>(`/journal/${entryId}/kaizen-step`, { method: 'POST' });

// ---- sleep routine (new shape, tolerant of the old one) ----
export interface RoutineStepV2 { id: string; at: string; kind: string; minutes?: number; label?: string; extra?: boolean; done?: boolean }
export interface RoutineV2 {
  desiredBedtime: string; tonightBedtime: string; steps: RoutineStepV2[]; stepsDone?: number; stepsTotal?: number; doneIds?: string[]; extras?: string[];
}
export interface RoutineStepOffer { stepId: string; label: string; minutes: number }
export interface AddStepResult { added: boolean; routine?: RoutineV2 }
export const addRoutineStep = (stepId: string) => api<AddStepResult>('/sleep/routine/steps', { method: 'POST', body: { stepId } });
export const removeRoutineStep = (stepId: string) => api<RoutineV2>(`/sleep/routine/steps/${encodeURIComponent(stepId)}`, { method: 'DELETE' });
export const setRoutineDone = (stepId: string, done: boolean) => api<RoutineV2>(`/sleep/routine/done/${encodeURIComponent(stepId)}`, { method: 'PUT', body: { done } });

/** The `routine` part of a practice response (breathing, sounds). `undo` is a ready request to send as it is. */
export interface RoutineMark {
  stepId: string; marked: boolean; stepsDone?: number; stepsTotal?: number;
  undo: { method: 'PUT' | 'POST' | 'DELETE'; path: string; body?: unknown } | null;
}
/** Sends the returned undo request. Paths come back without the /api/v1 prefix, which api() adds. */
export const runUndo = (u: NonNullable<RoutineMark['undo']>) => api(u.path.replace(/^\/api\/v1/, ''), { method: u.method, ...(u.body !== undefined ? { body: u.body } : {}) });

export interface SoundsResult { kaizen: { counted: boolean; flowers: number }; routine: RoutineMark | null }
export const completeSounds = (minutes: number, sleepRelated: boolean) =>
  api<SoundsResult>('/practice/sounds', { method: 'POST', body: { minutes, sleepRelated } });

/** True when the nudge settings or any list should be tolerant: a `routine` field that is not an object is ignored. */
export const asRoutineMark = (r: unknown): RoutineMark | null => {
  const m = r as RoutineMark | null | undefined;
  return m && typeof m === 'object' && m.marked ? m : null;
};
