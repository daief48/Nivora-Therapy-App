import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { sittingErrorKey } from './sessionPrograms';
import type {
  CheckIn, Consent, DayPoint, Device, Goal, JournalEntry, KaizenProgress, KaizenToday, MemoryItem, Me, MoodEntry, Plan, Resource, Routine, SessionDetail,
  SessionItem, SleepList, Summary,
} from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
export const useMoods = () => useQuery({ queryKey: ['moods'], queryFn: () => api<MoodEntry[]>('/moods?limit=1000') });
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api<Goal[]>('/goals') });
export const useSessions = (limit = 30) => useQuery({ queryKey: ['sessions', limit], queryFn: () => api<SessionItem[]>(`/sessions?limit=${limit}`) });
export const useSession = (id?: string) => useQuery({ queryKey: ['session', id], enabled: !!id, queryFn: () => api<SessionDetail>(`/sessions/${id}`) });
export const useConsents = () => useQuery({ queryKey: ['consents'], queryFn: () => api<Consent[]>('/consents') });
export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: () => api<Device[]>('/auth/devices') });
export const useJournal = (search: string, entryType?: string) =>
  useQuery({
    queryKey: ['journal', search, entryType],
    queryFn: () => api<JournalEntry[]>(`/journal?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${entryType ? `&entryType=${entryType}` : ''}`),
  });
export const useCrisisResources = (country: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['crisis', country], enabled: enabled && !!country && country.length === 2,
    queryFn: () => api<{ resources: Resource[]; fallback: string; notice: string }>(`/resources/crisis?country=${country}`, { auth: false }),
  });

export function useInvalidatingMutation<V, R = unknown>(fn: (v: V) => Promise<R>, keys: string[][]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { keys.forEach((k) => qc.invalidateQueries({ queryKey: k })); } });
}

export function errorMessageKey(e: unknown): 'errorNetwork' | 'consentNeeded' | 'aiBusy' | 'aiDown' | 'tooLong' | 'errorTitle' | NonNullable<ReturnType<typeof sittingErrorKey>> {
  const err = e as { code?: string; status?: number };
  const sitting = sittingErrorKey(e);
  if (sitting) return sitting;
  if (err?.code === 'NETWORK') return 'errorNetwork';
  if (err?.code === 'CONSENT_REQUIRED') return 'consentNeeded';
  if (err?.code === 'AI_RATE_LIMITED' || err?.status === 429) return 'aiBusy';
  if (err?.code?.startsWith('AI_')) return 'aiDown';
  if (err?.code === 'MESSAGE_TOO_LONG') return 'tooLong';
  return 'errorTitle';
}

// ---- Nivora ----
export const useCheckIns = () => useQuery({ queryKey: ['checkins'], queryFn: () => api<CheckIn[]>('/checkins?limit=60') });
export const useSleep = () => useQuery({ queryKey: ['sleep'], queryFn: () => api<SleepList>('/sleep?limit=30') });
export const useRoutine = () => useQuery({ queryKey: ['routine'], queryFn: () => api<Routine>('/sleep/routine') });
export const useKaizenToday = () => useQuery({ queryKey: ['kaizen', 'today'], queryFn: () => api<KaizenToday>('/kaizen/today') });
export const useKaizenProgress = () => useQuery({ queryKey: ['kaizen', 'progress'], queryFn: () => api<KaizenProgress>('/kaizen/progress') });
export const useTimeline = (days: number) => useQuery({ queryKey: ['timeline', days], queryFn: () => api<DayPoint[]>(`/insights/timeline?days=${days}`) });
export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/insights/summary') });
export const usePlan = () => useQuery({ queryKey: ['plan'], queryFn: () => api<Plan>('/insights/plan') });
export const useMemories = () => useQuery({ queryKey: ['memories'], queryFn: () => api<MemoryItem[]>('/memories') });
/** Everything derived from check-ins, sleep or Kaizen refreshes together so Home, Insights and the plan never disagree. */
export const NIVORA_KEYS = [['checkins'], ['sleep'], ['routine'], ['kaizen'], ['timeline'], ['summary'], ['plan']];
