/**
 * Target loudness (0..1) for the call orb. The app has no raw mic metering (expo-speech-recognition exposes none here),
 * so unless real playback energy is available (web live path) the level is derived from the call phase and eased by the caller.
 */
export function orbTarget(p: { active: boolean; speaking: boolean; listening: boolean; thinking: boolean; energy?: number }): number {
  if (!p.active) return 0.1;
  if (p.speaking) return typeof p.energy === 'number' && p.energy > 0 ? Math.min(1, 0.3 + p.energy * 0.9) : 0.7;
  if (p.listening) return 0.4;
  if (p.thinking) return 0.2;
  return 0.12;
}

/** One easing step toward the target, so level changes glide instead of jumping. */
export function easeLevel(cur: number, target: number, k = 0.25): number {
  const n = cur + (target - cur) * k;
  return Math.abs(n - target) < 0.01 ? target : n;
}
