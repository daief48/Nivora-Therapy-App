import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { Blossom } from './sakura';
import { Icon } from './ui';

const PETALS = [-66, -34, 0, 34, 66, 0];

/**
 * A tiny "small win": petals drift out and a checkmark blooms (~1.2 s). Increment `play` to trigger it.
 * Non-interactive; with reduced motion it just shows the check briefly, still.
 */
export function Celebrate({ play, size = 72 }: { play: number; size?: number }) {
  const reduced = useSettings((s) => s.reducedMotion);
  const { c } = useTheme();
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!play) return;
    p.setValue(0);
    const a = Animated.timing(p, { toValue: 1, duration: reduced ? 600 : 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [play, reduced, p]);
  if (!play) return null;
  const fade = p.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      {!reduced && PETALS.map((dx, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', opacity: fade,
          transform: [
            { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, dx * 1.6] }) },
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, i === 5 ? -70 : -30 + (i % 2) * 70] }) },
            { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 160}deg`] }) },
          ],
        }}>
          <Blossom size={20 + (i % 3) * 4} deep={i % 2 === 0} />
        </Animated.View>
      ))}
      <Animated.View style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center', opacity: fade,
        transform: [{ scale: reduced ? 1 : p.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [0.3, 1.15, 1, 1] }) }],
      }}>
        <Icon name="checkmark" size={size * 0.55} color="#fff" />
      </Animated.View>
    </View>
  );
}
