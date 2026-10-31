import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { successHaptic, useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { Blossom } from './sakura';
import { Icon } from './ui';

const PETALS = [-66, -34, 0, 34, 66, 0];
const BURST = [-90, -62, -34, -8, 20, 48, 76, 100];

export type CelebrateVariant = 'check' | 'petals' | 'glow';

/**
 * A tiny "small win" (always under 1.2 s). Increment `play` to trigger it. Non-interactive.
 * - 'check' (default): petals drift out and a checkmark blooms. With reduced motion the check just shows, still.
 * - 'petals': a soft petal burst, no badge.
 * - 'glow': a warm ring of light that swells and fades behind a small check.
 * The 'petals' and 'glow' variants are skipped entirely under reduced motion.
 */
export function Celebrate({ play, size = 72, variant = 'check', haptic = false }: { play: number; size?: number; variant?: CelebrateVariant; haptic?: boolean }) {
  const reduced = useReducedMotion();
  const { c } = useTheme();
  const p = useRef(new Animated.Value(0)).current;
  const skip = reduced && variant !== 'check';
  useEffect(() => {
    if (!play || skip) return;
    if (haptic) successHaptic();
    p.setValue(0);
    const a = Animated.timing(p, { toValue: 1, duration: reduced ? 600 : variant === 'check' ? 1200 : 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [play, reduced, skip, variant, haptic, p]);
  if (!play || skip) return null;
  const fade = p.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const petals = variant === 'petals' ? BURST : PETALS;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      {variant === 'glow' ? (
        <Animated.View style={{
          position: 'absolute', width: size * 2, height: size * 2, borderRadius: size, backgroundColor: c.petal,
          opacity: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.55, 0] }),
          transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.2] }) }],
        }} />
      ) : null}
      {!reduced && variant !== 'glow' && petals.map((dx, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', opacity: fade,
          transform: [
            { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, variant === 'petals' ? dx * 1.2 : dx * 1.6] }) },
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, variant === 'petals' ? -50 + (i % 3) * 38 : i === 5 ? -70 : -30 + (i % 2) * 70] }) },
            { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 160}deg`] }) },
          ],
        }}>
          <Blossom size={20 + (i % 3) * 4} deep={i % 2 === 0} />
        </Animated.View>
      ))}
      {variant === 'petals' ? null : (
        <Animated.View style={{
          width: variant === 'glow' ? size * 0.7 : size, height: variant === 'glow' ? size * 0.7 : size, borderRadius: size / 2, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center', opacity: fade,
          transform: [{ scale: reduced ? 1 : p.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [0.3, 1.15, 1, 1] }) }],
        }}>
          <Icon name="checkmark" size={(variant === 'glow' ? size * 0.7 : size) * 0.55} color="#fff" />
        </Animated.View>
      )}
    </View>
  );
}

/** Returns a counter that ticks each time `done` turns true; pass it to <Celebrate play=...>. Ties a celebration to a completed action. */
export function useCelebrateOnComplete(done: boolean): number {
  const [n, setN] = React.useState(0);
  const was = useRef(done);
  useEffect(() => { if (done && !was.current) setN((v) => v + 1); was.current = done; }, [done]);
  return n;
}
