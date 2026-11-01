/**
 * MoonBreathCoach — full-screen adaptive breathing guide modal.
 *
 * Calls POST /sleep/moon-breath with { moodLevel } on open.
 * Animates a circle that expands (inhale) → holds → contracts (exhale) → holds,
 * matching the pattern's timing from the API response.
 * After all cycles complete, shows an affirmation + Close button.
 *
 * Colors: background #1A1E38, circle fill rgba(88,130,220,0.3), stroke #8899E0.
 * i18n keys: slBreathInhale, slBreathHold, slBreathExhale, slBreathCycle, slBreathDone, slBreathClose.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Svg, Circle } from 'react-native-svg';
import { api } from '../../api/client';
import { useT } from '../../i18n';
import { space } from '../../theme';
import { AppText, Button } from '../ui';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MoonBreathCoachProps {
  visible: boolean;
  moodLevel: number; // 1–5
  onClose: () => void;
}

// ─── API response shape ───────────────────────────────────────────────────────

interface MoonBreathResponse {
  inhale: number;    // seconds
  hold: number;      // seconds
  exhale: number;    // seconds
  holdOut: number;   // seconds
  cycles: number;
  affirmation: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_BG = '#1A1E38';
const CIRCLE_FILL = 'rgba(88, 130, 220, 0.3)';
const CIRCLE_STROKE = '#8899E0';
const CIRCLE_BASE_R = 80;

type Phase = 'inhale' | 'hold' | 'exhale' | 'holdOut';

// ─── Loading pulse ────────────────────────────────────────────────────────────

function PulsingCircle() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.2, { duration: 900 }),
      withTiming(1.0, { duration: 900 }),
    );
    // Repeat via recursion is handled by withRepeat equivalent below
  }, [scale]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 0.6,
  }));

  return (
    <Animated.View style={[styles.loadingCircle, anim]} />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MoonBreathCoach({ visible, moodLevel, onClose }: MoonBreathCoachProps) {
  const t = useT();

  const [loading, setLoading] = useState(false);
  const [pattern, setPattern] = useState<MoonBreathResponse | null>(null);
  const [currentPhase, setCurrentPhase] = useState<Phase>('inhale');
  const [currentCycle, setCurrentCycle] = useState(1);
  const [done, setDone] = useState(false);

  // Shared value for circle scale (1.0 → 1.6)
  const circleScale = useSharedValue(1.0);
  // Affirmation fade-in
  const affirmationOpacity = useSharedValue(0);

  const abortRef = useRef<AbortController | null>(null);
  // Track running animation to cancel
  const animRunning = useRef(false);

  const circleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));

  const affirmationAnimStyle = useAnimatedStyle(() => ({
    opacity: affirmationOpacity.value,
  }));

  // ─── Run the breath animation sequence ──────────────────────────────────────

  const runBreathCycles = useCallback(
    (p: MoonBreathResponse) => {
      const inhaleMs = p.inhale * 1000;
      const holdMs = p.hold * 1000;
      const exhaleMs = p.exhale * 1000;
      const holdOutMs = p.holdOut * 1000;
      const totalCycles = p.cycles;

      animRunning.current = true;
      let cycleIndex = 0;

      const runOneCycle = () => {
        if (!animRunning.current) return;
        if (cycleIndex >= totalCycles) {
          // All done — show affirmation
          setDone(true);
          affirmationOpacity.value = withTiming(1, { duration: 800 });
          return;
        }

        const cycle = cycleIndex + 1;
        setCurrentCycle(cycle);

        // Inhale
        setCurrentPhase('inhale');
        circleScale.value = withTiming(1.6, { duration: inhaleMs }, () => {
          // Hold
          setCurrentPhase('hold');
          circleScale.value = withDelay(
            holdMs,
            withTiming(1.6, { duration: 0 }, () => {
              // Exhale
              setCurrentPhase('exhale');
              circleScale.value = withTiming(1.0, { duration: exhaleMs }, () => {
                // Hold-out
                setCurrentPhase('holdOut');
                circleScale.value = withDelay(
                  holdOutMs,
                  withTiming(1.0, { duration: 0 }, () => {
                    cycleIndex++;
                    runOneCycle();
                  }),
                );
              });
            }),
          );
        });
      };

      runOneCycle();
    },
    [circleScale, affirmationOpacity],
  );

  // ─── Fetch pattern on open ───────────────────────────────────────────────────

  useEffect(() => {
    if (!visible) {
      // Reset state when closed
      animRunning.current = false;
      cancelAnimation(circleScale);
      setLoading(false);
      setPattern(null);
      setDone(false);
      setCurrentPhase('inhale');
      setCurrentCycle(1);
      circleScale.value = 1.0;
      affirmationOpacity.value = 0;
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setDone(false);

    api<MoonBreathResponse>('/sleep/moon-breath', {
      method: 'POST',
      body: { moodLevel },
      signal: controller.signal,
    })
      .then((res) => {
        setPattern(res);
        setLoading(false);
        runBreathCycles(res);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
      animRunning.current = false;
    };
  }, [visible, moodLevel, circleScale, affirmationOpacity, runBreathCycles]);

  // ─── Phase label ─────────────────────────────────────────────────────────────

  function phaseLabel(phase: Phase): string {
    if (phase === 'inhale') return t('slBreathInhale');
    if (phase === 'exhale') return t('slBreathExhale');
    return t('slBreathHold');
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.canvas}>
        {loading ? (
          /* Loading state */
          <View style={styles.center}>
            <PulsingCircle />
            <AppText size={16} style={styles.whiteText}>
              {t('slBreathInhale')} …
            </AppText>
          </View>
        ) : (
          <>
            {/* Breathing circle */}
            <View style={styles.center}>
              <Animated.View style={[styles.circleWrap, circleAnimStyle]}>
                <Svg width={CIRCLE_BASE_R * 2} height={CIRCLE_BASE_R * 2}>
                  <Circle
                    cx={CIRCLE_BASE_R}
                    cy={CIRCLE_BASE_R}
                    r={CIRCLE_BASE_R - 4}
                    fill={CIRCLE_FILL}
                    stroke={CIRCLE_STROKE}
                    strokeWidth={2}
                  />
                </Svg>
              </Animated.View>

              {/* Phase & cycle text */}
              {!done && pattern ? (
                <View style={styles.phaseWrap}>
                  <AppText size={22} weight="700" style={styles.whiteText}>
                    {phaseLabel(currentPhase)}
                  </AppText>
                  <AppText size={14} style={styles.mutedText}>
                    {t('slBreathCycle')} {currentCycle} / {pattern.cycles}
                  </AppText>
                </View>
              ) : null}

              {/* Done state */}
              {done && pattern ? (
                <Animated.View style={[styles.affirmationWrap, affirmationAnimStyle]}>
                  <AppText size={18} weight="600" style={[styles.whiteText, { textAlign: 'center', lineHeight: 28 }]}>
                    {pattern.affirmation}
                  </AppText>
                  <AppText size={13} style={[styles.mutedText, { textAlign: 'center', marginTop: space.xs }]}>
                    {t('slBreathDone')}
                  </AppText>
                  <View style={{ marginTop: space.md }}>
                    <Button
                      title={t('slBreathClose')}
                      onPress={onClose}
                      variant="secondary"
                    />
                  </View>
                </Animated.View>
              ) : null}
            </View>

            {/* Close tap outside target (only before done) */}
            {!done ? (
              <Pressable style={styles.closeHint} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('slBreathClose')}>
                <AppText size={13} style={styles.mutedText}>
                  {t('slBreathClose')}
                </AppText>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: CANVAS_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  circleWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseWrap: {
    alignItems: 'center',
    gap: space.xs,
  },
  affirmationWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: space.sm,
  },
  loadingCircle: {
    width: CIRCLE_BASE_R * 2,
    height: CIRCLE_BASE_R * 2,
    borderRadius: CIRCLE_BASE_R,
    backgroundColor: CIRCLE_FILL,
    borderWidth: 2,
    borderColor: CIRCLE_STROKE,
  },
  whiteText: {
    color: '#FFFFFF',
  },
  mutedText: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  closeHint: {
    position: 'absolute',
    bottom: 56,
    alignSelf: 'center',
    padding: 12,
  },
});
