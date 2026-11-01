/**
 * ConstellationWeek — 7-night sleep history as an animated star constellation.
 *
 * Features:
 *  - 7 stars laid out in a gentle arc; star glow/size proportional to score.
 *  - Animated dotted connecting lines drawn with Reanimated strokeDashoffset.
 *  - Tap a star → day info tooltip slides in from below.
 *  - Stars with score >= 80 pulse with a slow breathing animation.
 *  - score null → dim grey star (no data).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';
import { AppText, Card, Row } from '../ui';
import { space, radius } from '../../theme';
import { useTheme } from '../../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayEntry {
  date: string;
  score: number | null | undefined;
}

interface ConstellationWeekProps {
  entries: DayEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'];

function dayLabel(dateStr: string, lang: 'en' | 'bn' = 'en'): string {
  try {
    const d = new Date(dateStr);
    return (lang === 'bn' ? DAY_LABELS_BN : DAY_LABELS)[d.getDay()] ?? dateStr.slice(5);
  } catch {
    return dateStr.slice(5);
  }
}

function scoreToRadius(score: number | null | undefined): number {
  if (score == null) return 5;
  return 5 + (score / 100) * 10; // 5–15
}

function scoreToOpacity(score: number | null | undefined): number {
  if (score == null) return 0.25;
  return 0.4 + (score / 100) * 0.6; // 0.4–1.0
}

function scoreToColor(score: number | null | undefined): string {
  if (score == null) return '#6B7280';
  if (score >= 80) return '#F5D78E'; // golden
  if (score >= 60) return '#A8C8E8'; // soft blue
  if (score >= 40) return '#D4A8E8'; // lavender
  return '#E8A8A8'; // soft red
}

// ─── Star sub-component ───────────────────────────────────────────────────────

function Star({
  cx, cy, score, isSelected, onPress, index,
}: {
  cx: number; cy: number; score: number | null | undefined;
  isSelected: boolean; onPress: () => void; index: number;
}) {
  const r = scoreToRadius(score);
  const color = scoreToColor(score);
  const pulse = useSharedValue(r);

  useEffect(() => {
    if (score != null && score >= 80) {
      pulse.value = withDelay(
        index * 120,
        withRepeat(
          withSequence(
            withTiming(r * 1.25, { duration: 1800 }),
            withTiming(r, { duration: 1800 }),
          ),
          -1,
          true,
        ),
      );
    }
  }, [score, r, pulse, index]);

  const animProps = useAnimatedProps(() => ({ r: pulse.value }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Day ${index + 1} score ${score ?? 'not logged'}`}
      style={StyleSheet.absoluteFill}
    >
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`grad${index}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={scoreToOpacity(score)} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* Glow halo */}
        <Circle cx={cx} cy={cy} r={r * 2.4} fill={`url(#grad${index})`} />
        {/* Core star */}
        <AnimatedCircle
          cx={cx}
          cy={cy}
          animatedProps={animProps}
          fill={color}
          opacity={isSelected ? 1 : scoreToOpacity(score)}
          stroke={isSelected ? '#FFFFFF' : 'transparent'}
          strokeWidth={isSelected ? 1.5 : 0}
        />
      </Svg>
    </Pressable>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConstellationWeek({ entries }: ConstellationWeekProps) {
  const { c, isDark } = useTheme();
  const [selected, setSelected] = useState<number | null>(null);

  const W = 320;
  const H = 120;
  const PAD = 24;
  const usable = W - PAD * 2;

  // Arc: stars placed along a gentle sine wave arc
  const points = entries.slice(0, 7).map((e, i) => {
    const n = Math.min(entries.length, 7);
    const x = PAD + (i / Math.max(n - 1, 1)) * usable;
    const y = H / 2 + Math.sin((i / (n - 1)) * Math.PI) * -28;
    return { x, y, entry: e };
  });

  // Connecting line progress
  const lineProgress = useSharedValue(0);
  useEffect(() => {
    lineProgress.value = withTiming(1, { duration: 900 });
  }, [lineProgress]);

  const selectedEntry = selected != null ? points[selected] : null;

  return (
    <View>
      <View style={[styles.canvas, { backgroundColor: isDark ? '#0E1228' : '#F0F4FF' }]}>
        <Svg width={W} height={H}>
          {/* Connecting dotted lines */}
          {points.slice(0, -1).map((p, i) => {
            const next = points[i + 1]!;
            return (
              <Line
                key={`line${i}`}
                x1={p.x}
                y1={p.y}
                x2={next.x}
                y2={next.y}
                stroke={isDark ? 'rgba(180,200,255,0.2)' : 'rgba(80,100,180,0.15)'}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            );
          })}
        </Svg>

        {/* Stars overlaid as Pressable */}
        <View style={[StyleSheet.absoluteFill]}>
          {points.map((p, i) => (
            <Star
              key={p.entry.date}
              cx={p.x}
              cy={p.y}
              score={p.entry.score}
              isSelected={selected === i}
              onPress={() => setSelected(selected === i ? null : i)}
              index={i}
            />
          ))}
        </View>

        {/* Day labels below */}
        <View style={styles.labelRow}>
          {points.map((p, i) => (
            <AppText key={p.entry.date} size={10} muted style={styles.dayLabel}>
              {dayLabel(p.entry.date)}
            </AppText>
          ))}
        </View>
      </View>

      {/* Selected day tooltip */}
      {selectedEntry ? (
        <Animated.View style={[styles.tooltip, { backgroundColor: isDark ? c.card : '#FAFAFA', borderColor: c.border }]}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <AppText size={18}>{scoreToColor(selectedEntry.entry.score) === '#F5D78E' ? '⭐' : selectedEntry.entry.score != null && selectedEntry.entry.score >= 60 ? '🌙' : '🌑'}</AppText>
            <View>
              <AppText weight="700" size={14}>{dayLabel(selectedEntry.entry.date)}</AppText>
              <AppText size={13} muted>
                {selectedEntry.entry.score != null ? `Score: ${selectedEntry.entry.score}/100` : 'Not logged'}
              </AppText>
            </View>
          </Row>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    height: 140,
  },
  labelRow: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
  },
  dayLabel: {
    textAlign: 'center',
  },
  tooltip: {
    marginTop: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.sm,
  },
});

