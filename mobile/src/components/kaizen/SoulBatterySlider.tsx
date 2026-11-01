import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AppText, Button, Icon, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';
import { useSettings } from '../../store/settings';

export type EnergyLevel = 'LOW' | 'MED' | 'HIGH';

interface SoulBatterySliderProps {
  level: EnergyLevel;
  onChangeLevel: (level: EnergyLevel) => void;
  onAlchemize?: () => void;
  isAlchemizing?: boolean;
}

export function SoulBatterySlider({
  level,
  onChangeLevel,
  onAlchemize,
  isAlchemizing = false,
}: SoulBatterySliderProps) {
  const t = useT();
  const { c, isDark } = useTheme();
  const reducedMotion = useSettings((s) => s.reducedMotion);

  const options: { id: EnergyLevel; pct: number; labelKey: 'kzBatteryLow' | 'kzBatteryMed' | 'kzBatteryHigh'; icon: string }[] = [
    { id: 'LOW', pct: 20, labelKey: 'kzBatteryLow', icon: 'battery-dead-outline' },
    { id: 'MED', pct: 50, labelKey: 'kzBatteryMed', icon: 'battery-half-outline' },
    { id: 'HIGH', pct: 90, labelKey: 'kzBatteryHigh', icon: 'battery-full-outline' },
  ];

  // Fluid energy bar fill width percentage
  const fillWidth = useSharedValue(level === 'LOW' ? 20 : level === 'MED' ? 50 : 90);
  const shimmerPulse = useSharedValue(1);

  useEffect(() => {
    const target = level === 'LOW' ? 20 : level === 'MED' ? 50 : 90;
    fillWidth.value = reducedMotion ? target : withSpring(target, { damping: 14, stiffness: 120 });

    if (level === 'LOW' && !reducedMotion) {
      shimmerPulse.value = withRepeat(
        withSequence(withTiming(1.03, { duration: 800 }), withTiming(0.98, { duration: 800 })),
        -1,
        true,
      );
    } else {
      shimmerPulse.value = 1;
    }
  }, [level, reducedMotion, fillWidth, shimmerPulse]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillWidth.value}%`,
  }));

  const buttonShimmerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shimmerPulse.value }],
  }));

  const barColor = level === 'LOW' ? '#FF7A90' : level === 'MED' ? '#5A9E75' : '#E6A73A';

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#211B24' : '#FDF7F8', borderColor: c.border }]}>
      <Row style={styles.headerRow}>
        <Row style={{ gap: 6 }}>
          <Icon name="flash-outline" size={16} color={c.accent} />
          <AppText size={13} weight="700" style={{ color: c.accent }}>{t('kzSoulBattery')}</AppText>
        </Row>
        <AppText size={12} muted>{level === 'LOW' ? '20%' : level === 'MED' ? '50%' : '90%'}</AppText>
      </Row>

      {/* Fluid Energy Progress Bar */}
      <View style={[styles.energyBarTrack, { backgroundColor: isDark ? '#2C2330' : '#EFE7EC' }]}>
        <Animated.View style={[styles.energyBarFill, { backgroundColor: barColor }, fillStyle]} />
      </View>

      {/* Segmented Level Selector */}
      <View style={[styles.track, { backgroundColor: isDark ? '#2E2633' : '#F1E8EC' }]}>
        {options.map((opt) => {
          const selected = level === opt.id;
          return (
            <Pressable
              key={opt.id}
              accessibilityRole="button"
              accessibilityLabel={t(opt.labelKey)}
              accessibilityState={{ selected }}
              onPress={() => onChangeLevel(opt.id)}
              style={[
                styles.segment,
                selected && {
                  backgroundColor: opt.id === 'LOW' ? (isDark ? '#5C2D35' : '#FFEBEF') : c.card,
                  borderColor: opt.id === 'LOW' ? c.accent : c.primary,
                  borderWidth: 1.5,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.08,
                  shadowRadius: 4,
                  elevation: 2,
                },
              ]}
            >
              <Row style={{ gap: 4, justifyContent: 'center' }}>
                <AppText size={15}>{opt.id === 'LOW' ? '🥀' : opt.id === 'MED' ? '🌿' : '✨'}</AppText>
                <AppText size={12} weight={selected ? '800' : '600'} style={{ color: selected ? (opt.id === 'LOW' ? c.accent : c.primary) : c.textMuted }}>
                  {opt.id === 'LOW' ? '10-20%' : opt.id === 'MED' ? '50%' : '90%'}
                </AppText>
              </Row>
            </Pressable>
          );
        })}
      </View>

      {/* Description of current energy level */}
      <AppText size={13} muted style={{ textAlign: 'center', marginTop: 2 }}>
        {t(options.find((o) => o.id === level)!.labelKey)}
      </AppText>

      {/* The Alchemize Button Emerges on Low Energy with Shimmer Glow */}
      {level === 'LOW' && onAlchemize ? (
        <Animated.View style={[styles.alchemizeBox, buttonShimmerStyle]}>
          <Button
            title={isAlchemizing ? t('kzAlchemizing') : t('kzAlchemizeBtn')}
            variant="secondary"
            loading={isAlchemizing}
            onPress={onAlchemize}
            accessibilityLabel={t('kzAlchemizeBtn')}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 10,
  },
  headerRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  energyBarTrack: {
    height: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    width: '100%',
  },
  energyBarFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  track: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.md,
    gap: 6,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alchemizeBox: {
    marginTop: 4,
  },
});
