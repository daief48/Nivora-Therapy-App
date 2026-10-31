import { Platform } from 'react-native';
import type { ActivityDay, HealthSource, SleepNight } from '../api/health';
import { localDateStr, nightsFromSessions, sessionsFromSleepSamples } from './healthData';

/**
 * Thin adapter over the native health libraries. They are required lazily inside try/catch so Expo Go, web and Jest never crash:
 * when the native module is missing `getHealthAdapter()` returns null and the UI falls back to manual entry.
 * Needs a development or production build (react-native-health-connect on Android, @kingstinct/react-native-healthkit on iOS).
 */
export type Availability = 'ready' | 'needs_app' | 'unavailable';
export interface HealthAdapter {
  source: HealthSource;
  availability(): Promise<Availability>;
  /** Asks the OS for read permission. Resolves true only if it was granted. */
  request(): Promise<boolean>;
  read(days: number): Promise<{ sleep: SleepNight[]; activity: ActivityDay[] }>;
}

const DAY = 86_400_000;
const localDay = (d: Date): Date => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function healthConnect(): HealthAdapter | null {
  let hc: any;
  try { hc = require('react-native-health-connect'); } catch { return null; }
  if (!hc || typeof hc.initialize !== 'function') return null;
  return {
    source: 'healthconnect',
    async availability() {
      try {
        const status = await hc.getSdkStatus();
        return status === hc.SdkAvailabilityStatus?.SDK_AVAILABLE ? 'ready' : 'needs_app';
      } catch { return 'unavailable'; }
    },
    async request() {
      if (!(await hc.initialize())) return false;
      const granted: { recordType: string }[] = await hc.requestPermission([{ accessType: 'read', recordType: 'SleepSession' }, { accessType: 'read', recordType: 'Steps' }]);
      return (granted ?? []).some((g) => g.recordType === 'SleepSession');
    },
    async read(days) {
      await hc.initialize();
      const end = new Date(), start = new Date(end.getTime() - days * DAY);
      const timeRangeFilter = { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() };
      let sleep: SleepNight[] = [];
      try {
        const res = await hc.readRecords('SleepSession', { timeRangeFilter, pageSize: 500 });
        sleep = nightsFromSessions((res?.records ?? []).map((r: any) => ({
          start: r.startTime, end: r.endTime,
          // Health Connect stage 1 = awake, 7 = awake in bed.
          awakenings: (r.stages ?? []).filter((s: any) => s.stage === 1 || s.stage === 7).length,
        })));
      } catch { sleep = []; }
      const activity: ActivityDay[] = [];
      try {
        const groups = await hc.aggregateGroupByPeriod({
          recordType: 'Steps',
          timeRangeFilter: { operator: 'between', startTime: localDay(start).toISOString(), endTime: end.toISOString() },
          timeRangeSlicer: { period: 'DAYS', length: 1 },
        });
        for (const g of groups ?? []) {
          const steps = Math.round(g?.result?.COUNT_TOTAL ?? 0);
          if (steps > 0) activity.push({ date: localDateStr(new Date(g.startTime)), steps: Math.min(200_000, steps) });
        }
      } catch { /* steps are optional */ }
      return { sleep, activity };
    },
  };
}

function healthKit(): HealthAdapter | null {
  let hk: any;
  try { hk = require('@kingstinct/react-native-healthkit'); } catch { return null; }
  if (!hk || typeof hk.requestAuthorization !== 'function') return null;
  const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis', STEPS = 'HKQuantityTypeIdentifierStepCount';
  return {
    source: 'healthkit',
    async availability() {
      try { return (await hk.isHealthDataAvailableAsync()) ? 'ready' : 'unavailable'; } catch { return 'unavailable'; }
    },
    async request() {
      // HealthKit never reveals whether read access was granted; an empty read is handled by the caller.
      return !!(await hk.requestAuthorization({ toRead: [SLEEP, STEPS] }));
    },
    async read(days) {
      const end = new Date(), start = new Date(end.getTime() - days * DAY);
      let sleep: SleepNight[] = [];
      try {
        const samples = await hk.queryCategorySamples(SLEEP, { limit: -1, ascending: true, filter: { date: { startDate: start, endDate: end } } });
        sleep = nightsFromSessions(sessionsFromSleepSamples((samples ?? []).map((s: any) => ({ start: s.startDate, end: s.endDate, value: Number(s.value) }))));
      } catch { sleep = []; }
      const activity: ActivityDay[] = [];
      for (let i = 0; i < Math.min(days, 30); i++) {
        const dayStart = localDay(new Date(end.getTime() - i * DAY));
        const dayEnd = i === 0 ? end : new Date(dayStart.getTime() + DAY);
        try {
          const st = await hk.queryStatisticsForQuantity(STEPS, ['cumulativeSum'], { unit: 'count', filter: { date: { startDate: dayStart, endDate: dayEnd } } });
          const steps = Math.round(st?.sumQuantity?.quantity ?? 0);
          if (steps > 0) activity.push({ date: localDateStr(dayStart), steps: Math.min(200_000, steps) });
        } catch { /* steps are optional */ }
      }
      return { sleep, activity: activity.reverse() };
    },
  };
}

/** The adapter for this platform, or null in Expo Go, on web, in Jest, or when the native module is not linked. */
export function getHealthAdapter(): HealthAdapter | null {
  try {
    if (Platform.OS === 'android') return healthConnect();
    if (Platform.OS === 'ios') return healthKit();
  } catch { /* fall through */ }
  return null;
}
