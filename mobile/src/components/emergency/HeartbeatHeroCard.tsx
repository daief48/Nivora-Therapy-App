import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText, Row } from '../ui';
import { radius, space, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface HeartbeatHeroCardProps {
  online: boolean;
}

export function HeartbeatHeroCard({ online }: HeartbeatHeroCardProps) {
  const t = useT();
  const { isDark, shadow } = useTheme();

  // Gentle anatomical resting heartbeat rhythm (60-70 bpm cadence)
  const pulse = useSharedValue(1);
  const glow = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: 250 }),
        withTiming(1.0, { duration: 200 }),
        withTiming(1.012, { duration: 200 }),
        withTiming(1.0, { duration: 1350 }),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 450 }),
        withTiming(0.35, { duration: 1550 }),
      ),
      -1,
      false,
    );
  }, [pulse, glow]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const animatedGlowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
  }));

  // Warm, deeply grounded crimson & rose palette (soothing rather than alarming red)
  const gradientColors: [string, string] = isDark
    ? ['#4A121A', '#2D0B12']
    : ['#7A1B29', '#55111D'];

  return (
    <Animated.View style={[styles.wrapper, animatedCardStyle, shadow('md')]}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        <Row style={styles.headerRow}>
          <View style={styles.iconContainer}>
            <Animated.View style={[styles.glowRing, animatedGlowStyle]} />
            <Svg width={36} height={36} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                fill="#FFCAD4"
              />
            </Svg>
          </View>
          <View style={styles.textColumn}>
            <AppText size={22} weight="800" style={styles.titleText}>
              {t('emHeartbeatTitle')}
            </AppText>
            <AppText size={13} style={styles.subText}>
              {t('emHeartbeatSub')}
            </AppText>
          </View>
        </Row>

        {!online && (
          <View style={styles.offlinePill}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ marginRight: 6 }}>
              <Circle cx={12} cy={12} r={9} stroke="#FFCAD4" strokeWidth={2} />
              <Path d="M12 7v6M12 17h.01" stroke="#FFCAD4" strokeWidth={2} strokeLinecap="round" />
            </Svg>
            <AppText size={12} weight="600" style={styles.offlineText}>
              {t('emergencyOffline')}
            </AppText>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: space.xs,
  },
  container: {
    borderRadius: radius.xl,
    padding: space.lg,
    overflow: 'hidden',
  },
  headerRow: {
    alignItems: 'center',
    gap: space.md,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 202, 212, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#FFCAD4',
  },
  textColumn: {
    flex: 1,
    gap: 4,
  },
  titleText: {
    color: '#FFF1F3',
    letterSpacing: 0.2,
  },
  subText: {
    color: 'rgba(255, 241, 245, 0.88)',
    lineHeight: 19,
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  offlineText: {
    color: '#FFCAD4',
  },
});

