import React, { useEffect, useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useT, type StringKey } from '../i18n';
import { useTheme } from '../theme';
import { easing } from './tokens';
import { useReducedMotion } from './useReducedMotion';

export type BreathPhase = 'inhale' | 'hold' | 'exhale' | 'rest';
const LABEL: Record<BreathPhase, StringKey> = { inhale: 'mBreatheIn', hold: 'mBreatheHold', exhale: 'mBreatheOut', rest: 'mBreatheRest' };
const MIN: number = 0.62, MAX: number = 1;

/**
 * A soft orb that swells on the in-breath, rests, and settles on the out-breath. Timings are milliseconds.
 * Pass `level` (0..1, e.g. voice or audio loudness) to drive the size directly instead of the timed cycle.
 * Under reduced motion the orb stays still and only the phase word changes.
 */
export function BreathingOrb({ inhale = 4000, hold = 2000, exhale = 6000, rest = 0, level, running = true, size = 180, showLabel = true, onPhase, style }: {
  inhale?: number; hold?: number; exhale?: number; rest?: number; level?: number; running?: boolean; size?: number; showLabel?: boolean;
  onPhase?: (p: BreathPhase) => void; style?: StyleProp<ViewStyle>;
}) {
  const { c, text } = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const k = useSharedValue(MIN);
  const [phase, setPhase] = useState<BreathPhase>('rest');
  const external = typeof level === 'number';

  // Timed cycle: scale runs on the UI thread, the phase word on a JS timer.
  useEffect(() => {
    if (external || !running) {
      setPhase('rest');
      cancelAnimation(k);
      if (!external) k.value = MIN; // stopped: settle the orb back instead of freezing mid-breath (an external level drives it itself)
      return;
    }
    if (!reduced) {
      const seq = [withTiming(MAX, { duration: inhale, easing: easing.breath })];
      if (hold > 0) seq.push(withTiming(MAX, { duration: hold }));
      seq.push(withTiming(MIN, { duration: exhale, easing: easing.breath }));
      if (rest > 0) seq.push(withTiming(MIN, { duration: rest }));
      k.value = MIN;
      k.value = withRepeat(withSequence(...seq), -1, false);
    }
    const steps: [BreathPhase, number][] = [['inhale', inhale]];
    if (hold > 0) steps.push(['hold', hold]);
    steps.push(['exhale', exhale]);
    if (rest > 0) steps.push(['rest', rest]);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    // Phases are scheduled against absolute deadlines (start + cumulative durations), so late timers do not accumulate
    // and the word/haptic stay in step with the UI-thread animation over minutes.
    let due = Date.now();
    const next = () => {
      const [p, ms] = steps[i % steps.length];
      setPhase(p); onPhase?.(p);
      i += 1;
      due += ms;
      timer = setTimeout(next, Math.max(0, due - Date.now()));
    };
    next();
    return () => { clearTimeout(timer); cancelAnimation(k); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, running, reduced, inhale, hold, exhale, rest]);

  // External level: ease toward it quickly so audio-reactive use feels fluid, not jittery.
  useEffect(() => {
    if (!external) return;
    const l = Math.max(0, Math.min(1, level as number));
    k.value = reduced ? (MIN + MAX) / 2 : withTiming(MIN + (MAX - MIN) * l, { duration: 120 });
  }, [external, level, reduced, k]);

  const orb = useAnimatedStyle(() => ({ transform: [{ scale: k.value }], opacity: 0.55 + 0.45 * k.value }));
  const halo = useAnimatedStyle(() => ({ transform: [{ scale: 0.9 + k.value * 0.55 }], opacity: 0.18 + 0.2 * k.value }));
  const word = external ? null : t(LABEL[phase]);
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={word ?? t('mBreatheOrb')} accessibilityLiveRegion="polite" style={[{ width: size * 1.5, height: size * 1.5, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: c.petal }, reduced ? { opacity: 0.25 } : halo]} />
      <Animated.View pointerEvents="none" style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.petalDeep }, reduced ? { transform: [{ scale: 0.81 }], opacity: 0.85 } : orb]} />
      {showLabel && word ? <Text style={[text(17, '700'), { position: 'absolute' }]}>{word}</Text> : null}
    </View>
  );
}
