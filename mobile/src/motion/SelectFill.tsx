import React, { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration, easing } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** Absolute-fill colour layer whose opacity eases with `on`; gives Chip/Segmented smooth selected-state transitions. Place inside a clipped, rounded parent. */
export function SelectFill({ on, color, radius }: { on: boolean; color: string; radius?: number }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(on ? 1 : 0);
  useEffect(() => { o.value = reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: duration.base, easing: easing.inOut }); }, [on, reduced, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color, borderRadius: radius }, style]} />;
}
