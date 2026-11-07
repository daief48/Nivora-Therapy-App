/**
 * SleepHeroCard — the redesigned hero panel for the Sleepify home screen.
 *
 * Features:
 *  A) Gradient changes by time-of-day:
 *     05:00–11:59  morning  → warm peach
 *     12:00–17:59  afternoon → soft lavender-rose
 *     18:00–20:59  evening  → dusk orange-purple
 *     21:00–04:59  night    → deep indigo / navy
 *
 *  B) Optional twinkling star dots (night gradient only)
 *
 *  C) Luna avatar (SleepAvatar) displayed with the score ring animating
 *     around it inside a frosted circle.
 *
 *  D) TypeWriter greeting bubble (e.g. "Good night, Jubair 🌙")
 *
 *  E) Score ring count-up via AnimatedScoreRing.
 *
 * All text comes from i18n — never hardcoded.
 */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { TypeWriter } from '../../motion/TypeWriter';
import { FadeInUp } from '../../motion/FadeInUp';
import { useT } from '../../i18n';
import { AppText } from '../ui';
import { SourceBadge, type NightEntry } from '../SleepNights';
import { SleepAvatar, scoreToAvatarState } from './SleepAvatar';
import { AnimatedScoreRing } from './AnimatedScoreRing';
import { TwinklingStars } from './TwinklingStars';
import { radius, space } from '../../theme';

// ─── Time-of-day gradient ─────────────────────────────────────────────────────

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

function timeSlot(hour: number): TimeSlot {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 21) return 'evening';
  return 'night';
}

const GRADIENT: Record<TimeSlot, { light: [string, string]; dark: [string, string] }> = {
  morning:   { light: ['#2A2C52', '#1E2044'], dark: ['#1A1E38', '#101430'] },
  afternoon: { light: ['#2A2C52', '#1E2044'], dark: ['#1A1E38', '#101430'] },
  evening:   { light: ['#302850', '#221E44'], dark: ['#1A1E38', '#101430'] },
  night:     { light: ['#1A1E38', '#101430'], dark: ['#141830', '#0C1028'] },
};

const RING_COLOR: Record<TimeSlot, { light: string; dark: string }> = {
  morning:   { light: '#A5B4FC', dark: '#A5B4FC' },
  afternoon: { light: '#A5B4FC', dark: '#A5B4FC' },
  evening:   { light: '#C4B5FD', dark: '#C4B5FD' },
  night:     { light: '#93A6F5', dark: '#93A6F5' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SleepHeroCardProps {
  last: NightEntry | undefined;
  score: number | null;
  userName?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SleepHeroCard({ last, score, userName }: SleepHeroCardProps) {
  const { c, isDark, text, shadow } = useTheme();
  const t = useT();

  const now = new Date();
  const hour = now.getHours();
  const slot = timeSlot(hour);
  const isNight = true; // Sleepify's identity: the hero is always a calm night sky, day or night

  const gradient = useMemo(() => GRADIENT[slot][isDark ? 'dark' : 'light'], [slot, isDark]);
  const ringColor = useMemo(() => RING_COLOR[slot][isDark ? 'dark' : 'light'], [slot, isDark]);

  const avatarState = scoreToAvatarState(score);

  // Build greeting from i18n keys (no hardcoded strings)
  const greeting = useMemo(() => {
    const greetKey = slot === 'morning' ? 'goodMorning'
      : slot === 'afternoon' ? 'goodAfternoon'
      : slot === 'evening' ? 'goodEvening'
      : 'goodNight';
    const base = t(greetKey as never);
    const name = userName ? `, ${userName}` : '';
    const emoji = slot === 'night' ? ' 🌙' : slot === 'morning' ? ' ☀️' : slot === 'evening' ? ' 🌆' : ' ✨';
    return `${base}${name}${emoji}`;
  }, [slot, userName, t]);

  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, shadow('md')]}
    >
      {/* A calm night sky, always: twinkling stars + a glowing crescent moon */}
      <TwinklingStars count={26} />
      <View style={styles.moonGlow} pointerEvents="none">
        <View style={[styles.moonGlowInner, { backgroundColor: 'rgba(165, 180, 252, 0.14)' }]} />
        <View style={styles.moonCrescent} />
      </View>

      {/* Left column: greeting + last-night info */}
      <View style={styles.left}>
        <FadeInUp delay={0}>
          <View style={[styles.bubble, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1 }]}>
            <TypeWriter
              text={greeting}
              speed={38}
              slow
              style={[text(14, '600'), { color: '#E7EAFB' }]}
            />
          </View>
        </FadeInUp>

        <FadeInUp delay={200}>
          <AppText size={30} weight="800" style={{ color: '#F3F4FE', marginTop: space.xs, letterSpacing: 0.3 }}>
            {t('sleepTitle')}
          </AppText>
        </FadeInUp>

        {last ? (
          <FadeInUp delay={340}>
            <View style={{ gap: 2 }}>
              <AppText size={13} style={{ color: 'rgba(231, 234, 251, 0.75)' }}>
                {t('sleepLastNight')}: {t('sleepHours', { h: (last.durationMin / 60).toFixed(1) })}
              </AppText>
              <AppText size={12} style={{ color: 'rgba(231, 234, 251, 0.65)' }}>
                {last.bedtime} → {last.wakeTime}
              </AppText>
              <SourceBadge source={last.source} />
            </View>
          </FadeInUp>
        ) : (
          <FadeInUp delay={340}>
            <AppText size={13} style={{ color: 'rgba(231, 234, 251, 0.75)' }}>
              {t('sleepNoData')}
            </AppText>
          </FadeInUp>
        )}
      </View>

      {/* Right column: avatar inside frosted ring container */}
      <FadeInUp delay={120} style={styles.right}>
        {/* Score ring wraps avatar */}
        <View style={styles.ringWrap}>
          <AnimatedScoreRing
            score={score}
            size={118}
            label={t('sleepScore')}
            color={ringColor}
          />
          {/* Avatar sits centred inside the ring */}
          <View style={styles.avatarOverlay} pointerEvents="none">
            <SleepAvatar state={avatarState} size={60} isDark={isDark} />
          </View>
        </View>
      </FadeInUp>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
    minHeight: 160,
  },
  left: {
    flex: 1,
    gap: 6,
  },
  right: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    maxWidth: 220,
  },
  ringWrap: {
    width: 118,
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moonGlow: {
    position: 'absolute',
    top: -26,
    right: -18,
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moonGlowInner: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  moonCrescent: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FDF6E3',
    shadowColor: '#FDF6E3',
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
});

