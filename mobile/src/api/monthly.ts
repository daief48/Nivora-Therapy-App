import { useQuery } from '@tanstack/react-query';
import { isConsentRequired } from '../components/ConsentRequired';
import { api } from './client';

export type Season = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
export type Metric = 'mood' | 'stress' | 'energy' | 'sleepScore' | 'kaizenDone' | 'activeMin';
export interface MonthlySeriesDay { date: string; mood: number | null; stress: number | null; energy: number | null; sleepScore: number | null; sleepHours: number | null; kaizenDone: 0 | 1 | null; steps: number | null; activeMin: number | null }
export interface Correlation { a: Metric; b: Metric; r: number; n: number; strength: 'moderate' | 'strong'; direction: 'together' | 'opposite' }
export interface WeekdayStat { weekday: 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'; mood: number | null; stress: number | null; sleepScore: number | null; days: number }
/** Aggregates only. Safe to render on a share card: contains no personal text. */
export interface ShareData { periodDays: number; daysLogged: number; avgMood: number | null; avgStress: number | null; avgSleepScore: number | null; kaizenDone: number; season: Season; strongestPattern: { a: Metric; b: Metric; direction: 'together' | 'opposite'; strength: 'moderate' | 'strong' } | null }
export interface Monthly {
  enough: boolean; periodDays: number; daysLogged: number; minDaysRequired: number;
  averages: { mood: number | null; stress: number | null; energy: number | null; sleepScore: number | null; sleepHours: number | null; steps: number | null; activeMin: number | null };
  kaizenDone: number; series: MonthlySeriesDay[]; correlations: Correlation[]; weekdays: WeekdayStat[];
  bestMoodWeekday: WeekdayStat | null; lowestMoodWeekday: WeekdayStat | null;
  narrative: { headline: string; text: string; ai: boolean } | null; season: Season; share: ShareData;
}
export interface GardenData { total: number; carried?: number; days: { date: string; count: number }[]; flowers: { id: string; date: string; kind: 'BUD' | 'BLOOM' | 'FULL_BLOOM'; index: number }[]; season?: Season; seasonLabel?: string; avgMood30?: number | null }

const get = (days: number, ai: 0 | 1) => api<Monthly>(`/insights/monthly?days=${days}&ai=${ai}`);

/**
 * Monthly story. Asks for the AI narrative first; if the API answers CONSENT_REQUIRED it keeps that error (so the UI can offer
 * the consent prompt) and fetches the same stats with ai=0 (template narrative, no consent needed).
 */
export function useMonthlyStory(days: number) {
  const aiQ = useQuery({ queryKey: ['insights', 'monthly', days, 1], queryFn: () => get(days, 1), retry: (n, e) => !isConsentRequired(e) && n < 1 });
  const consentError = aiQ.isError && isConsentRequired(aiQ.error) ? aiQ.error : null;
  const plainQ = useQuery({ queryKey: ['insights', 'monthly', days, 0], queryFn: () => get(days, 0), enabled: !!consentError });
  const active = consentError ? plainQ : aiQ;
  return {
    data: active.data, isLoading: active.isLoading, isError: active.isError, error: active.error, consentError,
    refetchAi: () => aiQ.refetch(), refetch: () => (consentError ? plainQ.refetch() : aiQ.refetch()),
  };
}

export const useGarden = () => useQuery({ queryKey: ['kaizen', 'garden'], queryFn: () => api<GardenData>('/kaizen/garden') });
