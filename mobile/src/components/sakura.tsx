import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';

/** One five-petal cherry blossom. */
export function Blossom({ size = 28, deep = false, rotate = 0 }: { size?: number; deep?: boolean; rotate?: number }) {
  const { c } = useTheme();
  const fill = deep ? c.petalDeep : c.petal;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" style={{ transform: [{ rotate: `${rotate}deg` }] }}>
      <G>
        {[0, 72, 144, 216, 288].map((a) => (
          <Ellipse key={a} cx={20} cy={10} rx={6.2} ry={8.4} fill={fill} opacity={0.95} transform={`rotate(${a} 20 20)`} />
        ))}
        <Circle cx={20} cy={20} r={3.2} fill={c.accent} />
        {[0, 72, 144, 216, 288].map((a) => <Circle key={a} cx={20 + 6 * Math.sin((a * Math.PI) / 180)} cy={20 - 6 * Math.cos((a * Math.PI) / 180)} r={0.9} fill={c.accent} />)}
      </G>
    </Svg>
  );
}

/** A single drifting petal (teardrop). */
function Petal({ size, deep }: { size: number; deep: boolean }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path d="M10 1 C16 4 18 11 10 19 C2 11 4 4 10 1 Z" fill={deep ? c.petalDeep : c.petal} opacity={0.9} />
      <Path d="M10 3 L10 15" stroke={c.accent} strokeWidth={0.6} opacity={0.5} />
    </Svg>
  );
}

const SEEDS = [
  { x: 0.08, size: 14, dur: 11000, delay: 0, sway: 22, deep: false }, { x: 0.22, size: 10, dur: 13500, delay: 2500, sway: 16, deep: true },
  { x: 0.38, size: 16, dur: 12000, delay: 5200, sway: 26, deep: false }, { x: 0.55, size: 11, dur: 14500, delay: 800, sway: 18, deep: false },
  { x: 0.7, size: 15, dur: 10500, delay: 3600, sway: 24, deep: true }, { x: 0.84, size: 10, dur: 13000, delay: 6400, sway: 14, deep: false },
  { x: 0.93, size: 13, dur: 12500, delay: 1600, sway: 20, deep: false },
];

/**
 * Gently falling sakura petals. Absolutely positioned and non-interactive; use inside a bounded container.
 * Animates on the native driver. With reduced motion the petals are a still, scattered decoration.
 */
export function SakuraPetals({ count = 5, height = 260, style }: { count?: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useSettings((s) => s.reducedMotion);
  const seeds = useMemo(() => SEEDS.slice(0, Math.min(count, SEEDS.length)), [count]);
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height, overflow: 'hidden' }, style]}>
      {seeds.map((s, i) => <FallingPetal key={i} seed={s} height={height} still={reduced} index={i} />)}
    </View>
  );
}

function FallingPetal({ seed, height, still, index }: { seed: (typeof SEEDS)[number]; height: number; still: boolean; index: number }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(seed.delay),
      Animated.timing(p, { toValue: 1, duration: seed.dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, p, seed]);
  const left = `${seed.x * 100}%` as const;
  if (still) return <View style={{ position: 'absolute', left, top: 14 + ((index * 53) % (height - 40)), transform: [{ rotate: `${index * 47}deg` }], opacity: 0.55 }}><Petal size={seed.size} deep={seed.deep} /></View>;
  return (
    <Animated.View style={{
      position: 'absolute', left, top: -24, opacity: p.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 0.85, 0.85, 0] }),
      transform: [
        { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, height + 20] }) },
        { translateX: p.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, seed.sway, 0, -seed.sway, 0] }) },
        { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', index % 2 ? '300deg' : '-240deg'] }) },
      ],
    }}>
      <Petal size={seed.size} deep={seed.deep} />
    </Animated.View>
  );
}

/** Minimal blossoming branch for a corner of a hero surface. Decorative only. */
export function BlossomBranch({ width = 150, flip = false }: { width?: number; flip?: boolean }) {
  const { c, isDark } = useTheme();
  const wood = isDark ? '#7A6A66' : '#8B7A6E';
  const h = width * 0.62;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, right: flip ? undefined : 0, left: flip ? 0 : undefined, width, height: h, transform: [{ scaleX: flip ? -1 : 1 }], opacity: isDark ? 0.8 : 1 }}>
      <Svg width={width} height={h} viewBox="0 0 150 93">
        <Path d="M150 6 C118 10 98 22 76 40 C62 52 48 56 30 80" stroke={wood} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <Path d="M104 24 C98 34 92 40 82 44" stroke={wood} strokeWidth={1.6} fill="none" strokeLinecap="round" />
        <Path d="M64 48 C60 58 52 64 44 66" stroke={wood} strokeWidth={1.4} fill="none" strokeLinecap="round" />
        <G opacity={0.55}><Ellipse cx={128} cy={9} rx={7} ry={2.6} fill={c.success} transform="rotate(-12 128 9)" /><Ellipse cx={92} cy={32} rx={6} ry={2.4} fill={c.success} transform="rotate(30 92 32)" /></G>
      </Svg>
      <View style={{ position: 'absolute', left: 92, top: 4 }}><Blossom size={26} /></View>
      <View style={{ position: 'absolute', left: 64, top: 24 }}><Blossom size={22} deep rotate={20} /></View>
      <View style={{ position: 'absolute', left: 104, top: 24 }}><Blossom size={18} rotate={40} /></View>
      <View style={{ position: 'absolute', left: 36, top: 46 }}><Blossom size={20} rotate={10} /></View>
      <View style={{ position: 'absolute', left: 14, top: 58 }}><Blossom size={14} deep /></View>
    </View>
  );
}
