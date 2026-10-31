import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const native = Platform.OS === 'ios' || Platform.OS === 'android';

/** Light tap. No-op on web and never throws (devices without a haptic engine just stay quiet). */
export function tapHaptic(): void {
  if (!native) return;
  try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch { /* ignore */ }
}

/** Soft "well done" tap for completed actions. */
export function successHaptic(): void {
  if (!native) return;
  try { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } catch { /* ignore */ }
}
