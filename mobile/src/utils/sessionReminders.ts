import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { StringKey } from '../i18n';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;
export interface SessionSchedule { weekdays: number[]; timeMin: number; remindersOn: boolean }

const supported = Platform.OS !== 'web';
/** Distinct prefix so we never touch the daily / morning / evening reminders owned by utils/reminders.ts. */
export const SESSION_REMINDER_PREFIX = 'nv-sess-';

/** Weekday 0-6 (Sunday = 0) to the Expo weekly trigger weekday (Sunday = 1). */
export const toExpoWeekday = (d: number) => (((d % 7) + 7) % 7) + 1;

/**
 * Replace the weekly session reminders with the ones in `s`. Only notifications whose identifier starts with `nv-sess-` are cancelled.
 * No-op on web. Returns false only when permission was needed and denied.
 * Note: utils/reminders.ts `rescheduleAll` cancels ALL notifications, so call this again after it runs.
 */
export async function syncSessionReminders(s: SessionSchedule, t: T): Promise<boolean> {
  if (!supported) return true;
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of existing) if (n.identifier.startsWith(SESSION_REMINDER_PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    if (!s.remindersOn || s.weekdays.length === 0) return true;
    const cur = await Notifications.getPermissionsAsync();
    if (!cur.granted && !(await Notifications.requestPermissionsAsync()).granted) return false;
    const hour = Math.floor(s.timeMin / 60) % 24, minute = s.timeMin % 60;
    for (const d of s.weekdays) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SESSION_REMINDER_PREFIX}${d}`,
        content: { title: t('appName'), body: t('sessReminderBody') },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: toExpoWeekday(d), hour, minute },
      });
    }
    return true;
  } catch { return false; }
}
