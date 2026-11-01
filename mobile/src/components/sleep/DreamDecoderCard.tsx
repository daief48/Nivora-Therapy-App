/**
 * DreamDecoderCard — Luna's poetic archetype metaphor for last night's sleep.
 *
 * Appears on the SleepScreen beneath the diary-saved confirmation.
 * Calls POST /sleep/dream-decode on mount and renders:
 *   - Loading: subtle pulsing opacity on placeholder rows.
 *   - Success: large archetype emoji in a glowing circle, archetype badge, italic metaphor text.
 *   - Error: static fallback metaphor text in italics.
 *
 * Archetype → colour map: ⭐ gold | 🌊 blue | ⛈️ purple | 🌸 pink | 🌑 dark-indigo.
 * Wraps content in a <Card> with a soft top border of the archetype colour.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { api } from '../../api/client';
import { useT } from '../../i18n';
import { radius, space, useTheme } from '../../theme';
import { AppText, Card } from '../ui';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DreamDecoderCardProps {
  durationMin: number;
  awakenings: number;
  rested: number;
  score: number;
}

// ─── API response shape ───────────────────────────────────────────────────────

interface DreamDecodeResponse {
  archetypeEmoji: string;
  archetypeName: string;
  metaphor: string;
}

// ─── Archetype colour map ─────────────────────────────────────────────────────

const ARCHETYPE_COLORS: Record<string, string> = {
  '⭐': '#F5C842',
  '🌊': '#5BA8C4',
  '⛈️': '#7B68C8',
  '🌸': '#E8A0B8',
  '🌑': '#3A3A5C',
};

const DEFAULT_ARCHETYPE_COLOR = '#8899E0';

function archetypeColor(emoji: string): string {
  return ARCHETYPE_COLORS[emoji] ?? DEFAULT_ARCHETYPE_COLOR;
}

// ─── Loading placeholder ──────────────────────────────────────────────────────

function LoadingPlaceholder() {
  const { c } = useTheme();
  const t = useT();
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 900 }),
        withTiming(1.0, { duration: 900 }),
      ),
      -1,
      true,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.loadingWrap, animStyle]}>
      {/* Emoji circle placeholder */}
      <View style={[styles.emojiCircle, { backgroundColor: c.cardAlt }]} />
      {/* Text placeholder rows */}
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.placeholderRow, { width: '50%', backgroundColor: c.cardAlt }]} />
        <View style={[styles.placeholderRow, { width: '90%', backgroundColor: c.cardAlt }]} />
        <View style={[styles.placeholderRow, { width: '75%', backgroundColor: c.cardAlt }]} />
      </View>
      <AppText size={13} muted style={{ marginTop: space.xs }}>
        {t('slDreamLoading')}
      </AppText>
    </Animated.View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DreamDecoderCard({ durationMin, awakenings, rested, score }: DreamDecoderCardProps) {
  const { c } = useTheme();
  const t = useT();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DreamDecodeResponse | null>(null);
  const [error, setError] = useState(false);

  // Store abort controller in ref to clean up on unmount
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(false);

    api<DreamDecodeResponse>('/sleep/dream-decode', {
      method: 'POST',
      body: { durationMin, awakenings, rested, score },
      signal: controller.signal,
    })
      .then((res) => {
        setData(res);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') {
          setError(true);
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [durationMin, awakenings, rested, score]);

  // Determine archetype colour for border and glow
  const accentColor = data ? archetypeColor(data.archetypeEmoji) : DEFAULT_ARCHETYPE_COLOR;

  return (
    <Card
      style={[
        styles.card,
        { borderTopColor: accentColor, borderTopWidth: 3, borderColor: accentColor },
      ]}
    >
      {/* Title */}
      <AppText size={13} weight="700" muted>
        {t('slDreamTitle')}
      </AppText>

      {loading ? (
        <LoadingPlaceholder />
      ) : error || !data ? (
        /* Error / fallback */
        <AppText size={15} style={styles.metaphorText} muted>
          {t('slDreamError')}
        </AppText>
      ) : (
        /* Success */
        <View style={styles.successRow}>
          {/* Glowing emoji circle */}
          <View style={styles.glowWrap}>
            <View
              style={[
                styles.emojiCircleGlow,
                { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}55` },
              ]}
            >
              <AppText size={42} style={styles.emojiText}>
                {data.archetypeEmoji}
              </AppText>
            </View>
          </View>

          <View style={styles.textCol}>
            {/* Archetype badge */}
            <View style={[styles.badge, { backgroundColor: `${accentColor}22` }]}>
              <AppText size={12} weight="700" style={{ color: accentColor }}>
                {data.archetypeName}
              </AppText>
            </View>

            {/* Metaphor text */}
            <AppText size={15} style={[styles.metaphorText, { color: c.text }]}>
              {data.metaphor}
            </AppText>
          </View>
        </View>
      )}
    </Card>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  emojiCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  emojiCircleGlow: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    lineHeight: 56,
    includeFontPadding: false,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  textCol: {
    flex: 1,
    gap: space.xs,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metaphorText: {
    fontStyle: 'italic',
    lineHeight: 22,
  },
  placeholderRow: {
    height: 12,
    borderRadius: 6,
  },
});
