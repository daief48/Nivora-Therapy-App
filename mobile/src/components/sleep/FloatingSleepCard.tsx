/**
 * FloatingSleepCard — Tiltable 3D-perspective night entry cards for the Recent Nights list.
 *
 * Each card:
 *  - Has a subtle gradient background tied to its score quality.
 *  - Tilts slightly on press (perspective transform).
 *  - Long-press reveals a "Share" shimmer overlay (placeholder for image export).
 *  - Staggered FadeInUp on initial render.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText, Row } from '../ui';
import { radius, space } from '../../theme';
import { useTheme } from '../../theme';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NightCardData {
  date: string;
  score: number | null;
  durationMin: number;
  bedtime: string;
  wakeTime: string;
  awakenings: number;
}

interface FloatingSleepCardProps {
  night: NightCardData;
  index: number;
  onPress?: () => void;
}

// ─── Gradient palette by score ────────────────────────────────────────────────

function scoreGradient(score: number | null, isDark: boolean): [string, string] {
  if (score == null) return isDark ? ['#1E2030', '#252840'] : ['#F0F0F5', '#E8E8F0'];
  if (score >= 80) return isDark ? ['#1A2838', '#1E3040'] : ['#E8F4FD', '#D6EEF8'];   // great — blue
  if (score >= 65) return isDark ? ['#1E2830', '#222E38'] : ['#EDF6F0', '#DFF0E4'];   // good — green
  if (score >= 50) return isDark ? ['#28241E', '#302C20'] : ['#FDF8E8', '#F5EDD4'];   // okay — amber
  return isDark ? ['#2A1E1E', '#301F1F'] : ['#FDF0F0', '#F8E0E0'];                     // poor — rose
}

function scoreEmoji(score: number | null): string {
  if (score == null) return '☁️';
  if (score >= 80) return '⭐';
  if (score >= 65) return '🌙';
  if (score >= 50) return '🌤️';
  return '🌑';
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FloatingSleepCard({ night, index, onPress }: FloatingSleepCardProps) {
  const { isDark, c } = useTheme();
  const gradient = scoreGradient(night.score, isDark);

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);
  const tiltX = useSharedValue(0);
  const shareOpacity = useSharedValue(0);

  useEffect(() => {
    const delay = index * 60;
    opacity.value = withDelay(delay, withTiming(1, { duration: 360 }));
    translateY.value = withDelay(delay, withSpring(0, { damping: 14, stiffness: 100 }));
  }, [opacity, translateY, index]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { perspective: 800 },
      { rotateX: `${tiltX.value}deg` },
    ],
  }));

  const shareStyle = useAnimatedStyle(() => ({
    opacity: shareOpacity.value,
  }));

  const handlePressIn = () => {
    tiltX.value = withSpring(-3, { damping: 8, stiffness: 200 });
  };
  const handlePressOut = () => {
    tiltX.value = withSpring(0, { damping: 10, stiffness: 150 });
  };
  const handleLongPress = () => {
    shareOpacity.value = withTiming(1, { duration: 200 });
    setTimeout(() => {
      shareOpacity.value = withTiming(0, { duration: 400 });
    }, 1500);
  };

  const dateLabel = (() => {
    try {
      return new Date(night.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return night.date;
    }
  })();

  return (
    <Animated.View style={[styles.wrapper, cardStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${dateLabel} sleep score ${night.score ?? 'not available'}`}
      >
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          {/* Score emoji */}
          <AppText size={28} style={styles.emoji}>{scoreEmoji(night.score)}</AppText>

          {/* Main info */}
          <View style={styles.info}>
            <AppText size={13} weight="700" style={{ color: c.text }}>{dateLabel}</AppText>
            <AppText size={12} muted>{night.bedtime} → {night.wakeTime}</AppText>
            <AppText size={12} muted>{formatDuration(night.durationMin)}</AppText>
          </View>

          {/* Score badge */}
          {night.score != null ? (
            <View style={[styles.scoreBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}>
              <AppText size={16} weight="800" style={{ color: c.text }}>{night.score}</AppText>
            </View>
          ) : null}

          {/* Long-press share overlay */}
          <Animated.View style={[styles.shareOverlay, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }, shareStyle]}>
            <AppText size={12} weight="600" style={{ color: c.text }}>📤 Share</AppText>
          </Animated.View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: space.sm,
  },
  card: {
    borderRadius: radius.lg,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 76,
    overflow: 'hidden',
  },
  emoji: {
    width: 40,
    textAlign: 'center',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  scoreBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

