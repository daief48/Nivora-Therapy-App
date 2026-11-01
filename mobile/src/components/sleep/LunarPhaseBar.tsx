/**
 * LunarPhaseBar — Replaces static progress bars with animated lunar phase icons.
 *
 * Maps a value 0–max to a moon phase:
 *   0%–10%  🌑 New Moon
 *  11%–30%  🌒 Waxing Crescent
 *  31%–50%  🌓 First Quarter
 *  51%–70%  🌔 Waxing Gibbous
 *  71%–100% 🌕 Full Moon
 *
 * The phases animate in on mount using a stagger withDelay.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Rect } from 'react-native-svg';
import { AppText, Row } from '../ui';
import { space } from '../../theme';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LunarPhaseBarProps {
  value: number;
  max: number;
  label: string;
  /** Delay stagger index so multiple bars animate in sequence */
  index?: number;
}

// ─── Moon phase resolver ──────────────────────────────────────────────────────

const PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕'] as const;
const PHASE_LABELS = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon'] as const;

function toPhaseIndex(pct: number): number {
  if (pct <= 0.1) return 0;
  if (pct <= 0.3) return 1;
  if (pct <= 0.5) return 2;
  if (pct <= 0.7) return 3;
  return 4;
}

// ─── Animated fill moon SVG ───────────────────────────────────────────────────

function MoonFill({ pct, size = 22 }: { pct: number; size?: number }) {
  const r = size / 2;
  // Fill level mapped to clip rect width
  const fillW = Math.round(pct * size);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <ClipPath id="moonClip">
          <Circle cx={r} cy={r} r={r} />
        </ClipPath>
        <ClipPath id="fillClip">
          <Rect x={0} y={0} width={fillW} height={size} />
        </ClipPath>
      </Defs>
      {/* Background disc */}
      <Circle cx={r} cy={r} r={r} fill="rgba(100,100,120,0.18)" />
      {/* Fill disc (light) */}
      <Circle cx={r} cy={r} r={r} fill="#F5D78E" clipPath="url(#fillClip)" opacity={0.92} />
      {/* Outer ring */}
      <Circle cx={r} cy={r} r={r - 0.5} fill="none" stroke="rgba(245,215,130,0.5)" strokeWidth={1} />
    </Svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LunarPhaseBar({ value, max, label, index = 0 }: LunarPhaseBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const phaseIdx = toPhaseIndex(pct);
  const phaseLabel = PHASE_LABELS[phaseIdx];

  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-12);

  useEffect(() => {
    const delay = index * 80;
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
    translateX.value = withDelay(delay, withSpring(0, { damping: 14, stiffness: 120 }));
  }, [opacity, translateX, index]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  // Fill moon track (5 discrete phase steps)
  const filledCount = phaseIdx + 1;

  return (
    <Animated.View style={[styles.row, animStyle]}>
      <Row style={styles.labelRow}>
        <AppText size={13} style={styles.label}>{label}</AppText>
        <Row style={styles.phaseTrack}>
          {PHASES.map((p, i) => (
            <View key={p} style={[styles.phaseDot, i < filledCount ? styles.phaseDotActive : styles.phaseDotInactive]}>
              <AppText size={11}>{p}</AppText>
            </View>
          ))}
        </Row>
        <View style={styles.moonFill}>
          <MoonFill pct={pct} size={20} />
        </View>
        <AppText size={12} muted style={styles.fraction}>{value}/{max}</AppText>
      </Row>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 4,
  },
  labelRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    flex: 1,
  },
  phaseTrack: {
    gap: 2,
    alignItems: 'center',
  },
  phaseDot: {
    borderRadius: 20,
    padding: 1,
  },
  phaseDotActive: {
    opacity: 1,
  },
  phaseDotInactive: {
    opacity: 0.25,
  },
  moonFill: {
    marginHorizontal: 4,
  },
  fraction: {
    minWidth: 32,
    textAlign: 'right',
  },
});

