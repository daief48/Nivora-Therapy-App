/**
 * ProgramCard — card for an individual guided program with per-icon micro-animation.
 *  - 🍃 Leaf: gentle wind sway
 *  - 🌸 Flower: petal breathing bloom
 *  - 🌙 Moon: soft halo glow pulse
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '../../i18n';
import { easing } from '../../motion/tokens';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { radius, space, useTheme } from '../../theme';
import type { ProgramSummary } from '../../screens/ProgramsScreen';
import { AppText, Button, Card, Icon, ProgressBar, Row, type IconName } from '../ui';

interface Props {
  program: ProgramSummary;
  onOpen: () => void;
  loading?: boolean;
}

const ICONS: Record<string, IconName> = {
  'stress-7': 'leaf-outline',
  'anxiety-14': 'flower-outline',
  'cbti-21': 'moon-outline',
};

const PROGRAM_TONES: Record<string, { bg: [string, string]; iconColor: [string, string] }> = {
  'stress-7': { bg: ['#EBF3EC', '#223225'], iconColor: ['#46664C', '#9AC4A1'] },
  'anxiety-14': { bg: ['#FDF0F3', '#3A242B'], iconColor: ['#B34A6A', '#F49DB5'] },
  'cbti-21': { bg: ['#EFEAFC', '#272038'], iconColor: ['#6B589C', '#C2B1EB'] },
};

function MicroAnimatedProgramIcon({ programId }: { programId: string }) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();

  const iconName = ICONS[programId] ?? 'book-outline';
  const tone = PROGRAM_TONES[programId] ?? {
    bg: ['#F4EDEA', '#302622'],
    iconColor: ['#8A6652', '#D9B59F'],
  };
  const iconColor = tone.iconColor[isDark ? 1 : 0];
  const bgColor = tone.bg[isDark ? 1 : 0];

  // Micro-animations
  const rot = useSharedValue(0);
  const scale = useSharedValue(1);
  const glow = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;

    if (programId === 'stress-7') {
      // Leaf sway
      rot.value = withRepeat(
        withSequence(
          withTiming(-7, { duration: 1400, easing: easing.breath }),
          withTiming(7, { duration: 1400, easing: easing.breath }),
        ),
        -1,
        true,
      );
    } else if (programId === 'anxiety-14') {
      // Flower blooming pulse
      scale.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 1600, easing: easing.breath }),
          withTiming(1.0, { duration: 1600, easing: easing.breath }),
        ),
        -1,
        true,
      );
    } else if (programId === 'cbti-21') {
      // Moon glow pulse
      glow.value = withRepeat(
        withSequence(
          withTiming(1.22, { duration: 1800, easing: easing.breath }),
          withTiming(1.0, { duration: 1800, easing: easing.breath }),
        ),
        -1,
        true,
      );
    }

    return () => {
      cancelAnimation(rot);
      cancelAnimation(scale);
      cancelAnimation(glow);
    };
  }, [programId, reduced, rot, scale, glow]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rot.value}deg` },
      { scale: scale.value },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glow.value }],
    opacity: 0.35 / glow.value,
  }));

  return (
    <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
      {programId === 'cbti-21' && !reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.glowRing, { backgroundColor: iconColor }, glowStyle]}
        />
      ) : null}
      <Animated.View style={animStyle}>
        <Icon name={iconName} size={24} color={iconColor} />
      </Animated.View>
    </View>
  );
}

export function ProgramCard({ program, onOpen, loading }: Props) {
  const { c, isDark } = useTheme();
  const t = useT();

  const isCompleted = program.status === 'COMPLETED';
  const isPaused = program.status === 'PAUSED';
  const label = !program.enrolled
    ? t('progStart')
    : isCompleted
    ? t('progReview')
    : isPaused
    ? t('progResume')
    : t('progContinue');

  const progressLabel = t('progProgress', {
    done: program.completedCount,
    total: program.days,
  });

  return (
    <Card style={styles.cardContainer}>
      <Row style={styles.topRow}>
        <MicroAnimatedProgramIcon programId={program.id} />
        <View style={styles.titleCol}>
          <AppText size={17} weight="800" accessibilityRole="header">
            {program.title}
          </AppText>
          <Row style={styles.badgeRow}>
            <View style={[styles.durationBadge, { backgroundColor: c.lavender }]}>
              <AppText size={11} weight="700" style={{ color: c.primary }}>
                {t('progDaysCount', { n: program.days })}
              </AppText>
            </View>
            {isCompleted ? (
              <View style={[styles.statusBadge, { backgroundColor: isDark ? '#1F3A24' : '#EAF7ED' }]}>
                <Icon name="checkmark" size={11} color={c.success} />
                <AppText size={11} weight="700" style={{ color: c.success }}>
                  {t('progDoneBadge')}
                </AppText>
              </View>
            ) : isPaused ? (
              <View style={[styles.statusBadge, { backgroundColor: isDark ? '#3D3528' : '#FFF6E5' }]}>
                <AppText size={11} weight="700" style={{ color: isDark ? '#E5B869' : '#99732B' }}>
                  {t('progPaused')}
                </AppText>
              </View>
            ) : null}
          </Row>
        </View>
      </Row>

      <AppText size={13} muted style={styles.descriptionText}>
        {program.description}
      </AppText>

      {program.enrolled ? (
        <View style={styles.progressCol}>
          <Row style={styles.progressLabels}>
            <AppText size={12} weight="700" style={{ color: c.textMuted }}>
              {progressLabel}
            </AppText>
            <AppText size={12} weight="800" style={{ color: c.primary }}>
              {Math.round((program.completedCount / program.days) * 100)}%
            </AppText>
          </Row>
          <ProgressBar
            value={program.completedCount}
            max={program.days}
            label={progressLabel}
          />
        </View>
      ) : null}

      <Button
        title={label}
        icon={program.enrolled ? 'chevron-forward' : 'play'}
        onPress={onOpen}
        loading={loading}
        variant={program.enrolled ? 'secondary' : 'primary'}
        style={styles.ctaButton}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    gap: 12,
  },
  topRow: {
    gap: 12,
    alignItems: 'center',
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  titleCol: {
    flex: 1,
    gap: 4,
  },
  badgeRow: {
    gap: 6,
    alignItems: 'center',
  },
  durationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  descriptionText: {
    lineHeight: 18,
  },
  progressCol: {
    gap: 6,
    marginTop: 2,
  },
  progressLabels: {
    justifyContent: 'space-between',
  },
  ctaButton: {
    marginTop: 4,
  },
});

