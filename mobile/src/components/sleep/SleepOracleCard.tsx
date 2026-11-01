/**
 * SleepOracleCard — interactive AI oracle panel for sleep trend analysis.
 *
 * On mount (when entries.length >= 3), calls POST /sleep/oracle.
 * Shows insight text, best/worst day summary, trend arrow, and an animated
 * SVG prediction arc (strokeDashoffset animates in).
 * Tap anywhere to expand into a Modal bottom-sheet showing the full reading.
 *
 * i18n keys: slOracleTitle, slOracleLoading, slOracleBest, slOracleWorst,
 *            slOracleTrend, slOraclePrediction, slOracleTip, slOracleUnlock.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Svg, Path } from 'react-native-svg';
import { api } from '../../api/client';
import { useT } from '../../i18n';
import { radius, space, useTheme } from '../../theme';
import { AppText, Button, Card } from '../ui';

// ─── Props ────────────────────────────────────────────────────────────────────

interface OracleEntry {
  date: string;
  score: number;
  bedtime: string;
  durationMin: number;
  awakenings: number;
}

interface SleepOracleCardProps {
  entries: OracleEntry[];
}

// ─── API response shape ───────────────────────────────────────────────────────

interface OracleResponse {
  insight: string;
  bestDay: string;
  worstDay: string;
  trend: 'up' | 'down' | 'flat';
  predictionLow: number;   // 0–100
  predictionHigh: number;  // 0–100
  actionTip: string;
}

// ─── SVG Arc helpers ──────────────────────────────────────────────────────────

const ARC_WIDTH = 220;
const ARC_HEIGHT = 120;
const ARC_CX = ARC_WIDTH / 2;
const ARC_CY = ARC_HEIGHT;
const ARC_R = 100;
const ARC_CIRCUMFERENCE = Math.PI * ARC_R; // half-circle

/**
 * Converts a score (0-100) to angle in degrees on the semicircle (180°→0°).
 * 0 = leftmost (180°), 100 = rightmost (0°).
 */
function scoreToPoint(score: number): { x: number; y: number } {
  const angle = Math.PI - (score / 100) * Math.PI; // radians, left→right
  return {
    x: ARC_CX + ARC_R * Math.cos(angle),
    y: ARC_CY + ARC_R * Math.sin(angle),
  };
}

/** SVG "d" attribute for the full semicircle arc (bottom-half). */
const FULL_ARC_D = `M ${ARC_CX - ARC_R} ${ARC_CY} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_CX + ARC_R} ${ARC_CY}`;

/** SVG "d" for the highlighted prediction band arc. */
function predictionArcD(low: number, high: number): string {
  const s = scoreToPoint(low);
  const e = scoreToPoint(high);
  return `M ${s.x} ${s.y} A ${ARC_R} ${ARC_R} 0 0 1 ${e.x} ${e.y}`;
}

// ─── Animated arc (prediction band) ──────────────────────────────────────────

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface PredictionArcProps {
  low: number;
  high: number;
}

function PredictionArc({ low, high }: PredictionArcProps) {
  // Animate stroke-dashoffset from full circumference → 0 to reveal arc
  const dashOffset = useSharedValue(ARC_CIRCUMFERENCE);

  useEffect(() => {
    dashOffset.value = withTiming(0, { duration: 1200 });
  }, [low, high, dashOffset]);

  const animProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const arcD = predictionArcD(low, high);

  return (
    <Svg width={ARC_WIDTH} height={ARC_HEIGHT} style={styles.svgArc}>
      {/* Background track */}
      <Path
        d={FULL_ARC_D}
        stroke="rgba(136, 153, 224, 0.2)"
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
      />
      {/* Animated prediction band */}
      <AnimatedPath
        d={arcD}
        stroke="#8899E0"
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={ARC_CIRCUMFERENCE}
        animatedProps={animProps}
      />
    </Svg>
  );
}

// ─── Skeleton shimmer rows ────────────────────────────────────────────────────

function SkeletonRows() {
  const { c } = useTheme();
  const t = useT();
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(0.4, { duration: 700 });
  }, [opacity]);

  const animStyle = { opacity: opacity.value };

  return (
    <Animated.View style={[styles.skeletonWrap, animStyle]}>
      <View style={[styles.skeletonRow, { width: '80%', backgroundColor: c.cardAlt }]} />
      <View style={[styles.skeletonRow, { width: '60%', backgroundColor: c.cardAlt }]} />
      <View style={[styles.skeletonRow, { width: '90%', backgroundColor: c.cardAlt }]} />
      <AppText size={13} muted>{t('slOracleLoading')}</AppText>
    </Animated.View>
  );
}

// ─── Trend arrow helper ────────────────────────────────────────────────────────

function trendArrow(trend: OracleResponse['trend']): string {
  if (trend === 'up') return '↗️';
  if (trend === 'down') return '↘️';
  return '→';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SleepOracleCard({ entries }: SleepOracleCardProps) {
  const { c } = useTheme();
  const t = useT();

  const [loading, setLoading] = useState(false);
  const [oracle, setOracle] = useState<OracleResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (entries.length < 3) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    api<OracleResponse>('/sleep/oracle', {
      method: 'POST',
      body: { entries },
      signal: controller.signal,
    })
      .then((res) => {
        setOracle(res);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') {
          // silently fail — card won't show oracle data
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
    // Only re-run when entries count changes materially
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  // ─── Unlock prompt ──────────────────────────────────────────────────────────

  if (entries.length < 3) {
    return (
      <Card>
        <View style={styles.unlockRow}>
          <AppText size={20}>🌙</AppText>
          <AppText size={14} weight="700">
            {t('slOracleTitle')}
          </AppText>
        </View>
        <AppText size={14} muted>
          {t('slOracleUnlock')}
        </AppText>
      </Card>
    );
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <View style={styles.titleRow}>
          <AppText size={20}>🌙</AppText>
          <AppText size={16} weight="700">{t('slOracleTitle')}</AppText>
        </View>
        <SkeletonRows />
      </Card>
    );
  }

  if (!oracle) return null;

  // ─── Main card ──────────────────────────────────────────────────────────────

  return (
    <>
      <Card onPress={() => setModalOpen(true)} accessibilityRole="button" accessibilityLabel={t('slOracleTitle')}>
        {/* Header */}
        <View style={styles.titleRow}>
          <AppText size={20}>🌙</AppText>
          <AppText size={16} weight="700">{t('slOracleTitle')}</AppText>
        </View>

        {/* Insight text */}
        <AppText size={14} muted style={{ lineHeight: 22 }}>
          {oracle.insight}
        </AppText>

        {/* Summary row */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <AppText size={12} muted>{t('slOracleBest')}</AppText>
            <AppText size={13} weight="600">⭐ {oracle.bestDay}</AppText>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <AppText size={12} muted>{t('slOracleWorst')}</AppText>
            <AppText size={13} weight="600">😴 {oracle.worstDay}</AppText>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <AppText size={12} muted>{t('slOracleTrend')}</AppText>
            <AppText size={20}>{trendArrow(oracle.trend)}</AppText>
          </View>
        </View>

        {/* Prediction arc */}
        <View style={styles.arcWrap}>
          <AppText size={12} muted style={{ marginBottom: 4 }}>
            {t('slOraclePrediction')} {oracle.predictionLow}–{oracle.predictionHigh}
          </AppText>
          <PredictionArc low={oracle.predictionLow} high={oracle.predictionHigh} />
        </View>

        {/* Action tip */}
        <View style={[styles.tipBox, { backgroundColor: `${c.primary}18` }]}>
          <AppText size={13} style={{ lineHeight: 20 }}>
            💡 {oracle.actionTip}
          </AppText>
        </View>
      </Card>

      {/* Expanded modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />

            <View style={styles.titleRow}>
              <AppText size={22}>🌙</AppText>
              <AppText size={18} weight="800">{t('slOracleTitle')}</AppText>
            </View>

            <AppText size={14} style={{ lineHeight: 24 }}>
              {oracle.insight}
            </AppText>

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <AppText size={12} muted>{t('slOracleBest')}</AppText>
                <AppText size={14} weight="600">⭐ {oracle.bestDay}</AppText>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <AppText size={12} muted>{t('slOracleWorst')}</AppText>
                <AppText size={14} weight="600">😴 {oracle.worstDay}</AppText>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <AppText size={12} muted>{t('slOracleTrend')}</AppText>
                <AppText size={22}>{trendArrow(oracle.trend)}</AppText>
              </View>
            </View>

            <PredictionArc low={oracle.predictionLow} high={oracle.predictionHigh} />

            <View style={[styles.tipBox, { backgroundColor: `${c.primary}18` }]}>
              <AppText size={14} style={{ lineHeight: 22 }}>
                💡 {oracle.actionTip}
              </AppText>
            </View>

            <Button title={t('slOracleTitle')} onPress={() => setModalOpen(false)} variant="ghost" />
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  unlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginVertical: space.xs,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  summaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(136, 153, 224, 0.25)',
  },
  arcWrap: {
    alignItems: 'center',
  },
  svgArc: {
    marginVertical: space.xs,
  },
  tipBox: {
    borderRadius: radius.md,
    padding: 12,
  },
  skeletonWrap: {
    gap: space.sm,
  },
  skeletonRow: {
    height: 12,
    borderRadius: 6,
  },
  // Modal
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: space.lg,
    paddingBottom: 48,
    gap: space.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.xs,
  },
});
