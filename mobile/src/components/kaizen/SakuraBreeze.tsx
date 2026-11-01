import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSettings } from '../../store/settings';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PetalConfig {
  id: number;
  startX: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
}

const PETALS: PetalConfig[] = [
  { id: 1, startX: SCREEN_WIDTH * 0.15, delay: 0, duration: 9000, size: 16, color: '#FFB7D5' },
  { id: 2, startX: SCREEN_WIDTH * 0.45, delay: 2200, duration: 11000, size: 20, color: '#FFA0C4' },
  { id: 3, startX: SCREEN_WIDTH * 0.75, delay: 4500, duration: 8500, size: 15, color: '#FFCADB' },
  { id: 4, startX: SCREEN_WIDTH * 0.3, delay: 6500, duration: 12000, size: 18, color: '#FFB0CD' },
  { id: 5, startX: SCREEN_WIDTH * 0.85, delay: 8000, duration: 10000, size: 14, color: '#FFD6E5' },
];

function FloatingPetal({ petal }: { petal: PetalConfig }) {
  const reducedMotion = useSettings((s) => s.reducedMotion);

  const translateY = useSharedValue(-50);
  const translateX = useSharedValue(petal.startX);
  const rotation = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;

    translateY.value = withDelay(
      petal.delay,
      withRepeat(withTiming(SCREEN_HEIGHT + 60, { duration: petal.duration }), -1, false),
    );

    translateX.value = withDelay(
      petal.delay,
      withRepeat(
        withSequence(
          withTiming(petal.startX + 35, { duration: petal.duration / 3 }),
          withTiming(petal.startX - 30, { duration: petal.duration / 3 }),
          withTiming(petal.startX, { duration: petal.duration / 3 }),
        ),
        -1,
        true,
      ),
    );

    rotation.value = withDelay(
      petal.delay,
      withRepeat(withTiming(360, { duration: petal.duration / 1.5 }), -1, false),
    );

    opacity.value = withDelay(
      petal.delay,
      withRepeat(
        withSequence(
          withTiming(0.7, { duration: 1200 }),
          withTiming(0.65, { duration: petal.duration - 2400 }),
          withTiming(0, { duration: 1200 }),
        ),
        -1,
        false,
      ),
    );
  }, [reducedMotion, petal, translateY, translateX, rotation, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
    ],
    opacity: opacity.value,
  }));

  if (reducedMotion) return null;

  return (
    <Animated.View style={[styles.petal, animatedStyle]} pointerEvents="none">
      <Svg width={petal.size} height={petal.size * 1.3} viewBox="0 0 24 32">
        <Path
          d="M12 0 C18 6, 24 16, 18 26 C15 30, 9 32, 6 28 C1 22, 6 8, 12 0 Z"
          fill={petal.color}
          opacity={0.8}
        />
      </Svg>
    </Animated.View>
  );
}

/**
 * Ambient floating sakura breeze across the background of Kaizen screen.
 * Adds a serene, living Japanese garden atmosphere.
 */
export function SakuraBreeze() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {PETALS.map((petal) => (
        <FloatingPetal key={petal.id} petal={petal} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  petal: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
