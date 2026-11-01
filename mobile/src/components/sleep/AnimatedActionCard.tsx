/**
 * AnimatedActionCard — action tiles for the Sleepify hub.
 *
 * Requirements:
 *  - Staggered entrance (slide-up + fade, 60ms delay per index)
 *  - Press feedback: spring scale 0.96 -> 1 + light haptic
 *  - Per-icon micro animations:
 *      * pencil (create-outline): subtle tilt / write wiggle
 *      * moon (moon-outline): breathing glow pulse
 *      * music notes (musical-notes-outline): floating note oscillation
 *      * rain (rainy-outline): subtle drip ripple / bounce
 *  - Soft gradient tint per card instead of flat white
 *  - UI-thread animations via Reanimated worklets; falls back cleanly under reduced motion
 */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { FadeInUp } from '../../motion/FadeInUp';
import { PressScale } from '../../motion/PressScale';
import { duration, easing, spring } from '../../motion/tokens';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { radius, space, useTheme } from '../../theme';
import { AppText, Icon, type IconName } from '../ui';

export interface ActionCardItem {
  icon: IconName;
  label: string;
  tone: 0 | 1 | 2 | 3;
  onPress: () => void;
}

interface AnimatedActionCardProps {
  item: ActionCardItem;
  index: number;
}

// ─── Soft gradient tints per tone ─────────────────────────────────────────────
const TINT_GRADIENTS: Record<0 | 1 | 2 | 3, { light: [string, string]; dark: [string, string] }> = {
  // 0: Blossom / Peach (Log sleep)
  0: { light: ['#FFF0F4', '#FDE7ED'], dark: ['#3A242B', '#2D1B22'] },
  // 1: Sage / Lavender (Routine)
  1: { light: ['#EEF5EE', '#E3ECE3'], dark: ['#223225', '#1B271E'] },
  // 2: Lavender / Periwinkle (Stories)
  2: { light: ['#F2EDFC', '#E7DEF7'], dark: ['#2C253C', '#221D30'] },
  // 3: Warm Sand / Cream (Sounds)
  3: { light: ['#FDF6EA', '#F6ECE0'], dark: ['#382F22', '#2B2419'] },
};

const ICON_TINT_COLORS: Record<0 | 1 | 2 | 3, { light: string; dark: string }> = {
  0: { light: '#B34A6A', dark: '#F49DB5' },
  1: { light: '#46664C', dark: '#9AC4A1' },
  2: { light: '#6A569A', dark: '#C3B3EA' },
  3: { light: '#8F6B2E', dark: '#E7C88E' },
};

/** Micro-animated icon badge */
function AnimatedCardIcon({ icon, tone }: { icon: IconName; tone: 0 | 1 | 2 | 3 }) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const iconColor = ICON_TINT_COLORS[tone][isDark ? 'dark' : 'light'];

  // Animations
  const rot = useSharedValue(0);
  const transY = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;

    if (icon === 'create-outline') {
      // Pencil tilt animation (writing wiggle)
      rot.value = withRepeat(
        withSequence(
          withTiming(-8, { duration: 900, easing: easing.inOut }),
          withTiming(6, { duration: 900, easing: easing.inOut }),
          withTiming(0, { duration: 600, easing: easing.inOut }),
          withDelay(1200, withTiming(0, { duration: 100 })),
        ),
        -1,
        true,
      );
    } else if (icon === 'moon-outline') {
      // Moon glow pulse
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.16, { duration: 1600, easing: easing.breath }),
          withTiming(1.0, { duration: 1600, easing: easing.breath }),
        ),
        -1,
        true,
      );
    } else if (icon === 'musical-notes-outline') {
      // Floating note (up and down)
      transY.value = withRepeat(
        withSequence(
          withTiming(-4, { duration: 1200, easing: easing.inOut }),
          withTiming(3, { duration: 1200, easing: easing.inOut }),
        ),
        -1,
        true,
      );
    } else if (icon === 'rainy-outline') {
      // Gentle drop bounce
      transY.value = withRepeat(
        withSequence(
          withTiming(3, { duration: 600, easing: easing.out }),
          withTiming(-1, { duration: 700, easing: easing.inOut }),
          withDelay(800, withTiming(0, { duration: 300 })),
        ),
        -1,
        false,
      );
    }

    return () => {
      cancelAnimation(rot);
      cancelAnimation(transY);
      cancelAnimation(pulse);
    };
  }, [icon, reduced, rot, transY, pulse]);

  const iconAnim = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rot.value}deg` },
      { translateY: transY.value },
    ],
  }));

  const glowAnim = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: 0.35 / pulse.value,
  }));

  return (
    <View style={styles.iconContainer}>
      {/* Glow halo for moon */}
      {icon === 'moon-outline' && !reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glowHalo,
            { backgroundColor: iconColor },
            glowAnim,
          ]}
        />
      ) : null}

      <Animated.View style={iconAnim}>
        <Icon name={icon} size={24} color={iconColor} />
      </Animated.View>
    </View>
  );
}

export function AnimatedActionCard({ item, index }: AnimatedActionCardProps) {
  const { isDark, shadow } = useTheme();
  const gradient = TINT_GRADIENTS[item.tone][isDark ? 'dark' : 'light'];

  return (
    <FadeInUp delay={index * 60} distance={16}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={item.label}
        onPress={item.onPress}
        scaleTo={0.96}
        haptic={true}
        style={[styles.pressable, shadow('sm')]}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          <AnimatedCardIcon icon={item.icon} tone={item.tone} />
          <AppText
            size={13}
            weight="700"
            numberOfLines={2}
            style={styles.label}
          >
            {item.label}
          </AppText>
        </LinearGradient>
      </PressScale>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: 126,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cardGradient: {
    padding: 14,
    borderRadius: radius.lg,
    gap: 12,
    alignItems: 'flex-start',
    minHeight: 104,
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  glowHalo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  label: {
    lineHeight: 18,
  },
});

