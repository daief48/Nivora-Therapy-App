import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionCardData } from './actions';
import { api } from './client';

/** Own numbers only (counts and averages); never shown as a score. `stats` is null on the stored read. */
export interface WeeklyStats {
  kaizenDone: number; kaizenTotal: number; restarts: number; sleepNights: number; avgSleepScore: number | null; avgSleepHours: number | null;
  moodDays: number; avgMood: number | null; avgStress: number | null; daysWithData: number;
}
export interface WeeklyReport {
  weekStart: string; headline: string; text: string; ai: boolean; cached: boolean; riskMode: boolean;
  nextStep: ActionCardData | null; support: ActionCardData[]; createdAt: string; stats: WeeklyStats | null;
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Tolerant of missing fields so a partial response never crashes the card. */
export function normalizeReport(r: Partial<WeeklyReport> | null | undefined): WeeklyReport | null {
  if (!r || typeof r !== 'object') return null;
  return {
    weekStart: r.weekStart ?? '', headline: r.headline ?? '', text: r.text ?? '', ai: !!r.ai, cached: !!r.cached, riskMode: !!r.riskMode,
    nextStep: r.nextStep ?? null, support: arr<ActionCardData>(r.support), createdAt: r.createdAt ?? '', stats: r.stats ?? null,
  };
}

/** The stored report, read without the model. `null` when the person has not made one yet. */
export const useStoredWeeklyReport = () => useQuery({
  queryKey: ['reports', 'weekly'],
  queryFn: async () => normalizeReport(await api<Partial<WeeklyReport> | null>('/reports/weekly')),
});

/** Makes (or refreshes with `force`) the combined week. Needs WELLNESS_AI_SHARING: a 403 CONSENT_REQUIRED surfaces as the mutation error. */
export function useCreateWeeklyReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (force?: boolean) => normalizeReport(await api<Partial<WeeklyReport>>('/reports/weekly', { method: 'POST', body: force ? { force: true } : {} })),
    onSuccess: (r) => { qc.setQueryData(['reports', 'weekly'], r); },
  });
}
