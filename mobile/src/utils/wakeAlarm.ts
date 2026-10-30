import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Gentle wake window: soft daily notifications every 5 minutes inside the window.
 * This is a notification, NOT a guaranteed alarm: silent mode, Focus/DND and OS battery rules can mute it.
 * Ids are stored separately so we never call cancelAllScheduledNotificationsAsync (that would drop the daily reminder).
 */
const KEY = 'nivora-wake-v1';
export interface WakeSettings { enabled: boolean; hour: number; minute: number; window: 0 | 15 | 30 }
export const WAKE_DEFAULT: WakeSettings = { enabled: false, hour: 7, minute: 0, window: 15 };

export async function loadWake(): Promise<WakeSettings> {
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) return { ...WAKE_DEFAULT, ...(JSON.parse(raw).settings ?? {}) }; } catch { /* */ }
  return WAKE_DEFAULT;
}

async function cancelOld() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const ids: string[] = raw ? JSON.parse(raw).ids ?? [] : [];
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  } catch { /* */ }
}

/** Replaces any previous wake window. Returns false if notifications are unavailable or permission was denied. */
export async function setWakeWindow(s: WakeSettings, title: string, bodies: string[]): Promise<boolean> {
  try {
    await cancelOld();
    const ids: string[] = [];
    if (s.enabled) {
      if (Platform.OS === 'web') return false;
      const perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) { await AsyncStorage.setItem(KEY, JSON.stringify({ settings: { ...s, enabled: false }, ids })); return false; }
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('wake', { name: 'Gentle wake', importance: Notifications.AndroidImportance.DEFAULT, vibrationPattern: [0, 120], sound: 'default' }).catch(() => {});
      }
      const steps = s.window / 5;
      for (let i = 0; i <= steps; i++) {
        const total = s.hour * 60 + s.minute + i * 5;
        ids.push(await Notifications.scheduleNotificationAsync({
          content: { title, body: bodies[Math.min(i, bodies.length - 1)] ?? title, sound: true },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: Math.floor(total / 60) % 24, minute: total % 60, ...(Platform.OS === 'android' ? { channelId: 'wake' } : {}) },
        }));
      }
    }
    await AsyncStorage.setItem(KEY, JSON.stringify({ settings: s, ids }));
    return true;
  } catch { return false; }
}
