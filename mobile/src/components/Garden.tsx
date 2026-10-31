import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';
import type { Season } from '../api/monthly';
import { useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { SEASON_PALETTE } from '../utils/shareCard';
import { Blossom } from './sakura';

export type FlowerKind = 'BUD' | 'BLOOM' | 'FULL_BLOOM';
export interface GardenFlower { id: string; date: string; kind: FlowerKind; index: number }
export interface GardenDay { date: string; count: number }

// Branches as quadratic curves in a 100 x 100 space: [x0,y0, cx,cy, x1,y1]. Trunk rises from the bottom centre.
const BRANCHES: number[][] = [
  [48, 100, 40, 78, 16, 58], [48, 100, 52, 70, 50, 30], [48, 100, 62, 78, 86, 56],
  [30, 70, 24, 56, 10, 40], [52, 56, 70, 46, 82, 30], [46, 48, 36, 36, 30, 18],
];
const SLOTS = 60;

const at = (b: number[], t: number) => {
  const [x0, y0, cx, cy, x1, y1] = b as [number, number, number, number, number, number];
  const u = 1 - t;
  return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 };
};

/** Blossom positions along the branches, in the order flowers appear. Deterministic: the same garden always looks the same. */
function useSlots() {
  return useMemo(() => {
    const out: { x: number; y: number; rot: number }[] = [];
    for (let i = 0; i < SLOTS; i++) {
      const b = BRANCHES[i % BRANCHES.length]!;
      const t = 0.3 + (((Math.floor(i / BRANCHES.length) * 0.17) + (i % 3) * 0.06) % 0.7);
      const p = at(b, t);
      out.push({ x: p.x + Math.sin(i * 12.9) * 3.2, y: p.y + Math.cos(i * 7.3) * 3.2, rot: (i * 37) % 72 });
    }
    return out;
  }, []);
}

const BITS = [
  { x: 0.1, size: 12, dur: 12000, delay: 0, sway: 18 }, { x: 0.28, size: 9, dur: 14000, delay: 3000, sway: 14 },
  { x: 0.46, size: 13, dur: 13000, delay: 6000, sway: 22 }, { x: 0.64, size: 10, dur: 15000, delay: 1500, sway: 16 },
  { x: 0.8, size: 12, dur: 12500, delay: 4500, sway: 20 }, { x: 0.92, size: 9, dur: 14500, delay: 7500, sway: 12 },
];

function Bit({ b, i, height, still, fill, round }: { b: (typeof BITS)[number]; i: number; height: number; still: boolean; fill: string; round: boolean }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.sequence([Animated.delay(b.delay), Animated.timing(p, { toValue: 1, duration: b.dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [still, p, b]);
  const left = `${b.x * 100}%` as const;
  const shape = { width: b.size, height: round ? b.size : b.size * 0.6, borderRadius: b.size, backgroundColor: fill };
  if (still) return <View style={[{ position: 'absolute', left, top: 20 + ((i * 61) % Math.max(40, height - 60)), opacity: 0.5, transform: [{ rotate: `${i * 40}deg` }] }, shape]} />;
  return (
    <Animated.View style={[{
      position: 'absolute', left, top: -20, opacity: p.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 0.75, 0.75, 0] }),
      transform: [
        { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, height + 20] }) },
        { translateX: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, b.sway, -b.sway] }) },
        { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', i % 2 ? '260deg' : '-200deg'] }) },
      ],
    }, shape]} />
  );
}

/** Season-coloured petals / leaves / snow drifting down. Transform and opacity only; a still scatter under reduced motion. */
function Ambient({ season, height, still }: { season: Season; height: number; still: boolean }) {
  const pal = SEASON_PALETTE[season];
  const fill = season === 'SPRING' ? pal.petalDeep : season === 'WINTER' ? '#FFFFFF' : pal.leaf;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, top: 0, height, overflow: 'hidden' }}>
      {BITS.map((b, i) => <Bit key={i} b={b} i={i} height={height} still={still} fill={fill} round={season === 'WINTER'} />)}
    </View>
  );
}

/** A newly opened flower: a soft pop (scale + fade). Shown at rest under reduced motion. */
function Pop({ children, still, delay }: { children: React.ReactNode; still: boolean; delay: number }) {
  const p = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) { p.setValue(1); return; }
    const a = Animated.sequence([Animated.delay(delay), Animated.spring(p, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true })]);
    a.start();
    return () => a.stop();
  }, [still, p, delay]);
  return (
    <Animated.View testID="garden-new-bloom" style={{ opacity: p.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }), transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }}>{children}</Animated.View>
  );
}

/**
 * A calm blossom tree that gains one flower per completed step. Flowers never disappear.
 * `season` tints the scene; `newCount` is how many of the latest flowers just opened (they get a gentle pop).
 */
export function Garden({ flowers, total, label, season = 'SPRING', newCount = 0 }: { flowers: GardenFlower[]; total: number; label: string; season?: Season; newCount?: number }) {
  const { c, isDark } = useTheme();
  const reduced = useReducedMotion();
  const pal = SEASON_PALETTE[season];
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { sway.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, sway]);
  const [w, setW] = useState(320);
  const h = Math.round(w * 0.95);
  const slots = useSlots();
  const wood = isDark ? '#7A6A66' : '#8B7A6E';
  const px = (v: number) => (v / 100) * w;
  const py = (v: number) => (v / 100) * h;
  const shown = flowers.slice(-SLOTS);
  const fallen = Math.min(24, Math.max(0, total - SLOTS));
  const petal = season === 'SPRING' ? c.petal : pal.petal;
  const petalDeep = season === 'SPRING' ? c.petalDeep : pal.petalDeep;
  const firstNew = shown.length - Math.min(newCount, shown.length);
  return (
    <View onLayout={(e) => setW(Math.max(200, Math.round(e.nativeEvent.layout.width)))} accessible accessibilityRole="image" accessibilityLabel={label}
      style={{ height: h, borderRadius: 24, overflow: 'hidden', backgroundColor: isDark ? pal.bgDark : pal.bg, borderWidth: 1, borderColor: c.border }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, transform: [{ rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['-0.6deg', '0.6deg'] }) }] }}>
        <Svg width={w} height={h} style={{ position: 'absolute' }}>
          <Ellipse cx={w * 0.5} cy={h * 0.985} rx={w * 0.42} ry={h * 0.035} fill={petal} opacity={0.5} />
          {BRANCHES.map((b, i) => (
            <Path key={i} d={`M${px(b[0]!)} ${py(b[1]!)} Q${px(b[2]!)} ${py(b[3]!)} ${px(b[4]!)} ${py(b[5]!)}`} stroke={wood} strokeWidth={i < 3 ? 5 - i * 0.6 : 2.2} fill="none" strokeLinecap="round" />
          ))}
          {Array.from({ length: fallen }, (_, i) => (
            <Ellipse key={`f${i}`} cx={w * (0.12 + ((i * 0.37) % 0.76))} cy={h * (0.95 + (i % 3) * 0.015)} rx={3.4} ry={1.7} fill={i % 2 ? petalDeep : petal} opacity={0.8} transform={`rotate(${i * 31} ${w * (0.12 + ((i * 0.37) % 0.76))} ${h * 0.96})`} />
          ))}
          {shown.filter((f) => f.kind === 'BUD').map((f, i) => {
            const s = slots[(shown.indexOf(f)) % SLOTS]!;
            return <Ellipse key={`b${f.id}${i}`} cx={px(s.x)} cy={py(s.y)} rx={3.4} ry={4.6} fill={petalDeep} opacity={0.95} />;
          })}
        </Svg>
        {shown.map((f, i) => {
          if (f.kind === 'BUD') return null;
          const s = slots[i % SLOTS]!;
          const size = f.kind === 'FULL_BLOOM' ? 30 : 22;
          const bloom = <Blossom size={size} deep={f.kind === 'FULL_BLOOM'} rotate={s.rot} />;
          const isNew = newCount > 0 && i >= firstNew;
          return (
            <View key={f.id} pointerEvents="none" style={{ position: 'absolute', left: px(s.x) - size / 2, top: py(s.y) - size / 2 }}>
              {isNew ? <Pop still={reduced} delay={400 + (i - firstNew) * 350}>{bloom}</Pop> : bloom}
            </View>
          );
        })}
      </Animated.View>
      <Ambient season={season} height={h} still={reduced} />
    </View>
  );
}

/** The last 90 days as quiet dots: a blossom colour where a step was taken, nothing where it was not (no gaps are called out). */
export function DayDots({ days }: { days: GardenDay[] }) {
  const { c } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {days.map((d) => (
        <View key={d.date} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: d.count ? (d.count > 1 ? c.petalDeep : c.petal) : c.border, opacity: d.count ? 1 : 0.45 }} />
      ))}
    </View>
  );
}
