import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionCardData, ActionDeepLink } from './actions';
import { api } from './client';

export type NudgeType = 'WIND_DOWN' | 'MOOD_CHECKIN' | 'WEEKLY_REVIEW' | 'MORNING_PLAN';
export const NUDGE_TYPES: NudgeType[] = ['WIND_DOWN', 'MOOD_CHECKIN', 'WEEKLY_REVIEW', 'MORNING_PLAN'];
export type NudgeCta = 'sleep_routine' | 'checkin' | 'weekly_review' | 'plan';
export type InsightKind = 'KAIZEN_WEEK' | 'SLEEP_TREND' | 'MOOD_WEEK' | 'WEEKLY_SUMMARY';

export type FeedNudgeType = NudgeType | 'SESSION_INVITE';
export interface FeedNudge {
  type: FeedNudgeType; title: string; body: string; cta: NudgeCta | string; reason: string | null;
  /** SESSION_INVITE only. INVITE = warm invitation; SUPPORT = no session button, `options` shown instead. */
  variant?: 'INVITE' | 'SUPPORT'; primary?: { label: string; deepLink: ActionDeepLink } | null; notNowLabel?: string | null; options?: ActionCardData[];
}
export interface FeedInsight { kind: InsightKind; title: string; body: string; value: number | string | null; reason: string | null }
export interface TodayFeed {
  date: string; quietNow: boolean; /** Server says: quiet hours, snooze or level NEVER. Older servers omit it. */ resting?: boolean; snoozedUntil: string | null;
  plan: { focus: string | null; kaizenActionId: string | null; tonightBedtime: string; windDownAt: string; morningCheckInDone: boolean; reason?: string | null } | null;
  nudges: FeedNudge[];
  insights: FeedInsight[];
  lightDay: boolean; riskMode: boolean; order: string[]; suggestions: ActionCardData[];
}
export interface NudgeSettings { enabled: boolean; quietStart: string; quietEnd: string; snoozedUntil: string | null; types: Record<NudgeType, boolean> }

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Tolerant of missing fields so a partial response, or an older shape restored from a saved cache, never crashes Home. */
export function normalizeFeed(raw: Partial<TodayFeed> | null | undefined): TodayFeed {
  const f = raw ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    date: f.date ?? '', quietNow: !!f.quietNow, resting: !!f.resting, snoozedUntil: f.snoozedUntil ?? null, plan: f.plan ?? null,
    nudges: arr<FeedNudge>(f.nudges).map((n) => ({ ...n, reason: str(n.reason), options: arr<ActionCardData>(n.options) })),
    insights: arr<FeedInsight>(f.insights).map((i) => ({ ...i, reason: str(i.reason) })),
    lightDay: !!f.lightDay, riskMode: !!f.riskMode, order: arr<string>(f.order), suggestions: arr<ActionCardData>(f.suggestions),
  };
}

// `select` also runs on data restored from the offline cache, which bypasses queryFn.
export const useTodayFeed = () => useQuery({
  queryKey: ['today', 'feed'],
  queryFn: async (): Promise<TodayFeed> => normalizeFeed(await api<Partial<TodayFeed>>('/today/feed')),
  select: normalizeFeed,
});

export const dismissNudge = (type: FeedNudgeType) => api<void>(`/nudges/${type}/dismiss`, { method: 'POST' });

export const useNudgeSettings = () => useQuery({ queryKey: ['nudges', 'settings'], queryFn: () => api<NudgeSettings>('/nudges/settings') });

/** Saves a partial settings change and keeps the cache in sync with the server's answer. */
export function useSaveNudgeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<NudgeSettings, 'enabled' | 'quietStart' | 'quietEnd'>> & { types?: Partial<Record<NudgeType, boolean>> }) => api<NudgeSettings>('/nudges/settings', { method: 'PUT', body: patch }),
    onSuccess: (s) => { qc.setQueryData(['nudges', 'settings'], s); void qc.invalidateQueries({ queryKey: ['today'] }); },
  });
}

/** minutes 0 clears the snooze. */
export function useSnoozeNudges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number) => api<NudgeSettings>('/nudges/snooze', { method: 'POST', body: { minutes } }),
    onSuccess: (s) => { qc.setQueryData(['nudges', 'settings'], s); void qc.invalidateQueries({ queryKey: ['today'] }); },
  });
}

/** Minutes from now until 07:00 tomorrow (at least 60), for the "until tomorrow morning" snooze. */
export function minutesUntilMorning(now = new Date()): number {
  const t = new Date(now); t.setHours(7, 0, 0, 0);
  if (t.getTime() <= now.getTime() + 3_600_000) t.setDate(t.getDate() + 1);
  return Math.min(10_080, Math.max(60, Math.round((t.getTime() - now.getTime()) / 60_000)));
}
