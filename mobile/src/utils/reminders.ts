import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { StringKey } from '../i18n';
import type { SettingsState } from '../store/settings';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;
export type ReminderSettings = Pick<SettingsState, 'reminderEnabled' | 'reminderHour' | 'remMorningOn' | 'remMorningAt' | 'remEveningOn' | 'remEveningAt' | 'remBedOn' | 'remBedAt' | 'quietOn' | 'quietStart' | 'quietEnd' | 'gentleReturn' | 'lastOpenAt'>;

const supported = Platform.OS !== 'web';
const DAILY_ID = 'nv-daily';

/** Is minute-of-day `m` inside the quiet window (which may wrap past midnight)? */
export function inQuiet(m: number, start: number, end: number): boolean {
  return start === end ? false : start < end ? m >= start && m < end : m >= start || m < end;
}
/** Quiet hours shift a reminder to the end of the window (so it still arrives, just later). */
export function shiftQuiet(m: number, s: Pick<ReminderSettings, 'quietOn' | 'quietStart' | 'quietEnd'>): number {
  return s.quietOn && inQuiet(m, s.quietStart, s.quietEnd) ? s.quietEnd : m;
}
export function fmtTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

async function ensurePermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** One optional, local daily reminder. Returns false if the user denied notification permission. */
export async function setDailyReminder(enabled: boolean, hour: number, body: string, title: string): Promise<boolean> {
  if (!supported) return !enabled;
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_ID).catch(() => {});
    if (!enabled) return true;
    if (!(await ensurePermission())) return false;
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_ID,
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: Math.min(23, Math.max(0, hour)), minute: 0 },
    });
    return true;
  } catch { return false; }
}

/**
 * Rebuild every scheduled notification from settings. Call after any change and each time the app opens
 * (opening re-arms the single "gentle return" notice 3 days ahead, which cancels the old one).
 * Returns false only if permission was denied while something needed it.
 */
export async function rescheduleAll(s: ReminderSettings, t: T): Promise<boolean> {
  if (!supported) return true;
  try {
    // Only our own identifiers: wake-window and session reminders belong to other features and must survive.
    for (const id of [DAILY_ID, 'nv-morning', 'nv-evening', 'nv-bed', 'nv-return']) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    const slots: { id: string; at: number; body: StringKey }[] = [];
    if (s.reminderEnabled) slots.push({ id: DAILY_ID, at: s.reminderHour * 60, body: 'reminderText' });
    if (s.remMorningOn) slots.push({ id: 'nv-morning', at: s.remMorningAt, body: 'engMorningBody' });
    if (s.remEveningOn) slots.push({ id: 'nv-evening', at: s.remEveningAt, body: 'engEveningBody' });
    if (s.remBedOn) slots.push({ id: 'nv-bed', at: s.remBedAt, body: 'engBedBody' });
    const returning = s.gentleReturn;
    if (!slots.length && !returning) return true;
    if (!(await ensurePermission())) return false;
    const title = t('appName');
    for (const x of slots) {
      const m = shiftQuiet(x.at, s);
      await Notifications.scheduleNotificationAsync({
        identifier: x.id, content: { title, body: t(x.body) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: Math.floor(m / 60) % 24, minute: m % 60 },
      });
    }
    if (returning) {
      // ONE soft notice, 3 days after the last open, at a gentle late-morning time.
      const m = shiftQuiet(10 * 60, s);
      const d = new Date(s.lastOpenAt || Date.now());
      d.setDate(d.getDate() + 3);
      d.setHours(Math.floor(m / 60) % 24, m % 60, 0, 0);
      if (d.getTime() > Date.now()) {
        await Notifications.scheduleNotificationAsync({
          identifier: 'nv-return', content: { title, body: t('engReturnBody') },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
        });
      }
    }
    return true;
  } catch { return false; }
}
