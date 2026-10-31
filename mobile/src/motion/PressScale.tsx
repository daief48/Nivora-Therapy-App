import React from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { tapHaptic } from './haptics';
import { spring } from './tokens';
import { useReducedMotion } from './useReducedMotion';

const APressable = Animated.createAnimatedComponent(Pressable);

export interface PressScaleProps extends Omit<PressableProps, 'style'> {
  /** Scale while pressed (default 0.97). */
  scaleTo?: number;
  /** Light haptic on press (default true; no-op on web). */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Pressable with a soft spring-scale and optional light haptic. Under reduced motion it dims slightly instead of scaling. */
export function PressScale({ scaleTo = 0.97, haptic = true, style, onPress, onPressIn, onPressOut, disabled, children, ...rest }: PressScaleProps) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const o = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: o.value }));
  return (
    <APressable
      {...rest} disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => { if (!disabled) { if (reduced) o.value = 0.85; else s.value = withSpring(scaleTo, spring.press); } onPressIn?.(e); }}
      onPressOut={(e: GestureResponderEvent) => { if (reduced) o.value = 1; else s.value = withSpring(1, spring.press); onPressOut?.(e); }}
      onPress={onPress ? (e: GestureResponderEvent) => { if (haptic) tapHaptic(); onPress(e); } : undefined}
      style={[style, anim]}
    >
      {children}
    </APressable>
  );
}
