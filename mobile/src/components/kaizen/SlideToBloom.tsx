import React from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { PressScale } from '../../motion';
import { AppText, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface SlideToBloomProps {
  onComplete: () => void;
  disabled?: boolean;
}

export function SlideToBloom({ onComplete, disabled }: SlideToBloomProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  const glowScale = useSharedValue(1);
  const rippleOpacity = useSharedValue(0);

  const handlePress = async () => {
    if (disabled) return;
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // quiet fallback
    }

    glowScale.value = withSequence(
      withSpring(0.94, { damping: 10, stiffness: 200 }),
      withSpring(1.04, { damping: 12, stiffness: 150 }),
      withSpring(1.0, { damping: 14, stiffness: 100 }),
    );

    rippleOpacity.value = withSequence(
      withTiming(0.4, { duration: 150 }),
      withTiming(0, { duration: 400 }),
    );

    onComplete();
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
  }));

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: rippleOpacity.value,
  }));

  return (
    <Animated.View style={[styles.wrapper, animStyle]}>
      {/* Ripple background aura */}
      <Animated.View
        style={[
          styles.rippleAura,
          rippleStyle,
          { backgroundColor: c.accent },
        ]}
        pointerEvents="none"
      />

      <PressScale
        accessibilityRole="button"
        accessibilityLabel={t('kzDid')}
        disabled={disabled}
        onPress={handlePress}
        style={[
          styles.bloomButton,
          {
            backgroundColor: isDark ? '#4D2A3D' : '#FFEBF2',
            borderColor: '#FFA5C5',
          },
        ]}
      >
        <Row style={{ gap: 10, alignItems: 'center', justifyContent: 'center' }}>
          <AppText size={20}>🌸</AppText>
          <AppText size={17} weight="800" style={{ color: c.accent }}>
            {t('kzDid')}
          </AppText>
          <AppText size={15} muted style={{ color: c.accent }}>
            ✨
          </AppText>
        </Row>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    position: 'relative',
    marginVertical: 4,
  },
  rippleAura: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
  },
  bloomButton: {
    minHeight: 54,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: '#FF6B9E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
});
