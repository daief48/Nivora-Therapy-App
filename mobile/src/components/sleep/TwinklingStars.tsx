/**
 * TwinklingStars — purely decorative star-dots for the night hero gradient.
 *
 * Each star independently fades in and out at a random pace using Reanimated
 * withRepeat / withSequence on the UI thread. Under reduced motion the stars
 * are rendered at 50% opacity as static dots.
 */
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { easing } from '../../motion/tokens';

interface StarProps {
  x: string;
  y: string;
  r: number;
  delay: number;
  period: number;
}

function Star({ x, y, r, delay, period }: StarProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 0.5 : 0);

  useEffect(() => {
    if (reduced) { opacity.value = 0.5; return; }
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.9, { duration: period * 0.5, easing: easing.breath }),
          withTiming(0.1, { duration: period * 0.5, easing: easing.breath }),
        ),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [reduced, delay, period, opacity]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        anim,
        {
          left: x,
          top: y,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: 'white',
          marginLeft: -r,
          marginTop: -r,
        },
      ]}
    />
  );
}

function seededRandom(seed: number) {
  // Simple deterministic pseudo-random so positions are stable across renders.
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

export function TwinklingStars({ count = 18 }: { count?: number }) {
  const stars = useMemo<StarProps[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: `${(seededRandom(i * 3 + 0) * 90 + 5).toFixed(1)}%`,
        y: `${(seededRandom(i * 3 + 1) * 80 + 5).toFixed(1)}%`,
        r: seededRandom(i * 3 + 2) * 1.4 + 0.7,
        delay: Math.round(seededRandom(i * 7) * 2000),
        period: Math.round(seededRandom(i * 11 + 3) * 2000 + 1800),
      })),
    [count],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stars.map((s, i) => (
        <Star key={i} {...s} />
      ))}
    </View>
  );
}
