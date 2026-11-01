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
  morning:   { light: ['#FFE8D4', '#FFDDB3'], dark: ['#3D2E22', '#2E2118'] },
  afternoon: { light: ['#F3E8FF', '#EAE0F5'], dark: ['#2E2940', '#241F36'] },
  evening:   { light: ['#FFD6C0', '#E8CCEE'], dark: ['#3A2830', '#2B2238'] },
  night:     { light: ['#D6DEF5', '#C8D0F0'], dark: ['#1A1E38', '#141830'] },
};

const RING_COLOR: Record<TimeSlot, { light: string; dark: string }> = {
  morning:   { light: '#D4844A', dark: '#E8A870' },
  afternoon: { light: '#8B7EC8', dark: '#C0B0E8' },
  evening:   { light: '#C8688A', dark: '#E8A0B8' },
  night:     { light: '#5C6EB4', dark: '#8899E0' },
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
  const isNight = slot === 'night' || slot === 'evening';

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
      {/* Night-only twinkling stars */}
      {isNight ? <TwinklingStars count={18} /> : null}

      {/* Left column: greeting + last-night info */}
      <View style={styles.left}>
        <FadeInUp delay={0}>
          <View style={[styles.bubble, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.6)' }]}>
            <TypeWriter
              text={greeting}
              speed={38}
              slow
              style={[text(14, '600'), { color: c.onHero }]}
            />
          </View>
        </FadeInUp>

        <FadeInUp delay={200}>
          <AppText size={26} weight="800" style={{ color: c.onHero, marginTop: space.xs }}>
            {t('sleepTitle')}
          </AppText>
        </FadeInUp>

        {last ? (
          <FadeInUp delay={340}>
            <View style={{ gap: 2 }}>
              <AppText size={13} style={{ color: c.onHeroMuted }}>
                {t('sleepLastNight')}: {t('sleepHours', { h: (last.durationMin / 60).toFixed(1) })}
              </AppText>
              <AppText size={12} style={{ color: c.onHeroMuted }}>
                {last.bedtime} → {last.wakeTime}
              </AppText>
              <SourceBadge source={last.source} />
            </View>
          </FadeInUp>
        ) : (
          <FadeInUp delay={340}>
            <AppText size={13} style={{ color: c.onHeroMuted }}>
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
    maxWidth: 200,
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
});

