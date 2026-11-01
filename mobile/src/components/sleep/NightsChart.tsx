/**
 * NightsChart — 7-day sleep duration/score bar chart.
 *
 * Requirements:
 *  - 7-day bar chart with smooth grow-in entrance animation
 *  - Moon-phase streak indicator at the top
 *  - "Best night" badge for the highest-performing night
 *  - Accessible, fully responsive, dark & light theme aware
 *  - Respects reduced motion
 */
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '../../i18n';
import { duration, easing } from '../../motion/tokens';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { radius, space, useTheme } from '../../theme';
import type { NightEntry } from '../SleepNights';
import { AppText, Icon, Row } from '../ui';

interface NightsChartProps {
  entries: NightEntry[];
}

const MOON_PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕'];

/** Calculate consecutive night streak */
function calculateStreak(entries: NightEntry[]): number {
  if (!entries.length) return 0;
  // Sort descending by date
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // If latest is today or yesterday, streak starts at 1
  const latestDate = sorted[0].date;
  if (latestDate !== todayStr && latestDate !== yesterdayStr) {
    return 1; // At least counted active recent entry
  }

  let curr = new Date(latestDate);
  for (let i = 0; i < sorted.length; i++) {
    const entryDate = new Date(sorted[i].date);
    const diffDays = Math.round((curr.getTime() - entryDate.getTime()) / 86400000);
    if (diffDays <= 1) {
      streak++;
      curr = entryDate;
    } else {
      break;
    }
  }
  return Math.max(1, streak);
}

/** Individual animated bar */
function AnimatedBar({
  heightPct,
  score,
  label,
  isBest,
  index,
}: {
  heightPct: number;
  score: number | null;
  label: string;
  isBest: boolean;
  index: number;
}) {
  const { c, isDark } = useTheme();
  const reduced = useReducedMotion();
  const animProgress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      animProgress.value = 1;
      return;
    }
    animProgress.value = withDelay(
      index * 50,
      withTiming(1, { duration: duration.calm, easing: easing.out }),
    );
    return () => cancelAnimation(animProgress);
  }, [reduced, index, animProgress]);

  const barAnim = useAnimatedStyle(() => ({
    height: `${Math.max(10, heightPct * animProgress.value)}%`,
  }));

  const barColor = isBest
    ? (isDark ? '#F5B865' : '#D48A28')
    : (isDark ? '#7E8CA3' : '#9BA8C2');

  return (
    <View style={styles.barColumn}>
      {isBest ? (
        <View style={[styles.bestStar, { backgroundColor: isDark ? '#3D2F18' : '#FFF5E0' }]}>
          <Icon name="sparkles" size={10} color={isDark ? '#FFD166' : '#C4821E'} />
        </View>
      ) : <View style={styles.bestPlaceholder} />}

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.bar,
            { backgroundColor: barColor },
            barAnim,
          ]}
        />
      </View>

      <AppText size={11} weight={isBest ? '800' : '600'} muted={!isBest} style={styles.barLabel}>
        {label}
      </AppText>
      <AppText size={10} weight="700" style={{ color: isBest ? barColor : c.textMuted }}>
        {score != null ? score : '-'}
      </AppText>
    </View>
  );
}

export function NightsChart({ entries }: NightsChartProps) {
  const { c, isDark } = useTheme();
  const t = useT();

  const streak = useMemo(() => calculateStreak(entries), [entries]);
  const moonIcon = MOON_PHASES[Math.min(streak - 1, MOON_PHASES.length - 1)] ?? '🌕';

  // Last 7 nights in chronological order (left to right)
  const last7 = useMemo(() => {
    const slice = entries.slice(0, 7);
    return [...slice].reverse();
  }, [entries]);

  // Find best night (highest score or longest duration)
  const bestEntryId = useMemo(() => {
    if (!last7.length) return null;
    let best = last7[0];
    for (const e of last7) {
      const bestScore = best.score ?? 0;
      const currScore = e.score ?? 0;
      if (currScore > bestScore || (currScore === bestScore && e.durationMin > best.durationMin)) {
        best = e;
      }
    }
    return best.id;
  }, [last7]);

  const maxVal = useMemo(() => {
    const scores = last7.map((e) => e.score ?? (e.durationMin / 480) * 80);
    return Math.max(...scores, 100);
  }, [last7]);

  if (entries.length < 2) return null;

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* Top Header: Moon Phase Streak + Best Night Badge */}
      <Row style={styles.headerRow}>
        <Row style={styles.streakBadge}>
          <AppText size={18}>{moonIcon}</AppText>
          <AppText size={13} weight="800" style={{ color: c.text }}>
            {t('sleepStreak', { n: streak })}
          </AppText>
        </Row>
        <Row style={[styles.bestBadge, { backgroundColor: isDark ? 'rgba(255,209,102,0.15)' : '#FFF6DE' }]}>
          <Icon name="sparkles" size={13} color={isDark ? '#FFD166' : '#C4821E'} />
          <AppText size={11} weight="700" style={{ color: isDark ? '#FFD166' : '#945B0A' }}>
            {t('sleepBestNight')}
          </AppText>
        </Row>
      </Row>

      {/* Chart Bars */}
      <View style={styles.chartArea}>
        {last7.map((entry, idx) => {
          const val = entry.score ?? (entry.durationMin / 480) * 80;
          const pct = Math.min(100, (val / maxVal) * 100);
          const shortDate = entry.date.length > 5 ? entry.date.slice(5) : entry.date;
          return (
            <AnimatedBar
              key={entry.id}
              heightPct={pct}
              score={entry.score}
              label={shortDate}
              isBest={entry.id === bestEntryId}
              index={idx}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    padding: 16,
    gap: space.md,
    borderWidth: 1,
  },
  headerRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  streakBadge: {
    gap: 6,
    alignItems: 'center',
  },
  bestBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    gap: 4,
    alignItems: 'center',
  },
  chartArea: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 8,
    gap: 6,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  bestStar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bestPlaceholder: {
    height: 16,
  },
  track: {
    width: '65%',
    maxWidth: 24,
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 6,
  },
  barLabel: {
    marginTop: 2,
  },
});
