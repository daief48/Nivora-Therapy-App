/**
 * ActiveProgramBanner — spotlight card shown in Kaizen Tab 1 when a user is enrolled in a program.
 * Displays companion avatar, current lesson progress, and quick-continue CTA.
 */
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { PressScale } from '../../motion/PressScale';
import { radius, space, useTheme } from '../../theme';
import type { ProgramSummary } from '../../screens/ProgramsScreen';
import { AvatarMini } from '../Avatar';
import { AppText, Button, Icon, ProgressBar, Row } from '../ui';

interface Props {
  program: ProgramSummary;
  onContinue: () => void;
}

const PROGRAM_ICONS = {
  'stress-7': 'leaf-outline',
  'anxiety-14': 'flower-outline',
  'cbti-21': 'moon-outline',
} as const;

export function ActiveProgramBanner({ program, onContinue }: Props) {
  const { c, isDark, shadow } = useTheme();
  const t = useT();

  const iconName = PROGRAM_ICONS[program.id as keyof typeof PROGRAM_ICONS] ?? 'book-outline';
  const progressText = t('progProgress', { done: program.completedCount, total: program.days });

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`${program.title}, ${progressText}`}
      onPress={onContinue}
      scaleTo={0.98}
      style={[styles.container, shadow('sm')]}
    >
      <LinearGradient
        colors={isDark ? ['#322838', '#261F2C'] : ['#F9EFF5', '#EFE4EE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, { borderColor: isDark ? '#46384E' : '#E8DCE6' }]}
      >
        {/* Header row: Tag + Avatar */}
        <Row style={styles.headerRow}>
          <Row style={styles.tagWrap}>
            <View style={[styles.iconWrap, { backgroundColor: c.lavender }]}>
              <Icon name={iconName} size={14} color={c.primary} />
            </View>
            <AppText size={11} weight="700" style={{ color: c.primary }}>
              {t('kzActiveProgram')}
            </AppText>
          </Row>

          <Row style={styles.avatarWrap}>
            <AvatarMini size={26} />
          </Row>
        </Row>

        {/* Title & Progress */}
        <View style={styles.infoCol}>
          <AppText size={16} weight="800" numberOfLines={1}>
            {program.title}
          </AppText>
          <AppText size={12} muted>
            {progressText}
          </AppText>
        </View>

        <ProgressBar
          value={program.completedCount}
          max={program.days}
          label={progressText}
        />

        {/* Continue Action */}
        <Row style={styles.actionRow}>
          <Button
            title={t('progContinue')}
            icon="chevron-forward"
            variant="primary"
            onPress={onContinue}
            style={styles.actionBtn}
          />
        </Row>
      </LinearGradient>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  gradient: {
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
    borderWidth: 1,
  },
  headerRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tagWrap: {
    gap: 6,
    alignItems: 'center',
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCol: {
    gap: 2,
  },
  actionRow: {
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  actionBtn: {
    alignSelf: 'flex-end',
  },
});
