import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { tapHaptic, successHaptic } from '../../motion/haptics';
import { AppText, Button, Row } from '../ui';
import { radius, space, useTheme } from '../../theme';
import { useT, type StringKey } from '../../i18n';

interface GroundingExercise54321Props {
  visible: boolean;
  onClose: () => void;
}

interface StepConfig {
  key: number;
  count: number;
  emoji: string;
  labelKey: StringKey;
}

const STEPS: StepConfig[] = [
  { key: 5, count: 5, emoji: '👁️', labelKey: 'emGroundStep5' },
  { key: 4, count: 4, emoji: '✋', labelKey: 'emGroundStep4' },
  { key: 3, count: 3, emoji: '👂', labelKey: 'emGroundStep3' },
  { key: 2, count: 2, emoji: '👃', labelKey: 'emGroundStep2' },
  { key: 1, count: 1, emoji: '👅', labelKey: 'emGroundStep1' },
];

export function GroundingExercise54321({ visible, onClose }: GroundingExercise54321Props) {
  const t = useT();
  const { c, isDark } = useTheme();

  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [tickedCount, setTickedCount] = useState(0);
  const [isDone, setIsDone] = useState(false);

  // Button pop scale animation
  const tapScale = useSharedValue(1);

  const curStep = STEPS[currentStepIdx]!;

  const handleTap = () => {
    tapHaptic();
    tapScale.value = withSequence(
      withSpring(0.92, { damping: 10, stiffness: 200 }),
      withSpring(1.0, { damping: 12, stiffness: 150 }),
    );

    const nextCount = tickedCount + 1;
    if (nextCount < curStep.count) {
      setTickedCount(nextCount);
    } else {
      // Completed this step
      if (currentStepIdx < STEPS.length - 1) {
        setCurrentStepIdx((prev) => prev + 1);
        setTickedCount(0);
      } else {
        // Completed all 5 steps!
        setIsDone(true);
        successHaptic();
      }
    }
  };

  const handleReset = () => {
    setCurrentStepIdx(0);
    setTickedCount(0);
    setIsDone(false);
  };

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tapScale.value }],
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Header */}
        <View style={styles.topBar}>
          <AppText size={18} weight="700" style={styles.topTitle}>
            {t('emGroundTitle')}
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

        {!isDone ? (
          <View style={styles.mainContent}>
            {/* Step progress pills */}
            <Row style={styles.progressRow}>
              {STEPS.map((s, idx) => (
                <View
                  key={s.key}
                  style={[
                    styles.stepPill,
                    idx === currentStepIdx
                      ? styles.stepPillActive
                      : idx < currentStepIdx
                      ? styles.stepPillDone
                      : styles.stepPillPending,
                  ]}
                >
                  <AppText size={13}>{s.emoji}</AppText>
                </View>
              ))}
            </Row>

            {/* Current Step Instruction Card */}
            <View style={[styles.instructionCard, { backgroundColor: isDark ? '#1C2033' : '#FFFFFF' }]}>
              <View style={styles.emojiCircle}>
                <AppText size={48}>{curStep.emoji}</AppText>
              </View>

              <AppText size={20} weight="800" style={styles.instructionText}>
                {t(curStep.labelKey)}
              </AppText>

              <AppText size={14} muted style={styles.countText}>
                {t('emGroundProgress', { count: tickedCount, total: curStep.count })}
              </AppText>

              {/* Ticked bubbles indicators */}
              <Row style={styles.bubbleRow}>
                {Array.from({ length: curStep.count }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.bubble,
                      i < tickedCount ? styles.bubbleFilled : styles.bubbleEmpty,
                    ]}
                  />
                ))}
              </Row>
            </View>

            {/* Interactive Tap Area */}
            <Animated.View style={[styles.tapContainer, animatedButtonStyle]}>
              <Pressable
                onPress={handleTap}
                accessibilityRole="button"
                accessibilityLabel={t('emGroundTapToCount')}
                style={styles.tapButton}
              >
                <AppText size={18} weight="800" style={styles.tapButtonText}>
                  ✨ {t('emGroundTapToCount')} ({tickedCount + 1}/{curStep.count})
                </AppText>
              </Pressable>
            </Animated.View>
          </View>
        ) : (
          /* Completion State */
          <View style={styles.doneContainer}>
            <View style={styles.doneBadge}>
              <AppText size={52}>🌿</AppText>
            </View>
            <AppText size={22} weight="800" style={styles.doneHeading}>
              {t('emGroundComplete')}
            </AppText>
            <View style={styles.doneButtons}>
              <Button
                title={t('emGroundClose')}
                variant="primary"
                onPress={onClose}
              />
              <Button
                title={t('emGroundReset')}
                variant="ghost"
                onPress={handleReset}
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
    backgroundColor: '#0A0E1A',
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
    color: '#E8ECF8',
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
  mainContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.xl,
  },
  progressRow: {
    gap: space.xs,
    justifyContent: 'center',
  },
  stepPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPillActive: {
    backgroundColor: '#3B82F6',
  },
  stepPillDone: {
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
  },
  stepPillPending: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    opacity: 0.5,
  },
  instructionCard: {
    width: '100%',
    borderRadius: radius.xl,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  emojiCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionText: {
    textAlign: 'center',
    lineHeight: 28,
  },
  countText: {
    textAlign: 'center',
  },
  bubbleRow: {
    gap: 8,
    marginTop: space.xs,
  },
  bubble: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  bubbleFilled: {
    backgroundColor: '#3B82F6',
  },
  bubbleEmpty: {
    backgroundColor: 'rgba(150, 160, 180, 0.3)',
  },
  tapContainer: {
    width: '100%',
  },
  tapButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapButtonText: {
    color: '#FFFFFF',
  },
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.md,
  },
  doneBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(52, 211, 153, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneHeading: {
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 30,
  },
  doneButtons: {
    width: '100%',
    gap: space.sm,
    marginTop: space.md,
  },
});

