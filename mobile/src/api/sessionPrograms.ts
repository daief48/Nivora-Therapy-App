import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { completeHomework, useTherapyMutation, type SessionNote, type HomeworkItem } from './sessions';
import type { TopicRef } from './topics';

// A "Session" in the UI is a program (topic, goal, planned days); a "sitting" is one day's text conversation inside it.
// All keys live under ['therapy', 'programs'] so useTherapyMutation's invalidation refreshes everything.
export type TodayState = 'READY' | 'IN_PROGRESS' | 'DONE_TODAY' | 'PAUSED' | 'COMPLETED';
export type ProgramStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
export interface MoodPoint { day: number; moodBefore: number | null; moodAfter: number | null }
/** How a sitting is held: TEXT chat, VOICE call, or VIDEO (a voice call with the animated avatar). */
export type SittingMode = 'TEXT' | 'VOICE' | 'VIDEO';
export const ALL_MODES: SittingMode[] = ['TEXT', 'VOICE', 'VIDEO'];
export interface ProgramSummary {
  id: string; title: string; goal: string | null; topic: TopicRef | null; status: ProgramStatus;
  plannedDays: number; dailyMinutes: 30 | 40; reminderTimeMin: number | null;
  completedSittings: number; currentDay: number; progressPct: number;
  todayState: TodayState; nextAvailableAt: string | null; lastSittingAt: string | null;
  moodTrend: MoodPoint[]; startedAt: string;
  /** The open sitting's id (resume without a request). */
  activeSittingId: string | null; completedAt: string | null;
  /** Modes the server allows for this program's sittings; always includes TEXT. Absent on older servers (treated as text only). */
  availableModes?: SittingMode[];
}
export interface TimelineDay {
  dayNumber: number; date: string | null; status: 'DONE' | 'TODAY' | 'UPCOMING';
  sittingId: string | null; durationMin: number | null; moodBefore: number | null; moodAfter: number | null; shortSummary: string | null;
}
export interface ProgramDetail extends ProgramSummary {
  timeline: TimelineDay[]; themes: string[];
  openHomework: { id: string; title: string; dueDate?: string | null }[]; planGoals: { id: string; title: string }[];
}
export interface SittingStart { sittingId: string; dayNumber: number; plannedMinutes: number; isIntake: boolean; intakePart: 1 | 2 | null; endsAt: string; sessionType?: 'TEXT' | 'VOICE'; mode?: SittingMode }
export interface SittingDetail {
  id: string; dayNumber: number; status: string; startedAt: string; endedAt: string | null; durationMin: number | null; isIntake: boolean;
  moodBefore: number | null; moodAfter: number | null; note: SessionNote | null; homework: HomeworkItem[];
  transcript?: { role: 'user' | 'assistant'; content: string }[];
}
export interface CreateProgramBody {
  topicId?: string; kind?: string; title: string; goal?: string; plannedDays: number; dailyMinutes: 30 | 40; reminderTimeMin?: number;
}
export interface PatchProgramBody { title?: string; goal?: string; dailyMinutes?: 30 | 40; reminderTimeMin?: number; status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' }

export const PROGRAM_DAYS = { min: 3, max: 60 } as const;
export const programKeys = {
  list: (status?: string) => ['therapy', 'programs', 'list', status ?? 'all'] as const,
  detail: (id?: string) => ['therapy', 'programs', 'detail', id] as const,
  sitting: (pid?: string, sid?: string) => ['therapy', 'programs', 'sitting', pid, sid] as const,
};

export const usePrograms = (status?: ProgramStatus) => useQuery({
  queryKey: programKeys.list(status), queryFn: () => api<ProgramSummary[]>(`/session-programs${status ? `?status=${status}` : ''}`),
});
export const useProgram = (id?: string) => useQuery({ queryKey: programKeys.detail(id), enabled: !!id, queryFn: () => api<ProgramDetail>(`/session-programs/${id}`) });
export const useSitting = (programId?: string, sittingId?: string) => useQuery({
  queryKey: programKeys.sitting(programId, sittingId), enabled: !!programId && !!sittingId, retry: false,
  queryFn: () => api<SittingDetail>(`/session-programs/${programId}/sittings/${sittingId}`),
});

export const createProgram = (b: CreateProgramBody) => api<ProgramSummary>('/session-programs', { method: 'POST', body: b });
export const patchProgram = (id: string, b: PatchProgramBody) => api<ProgramSummary>(`/session-programs/${id}`, { method: 'PATCH', body: b });
export const deleteProgram = (id: string) => api(`/session-programs/${id}`, { method: 'DELETE' });
export const startSitting = (programId: string, b: { language: string; moodBefore?: number; rememberThis?: boolean; mode?: SittingMode }) =>
  api<SittingStart>(`/session-programs/${programId}/sittings`, { method: 'POST', body: b });
/** Switches an ACTIVE sitting between text and voice/video (409 when it is no longer active, 400 MODE_DISABLED when the mode is off). */
export const switchSittingMode = (programId: string, sittingId: string, mode: SittingMode) =>
  api<{ mode?: SittingMode }>(`/session-programs/${programId}/sittings/${sittingId}/mode`, { method: 'POST', body: { mode } });
/** The modes a program offers: TEXT always first and always present, in a stable order, ignoring anything unknown. */
export const modesOf = (p?: Pick<ProgramSummary, 'availableModes'> | null): SittingMode[] =>
  ALL_MODES.filter((m) => m === 'TEXT' || !!p?.availableModes?.includes(m));
export const callModeOf = (m: SittingMode): 'voice' | 'video' => (m === 'VIDEO' ? 'video' : 'voice');
export const useProgramMutation = useTherapyMutation;
export { completeHomework };

type Err = { code?: string; details?: unknown };
/** Friendly message key for the errors a sitting can raise. Never blames the person. */
export function sittingErrorKey(e: unknown):
  'spErrTimeUp' | 'spErrDoneToday' | 'spErrActive' | 'spErrModeOff' | 'spErrNotActive' | 'spErrProgramRequired' | null {
  switch ((e as Err)?.code) {
    case 'SITTING_TIME_UP': return 'spErrTimeUp';
    case 'ALREADY_DONE_TODAY': return 'spErrDoneToday';
    case 'SITTING_ALREADY_ACTIVE': return 'spErrActive';
    case 'MODE_DISABLED': return 'spErrModeOff';
    case 'PROGRAM_NOT_ACTIVE': return 'spErrNotActive';
    case 'PROGRAM_REQUIRED': return 'spErrProgramRequired';
    default: return null;
  }
}
/** Pulls a field (e.g. nextAvailableAt, sittingId) out of an error's details, which may be an object or JSON in the message. */
export function errorDetail(e: unknown, key: string): string | undefined {
  const d = (e as Err)?.details as Record<string, unknown> | undefined;
  const v = d && typeof d === 'object' ? d[key] : undefined;
  if (typeof v === 'string') return v;
  try { const m = JSON.parse((e as Error)?.message ?? ''); return typeof m?.[key] === 'string' ? m[key] : undefined; } catch { return undefined; }
}
