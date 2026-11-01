import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { tapHaptic, successHaptic } from '../../motion/haptics';
import { AppText, Button } from '../ui';
import { radius, space } from '../../theme';
import { useT } from '../../i18n';

interface CalmAnchorBreatherProps {
  visible: boolean;
  onClose: () => void;
}

type Phase = 'inhale' | 'hold' | 'exhale' | 'holdEmpty';

const PHASE_DURATIONS: Record<Phase, number> = {
  inhale: 4,
  hold: 4,
  exhale: 4,
  holdEmpty: 4,
};

const TOTAL_CYCLES = 4;

export function CalmAnchorBreather({ visible, onClose }: CalmAnchorBreatherProps) {
  const t = useT();

  const [phase, setPhase] = useState<Phase>('inhale');
  const [secondsRemaining, setSecondsRemaining] = useState(4);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [isCompleted, setIsCompleted] = useState(false);

  // Animations: Expanding breathing circle & ambient glow
  const circleScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.3);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startBreathingCycle = useCallback(() => {
    setPhase('inhale');
    setSecondsRemaining(4);
    setCurrentCycle(1);
    setIsCompleted(false);

    // Initial inhale expansion
    tapHaptic();
    circleScale.value = withTiming(1.5, { duration: 4000 });
    glowOpacity.value = withTiming(0.8, { duration: 4000 });
  }, [circleScale, glowOpacity]);

  useEffect(() => {
    if (visible) {
      startBreathingCycle();
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimation(circleScale);
      cancelAnimation(glowOpacity);
      circleScale.value = 1;
      glowOpacity.value = 0.3;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible, startBreathingCycle, circleScale, glowOpacity]);

  // Phase transition state machine
  useEffect(() => {
    if (!visible || isCompleted) return;

    timerRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev > 1) return prev - 1;

        // Transition to next phase
        setPhase((curPhase) => {
          let nextPhase: Phase = 'inhale';
          if (curPhase === 'inhale') {
            nextPhase = 'hold';
            tapHaptic();
            // Circle holds expansion
          } else if (curPhase === 'hold') {
            nextPhase = 'exhale';
            tapHaptic();
            circleScale.value = withTiming(1.0, { duration: 4000 });
            glowOpacity.value = withTiming(0.3, { duration: 4000 });
          } else if (curPhase === 'exhale') {
            nextPhase = 'holdEmpty';
            tapHaptic();
          } else if (curPhase === 'holdEmpty') {
            setCurrentCycle((curCycle) => {
              if (curCycle >= TOTAL_CYCLES) {
                // Completed all cycles!
                setIsCompleted(true);
                successHaptic();
                return curCycle;
              }
              // Next cycle
              tapHaptic();
              circleScale.value = withTiming(1.5, { duration: 4000 });
              glowOpacity.value = withTiming(0.8, { duration: 4000 });
              return curCycle + 1;
            });
            nextPhase = 'inhale';
          }
          return nextPhase;
        });

        return 4;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible, isCompleted, circleScale, glowOpacity]);

  const animatedCircleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));

  const animatedGlowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const getPhaseText = () => {
    switch (phase) {
      case 'inhale':
        return t('emAnchorInhale');
      case 'hold':
        return t('emAnchorHold');
      case 'exhale':
        return t('emAnchorExhale');
      case 'holdEmpty':
        return t('emAnchorHoldEmpty');
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Top Header */}
        <View style={styles.topBar}>
          <AppText size={18} weight="700" style={styles.topTitle}>
            {t('emAnchorTitle')}
          </AppText>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            style={styles.closeBtn}
          >
            <AppText size={16} weight="700" style={styles.closeBtnText}>
              ✕
            </AppText>
          </Pressable>
        </View>

        {!isCompleted ? (
          <View style={styles.centerContainer}>
            {/* Breathing Animation Canvas */}
            <View style={styles.visualizerContainer}>
              {/* Outer Radiant Aura */}
              <Animated.View style={[styles.glowAura, animatedGlowStyle]} />

              {/* Main Breathing Circle */}
              <Animated.View style={[styles.breathingOrb, animatedCircleStyle]}>
                <Svg width={180} height={180} viewBox="0 0 180 180">
                  <Circle
                    cx={90}
                    cy={90}
                    r={74}
                    fill="rgba(255, 180, 195, 0.28)"
                    stroke="#FFCAD4"
                    strokeWidth={3}
                  />
                  <Circle
                    cx={90}
                    cy={90}
                    r={56}
                    fill="rgba(255, 140, 165, 0.35)"
                  />
                </Svg>
                <View style={styles.countdownOverlay}>
                  <AppText size={38} weight="800" style={styles.countdownText}>
                    {secondsRemaining}
                  </AppText>
                </View>
              </Animated.View>
            </View>

            {/* Instruction Labels */}
            <View style={styles.instructionBox}>
              <AppText size={24} weight="800" style={styles.phaseLabel}>
                {getPhaseText()}
              </AppText>
              <AppText size={14} style={styles.cycleLabel}>
                {t('emAnchorCycle', { n: currentCycle, total: TOTAL_CYCLES })}
              </AppText>
            </View>
          </View>
        ) : (
          /* Completion Card */
          <View style={styles.completeCard}>
            <View style={styles.completeIcon}>
              <AppText size={44}>🌸</AppText>
            </View>
            <AppText size={20} weight="800" style={styles.completeTitle}>
              {t('emAnchorComplete')}
            </AppText>
            <View style={styles.completeButtons}>
              <Button
                title={t('emAnchorClose')}
                variant="primary"
                onPress={onClose}
              />
              <Button
                title={t('emGroundReset')}
                variant="ghost"
                onPress={startBreathingCycle}
              />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0D111E',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.md,
  },
  topTitle: {
    color: '#FCE7ED',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFF',
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: space.xl,
  },
  visualizerContainer: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowAura: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(255, 140, 165, 0.15)',
  },
  breathingOrb: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    color: '#FFFFFF',
  },
  instructionBox: {
    alignItems: 'center',
    gap: 8,
  },
  phaseLabel: {
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  cycleLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  completeCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.md,
  },
  completeIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255, 202, 212, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeTitle: {
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 28,
  },
  completeButtons: {
    width: '100%',
    gap: space.sm,
    marginTop: space.md,
  },
});

