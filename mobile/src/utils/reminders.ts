import * as Notifications from 'expo-notifications';

/** One optional, local daily reminder. Returns false if the user denied notification permission. */
export async function setDailyReminder(enabled: boolean, hour: number, body: string, title: string): Promise<boolean> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!enabled) return true;
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: Math.min(23, Math.max(0, hour)), minute: 0 },
    });
    return true;
  } catch { return false; }
}
