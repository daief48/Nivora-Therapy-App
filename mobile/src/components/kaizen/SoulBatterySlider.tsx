import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Icon, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

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

  const options: { id: EnergyLevel; pct: number; labelKey: 'kzBatteryLow' | 'kzBatteryMed' | 'kzBatteryHigh'; icon: string }[] = [
    { id: 'LOW', pct: 20, labelKey: 'kzBatteryLow', icon: 'battery-dead-outline' },
    { id: 'MED', pct: 50, labelKey: 'kzBatteryMed', icon: 'battery-half-outline' },
    { id: 'HIGH', pct: 90, labelKey: 'kzBatteryHigh', icon: 'battery-full-outline' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#211B24' : '#FDF7F8', borderColor: c.border }]}>
      <Row style={styles.headerRow}>
        <Row style={{ gap: 6 }}>
          <Icon name="flash-outline" size={16} color={c.accent} />
          <AppText size={13} weight="700" style={{ color: c.accent }}>{t('kzSoulBattery')}</AppText>
        </Row>
        <AppText size={12} muted>{level === 'LOW' ? '20%' : level === 'MED' ? '50%' : '90%'}</AppText>
      </Row>

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

      {/* The Alchemize Button Emerges on Low Energy */}
      {level === 'LOW' && onAlchemize ? (
        <View style={styles.alchemizeBox}>
          <Button
            title={isAlchemizing ? t('kzAlchemizing') : t('kzAlchemizeBtn')}
            variant="secondary"
            loading={isAlchemizing}
            onPress={onAlchemize}
            accessibilityLabel={t('kzAlchemizeBtn')}
          />
        </View>
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

