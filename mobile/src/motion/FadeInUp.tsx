import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { duration, easing } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** Fades children in while they drift up a few pixels. Opacity and transform only; static under reduced motion. */
export function FadeInUp({ children, delay = 0, distance = 14, ms = duration.slow, style }: {
  children: React.ReactNode; delay?: number; distance?: number; ms?: number; style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { p.value = 1; return; }
    p.value = withDelay(delay, withTiming(1, { duration: ms, easing: easing.out }));
  }, [reduced, delay, ms, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * distance }] }));
  if (reduced) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Wraps each child in FadeInUp with a small cascading delay. Delay is capped so long lists never feel slow. */
export function Stagger({ children, step = 60, maxSteps = 8, distance, style }: {
  children: React.ReactNode; step?: number; maxSteps?: number; distance?: number; style?: StyleProp<ViewStyle>;
}) {
  const items = React.Children.toArray(children);
  return (
    <>
      {items.map((child, i) => (
        <FadeInUp key={(child as React.ReactElement)?.key ?? i} delay={Math.min(i, maxSteps) * step} distance={distance} style={style}>{child}</FadeInUp>
      ))}
    </>
  );
}
