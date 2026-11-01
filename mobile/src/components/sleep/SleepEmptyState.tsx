/**
 * SleepEmptyState — empty state illustration and CTA for Recent Nights.
 *
 * Displays Luna avatar sleeping peacefully in bed with soft pillows and blanket,
 * accompanied by a warm invitation to log the user's first night of sleep.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useT } from '../../i18n';
import { FadeInUp } from '../../motion/FadeInUp';
import { radius, space, useTheme } from '../../theme';
import { AppText, Button } from '../ui';

interface SleepEmptyStateProps {
  onLogPress: () => void;
}

/** Bed with Luna tucked in */
function LunaInBedIllustration({ isDark }: { isDark: boolean }) {
  const moonFill = isDark ? '#3D3550' : '#F3E8FF';
  const moonCheek = '#E8A4B0';
  const pillowColor = isDark ? '#2D283E' : '#FFFFFF';
  const blanketColor = isDark ? '#463D60' : '#E6DEF2';
  const blanketFold = isDark ? '#5B507C' : '#D5C9E5';

  return (
    <View style={styles.svgWrap}>
      <Svg width={140} height={100} viewBox="0 0 140 100">
        {/* Soft shadow under bed */}
        <Ellipse cx={70} cy={92} rx={60} ry={7} fill={isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)'} />

        {/* Fluffy Pillow */}
        <Rect x={30} y={30} width={80} height={42} rx={18} fill={pillowColor} />

        {/* Luna resting on pillow */}
        <Circle cx={70} cy={42} r={24} fill={moonFill} />
        {/* Sleeping curved eyes */}
        <Path d="M 60 41 Q 64 37 68 41" stroke="#5A4040" strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Path d="M 72 41 Q 76 37 80 41" stroke="#5A4040" strokeWidth={2.2} strokeLinecap="round" fill="none" />
        {/* Rosy cheeks */}
        <Ellipse cx={58} cy={46} rx={4} ry={2} fill={moonCheek} opacity={0.5} />
        <Ellipse cx={82} cy={46} rx={4} ry={2} fill={moonCheek} opacity={0.5} />
        {/* Peaceful smile */}
        <Path d="M 67 48 Q 70 51 73 48" stroke="#5A4040" strokeWidth={1.8} strokeLinecap="round" fill="none" />

        {/* Blanket covering bottom of Luna */}
        <Path
          d="M 22 56 Q 70 52 118 56 L 118 84 Q 70 88 22 84 Z"
          fill={blanketColor}
        />
        {/* Folded blanket top seam */}
        <Path
          d="M 22 56 Q 70 52 118 56 L 118 63 Q 70 59 22 63 Z"
          fill={blanketFold}
        />

        {/* Floating tiny Z's */}
        <Path
          d="M 88 24 L 95 24 L 88 31 L 95 31"
          stroke="#9AAEDB"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.8}
        />
        <Path
          d="M 98 14 L 107 14 L 98 22 L 107 22"
          stroke="#9AAEDB"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.9}
        />
      </Svg>
    </View>
  );
}

export function SleepEmptyState({ onLogPress }: SleepEmptyStateProps) {
  const { c, isDark } = useTheme();
  const t = useT();

  return (
    <FadeInUp distance={12}>
      <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
        <LunaInBedIllustration isDark={isDark} />
        <View style={styles.textContainer}>
          <AppText size={15} weight="700" style={{ textAlign: 'center' }}>
            {t('sleepNoData')}
          </AppText>
          <AppText size={13} muted style={styles.promptText}>
            {t('sleepEmptyPrompt')}
          </AppText>
        </View>
        <Button
          title={t('sleepLogFirst')}
          icon="create-outline"
          variant="primary"
          onPress={onLogPress}
          style={styles.ctaButton}
        />
      </View>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
  },
  svgWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 104,
  },
  textContainer: {
    alignItems: 'center',
    gap: 6,
    maxWidth: 290,
  },
  promptText: {
    textAlign: 'center',
    lineHeight: 19,
  },
  ctaButton: {
    marginTop: space.xs,
    minWidth: 200,
  },
});

