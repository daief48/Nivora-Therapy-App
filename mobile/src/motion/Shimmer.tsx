import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { easing } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** Loading placeholder with a soft light sweep. A still block under reduced motion. */
export function Shimmer({ height = 16, width = '100%', radius = 10, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { c, isDark } = useTheme();
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduced || !w) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1400, easing: easing.inOut }), -1, false);
    return () => cancelAnimation(x);
  }, [reduced, w, x]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -w + x.value * w * 2 }] }));
  const glow = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.65)';
  return (
    <View accessible={false} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={[{ height, width, borderRadius: radius, backgroundColor: c.cardAlt, overflow: 'hidden' }, style]}>
      {reduced || !w ? null : (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: w }, sweep]}>
          <LinearGradient colors={['transparent', glow, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
        </Animated.View>
      )}
    </View>
  );
}
