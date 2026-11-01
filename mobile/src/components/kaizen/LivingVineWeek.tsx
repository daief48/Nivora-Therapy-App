import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { AppText, Card, Row } from '../ui';
import { radius, useTheme } from '../../theme';

export interface WeekDayItem {
  date: string;
  status: string | null;
}

interface LivingVineWeekProps {
  days: WeekDayItem[];
  focusDay?: number;
  onSelectDay?: (day: WeekDayItem) => void;
}

function BlossomIcon({ status, isToday }: { status: string | null; isToday: boolean }) {
  const isDone = status === 'DONE' || status === 'PARTIAL';
  const isSkipped = status === 'SKIPPED';

  if (isDone) {
    return (
      <Svg width={36} height={36} viewBox="0 0 36 36">
        <G transform="translate(18, 18)">
          {[0, 72, 144, 216, 288].map((angle, i) => (
            <G key={i} transform={`rotate(${angle})`}>
              <Path
                d="M 0 0 C -4 -7, -4 -12, 0 -15 C 4 -12, 4 -7, 0 0 Z"
                fill="#FF9EBE"
                stroke="#FF6F98"
                strokeWidth="1"
              />
            </G>
          ))}
          <Circle cx="0" cy="0" r="3.5" fill="#FFE082" />
        </G>
      </Svg>
    );
  }

  if (isSkipped) {
    return (
      <Svg width={36} height={36} viewBox="0 0 36 36">
        <G transform="translate(18, 18)">
          {/* Gentle resting leaf */}
          <Path
            d="M -10 6 C -4 -4, 4 -8, 12 -4 C 10 4, 4 8, -10 6 Z"
            fill="#B8C5B4"
            opacity={0.8}
          />
          <Circle cx="0" cy="0" r="2.5" fill="#9DAA98" />
        </G>
      </Svg>
    );
  }

  // Future or quiet bud
  return (
    <Svg width={36} height={36} viewBox="0 0 36 36">
      <Circle cx="18" cy="18" r="7" fill={isToday ? '#E2C2D0' : '#E8E4EA'} />
      <Circle cx="18" cy="18" r="3.5" fill={isToday ? '#A35372' : '#C0BAC4'} />
    </Svg>
  );
}

export function LivingVineWeek({ days, focusDay, onSelectDay }: LivingVineWeekProps) {
  const { c, isDark } = useTheme();

  return (
    <Card style={[styles.container, { backgroundColor: isDark ? '#231B27' : '#FCF8FA' }]}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <AppText size={12} weight="700" style={{ color: c.accent, letterSpacing: 0.8 }}>
          🌿 LIVING GARDEN VINE
        </AppText>
        <AppText size={11} muted>
          {days.filter((d) => d.status === 'DONE' || d.status === 'PARTIAL').length}/7 প্রস্ফুটিত
        </AppText>
      </Row>

      {/* Decorative Vine Connector Line */}
      <View style={styles.vineTrack}>
        <Svg width="100%" height={16} viewBox="0 0 300 16" preserveAspectRatio="none">
          <Path
            d="M 10 8 Q 80 2, 150 8 T 290 8"
            stroke={isDark ? '#463A4D' : '#E3D7DE'}
            strokeWidth="2.5"
            strokeDasharray="4,4"
            fill="none"
          />
        </Svg>
      </View>

      <Row style={styles.daysRow}>
        {days.map((d) => {
          const dt = new Date(`${d.date}T12:00:00`);
          const isFocus = typeof focusDay === 'number' && dt.getDay() === focusDay;
          const weekdayLabel = dt.toLocaleDateString(undefined, { weekday: 'narrow' });

          return (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityLabel={`${d.date}: ${d.status ?? 'planned'}`}
              onPress={() => onSelectDay?.(d)}
              style={[
                styles.dayNode,
                isFocus && {
                  borderWidth: 1.5,
                  borderColor: c.primary,
                  borderRadius: radius.md,
                  backgroundColor: isDark ? '#36283C' : '#FFF0F5',
                },
              ]}
            >
              <BlossomIcon status={d.status} isToday={isFocus} />
              <AppText
                size={12}
                weight={isFocus ? '800' : '600'}
                style={{ color: isFocus ? c.primary : c.textMuted }}
              >
                {weekdayLabel}
              </AppText>
            </Pressable>
          );
        })}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    gap: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F0DFE7',
  },
  vineTrack: {
    height: 10,
    justifyContent: 'center',
    marginVertical: -4,
  },
  daysRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayNode: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
});

