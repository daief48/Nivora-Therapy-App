import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { TopicRef } from './topics';

export interface Lobby {
  needsIntake: boolean; lastSessionRecap: string | null;
  openHomework: { id: string; title: string; dueDate?: string | null }[];
  planGoals: { id: string; title: string }[];
  suggestedLengthMin: number; guidedAck: boolean; continuityOptIn: boolean;
}
export type Phase = 'OPENING' | 'AGENDA' | 'CORE' | 'SUMMARY' | 'HOMEWORK' | 'CLOSING';
export interface SessionState {
  phase: Phase; elapsedMin: number; remainingMin: number | null;
  phaseHint: 'hintOpening' | 'hintAgenda' | 'hintCore' | 'hintSummary' | 'hintHomework' | 'hintClosing';
  isIntake: boolean; moodBefore: number | null;
}
export interface PlanGoal { id: string; title: string; note?: string }
export interface TherapyPlan {
  goals: PlanGoal[]; focusAreas: string[]; approach: 'CBT' | 'MI' | 'ACT' | 'MIXED'; pace: 'GENTLE' | 'STEADY'; tone: 'WARM' | 'DIRECT';
  language: string; background?: string; whatHelps?: string; whatDoesnt?: string;
}
export interface PlanResponse { plan: TherapyPlan | null; version: number; history?: unknown[] }
export interface TherapySessionItem {
  sessionId: string; startedAt: string; endedAt: string | null; sessionType: 'TEXT' | 'VOICE'; lengthMin: number | null; phase?: string;
  isIntake: boolean; moodBefore: number | null; moodAfter: number | null; topic?: TopicRef | null; themes: string[]; summary: string | null; progressNote?: string | null;
  homeworkCount: number; finalized: boolean;
}
export interface SessionNote {
  summary?: string; progressNote?: string; agenda?: string[]; themes?: string[]; techniques?: string[]; keyInsights?: string[]; unresolved?: string[]; homework?: string[];
}
export interface HomeworkItem { id: string; title: string; dueDate?: string | null; status: 'ASSIGNED' | 'DONE' | 'SKIPPED'; feedback?: string | null }
export interface TherapySessionDetail extends TherapySessionItem {
  note: SessionNote | null; homework: HomeworkItem[]; messageCount?: number; rememberThis?: boolean; remembered?: boolean;
}
export interface Theme { id: string; label: string; count: number; lastSeenAt: string }
export interface Schedule { weekdays: number[]; timeMin: number; lengthMin: 15 | 30 | 45; remindersOn: boolean }
export interface Preferences { continuityOptIn: boolean; qualityReviewOptIn: boolean; guidedAck: boolean }

export const useLobby = () => useQuery({ queryKey: ['therapy', 'lobby'], queryFn: () => api<Lobby>('/sessions/lobby') });
/** Polled every ~20 s. No retries: when the request fails the session bar simply hides. */
export const useSessionState = (id?: string) => useQuery({
  queryKey: ['therapy', 'state', id], enabled: !!id, retry: false, refetchInterval: 20_000,
  queryFn: () => api<SessionState>(`/sessions/${id}/state`),
});
export const useTherapyPlan = () => useQuery({ queryKey: ['therapy', 'plan'], queryFn: () => api<PlanResponse>('/therapy/plan') });
export const useTherapySessions = () => useQuery({ queryKey: ['therapy', 'sessions'], queryFn: () => api<TherapySessionItem[]>('/therapy/sessions') });
export const SUMMARY_POLL_MS = 3000;
export const SUMMARY_MAX_POLLS = 6;
export const useTherapySession = (id?: string) => useQuery({
  queryKey: ['therapy', 'session', id], enabled: !!id,
  queryFn: () => api<TherapySessionDetail>(`/therapy/sessions/${id}`),
});
export const useHomework = () => useQuery({ queryKey: ['therapy', 'homework'], queryFn: () => api<HomeworkItem[]>('/therapy/homework?status=ASSIGNED') });
export const useThemes = () => useQuery({ queryKey: ['therapy', 'themes'], queryFn: () => api<Theme[]>('/therapy/themes') });
export const useSchedule = () => useQuery({ queryKey: ['therapy', 'schedule'], queryFn: () => api<Schedule>('/therapy/schedule') });
export const usePreferences = () => useQuery({ queryKey: ['therapy', 'prefs'], queryFn: () => api<Preferences>('/therapy/preferences') });

/** Mutation that refreshes everything session-related afterwards (all keys live under ['therapy']). */
export function useTherapyMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['therapy'] }); } });
}

export const savePlan = (plan: TherapyPlan) => api('/therapy/plan', { method: 'PUT', body: plan });
export const saveSchedule = (s: Schedule) => api('/therapy/schedule', { method: 'PUT', body: s });
export const savePreferences = (p: Preferences) => api('/therapy/preferences', { method: 'PUT', body: p });
export const setSessionMood = (id: string, v: { moodBefore?: number; moodAfter?: number }) => api(`/therapy/sessions/${id}/mood`, { method: 'POST', body: v });
export const completeHomework = (id: string, status: 'DONE' | 'SKIPPED', feedback?: string) =>
  api(`/therapy/homework/${id}/complete`, { method: 'POST', body: feedback ? { status, feedback } : { status } });

export interface CreateSessionBody { sessionType: 'TEXT' | 'VOICE'; language: string; lengthMin?: number; isIntake?: boolean; rememberThis?: boolean; moodBefore?: number; topicId?: string }
export const createSession = (b: CreateSessionBody) => api<{ id: string }>('/sessions', { method: 'POST', body: b });

export const hintKey = (h: string | undefined) => (`sess${(h ?? 'hintOpening').replace(/^hint/, 'Hint')}`) as
  'sessHintOpening' | 'sessHintAgenda' | 'sessHintCore' | 'sessHintSummary' | 'sessHintHomework' | 'sessHintClosing';
