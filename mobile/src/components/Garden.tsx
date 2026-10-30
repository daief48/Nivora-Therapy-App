import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { Blossom, SakuraPetals } from './sakura';

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

/** A calm blossom tree that gains one flower per completed step. Flowers never disappear. */
export function Garden({ flowers, total, label }: { flowers: GardenFlower[]; total: number; label: string }) {
  const { c, isDark } = useTheme();
  const [w, setW] = useState(320);
  const h = Math.round(w * 0.95);
  const slots = useSlots();
  const wood = isDark ? '#7A6A66' : '#8B7A6E';
  const px = (v: number) => (v / 100) * w;
  const py = (v: number) => (v / 100) * h;
  const shown = flowers.slice(-SLOTS);
  const fallen = Math.min(24, Math.max(0, total - SLOTS));
  return (
    <View onLayout={(e) => setW(Math.max(200, Math.round(e.nativeEvent.layout.width)))} accessible accessibilityRole="image" accessibilityLabel={label}
      style={{ height: h, borderRadius: 24, overflow: 'hidden', backgroundColor: c.cardAlt, borderWidth: 1, borderColor: c.border }}>
      <Svg width={w} height={h} style={{ position: 'absolute' }}>
        <Ellipse cx={w * 0.5} cy={h * 0.985} rx={w * 0.42} ry={h * 0.035} fill={c.petal} opacity={0.5} />
        {BRANCHES.map((b, i) => (
          <Path key={i} d={`M${px(b[0]!)} ${py(b[1]!)} Q${px(b[2]!)} ${py(b[3]!)} ${px(b[4]!)} ${py(b[5]!)}`} stroke={wood} strokeWidth={i < 3 ? 5 - i * 0.6 : 2.2} fill="none" strokeLinecap="round" />
        ))}
        {Array.from({ length: fallen }, (_, i) => (
          <Ellipse key={`f${i}`} cx={w * (0.12 + ((i * 0.37) % 0.76))} cy={h * (0.95 + (i % 3) * 0.015)} rx={3.4} ry={1.7} fill={i % 2 ? c.petalDeep : c.petal} opacity={0.8} transform={`rotate(${i * 31} ${w * (0.12 + ((i * 0.37) % 0.76))} ${h * 0.96})`} />
        ))}
        {shown.filter((f) => f.kind === 'BUD').map((f, i) => {
          const s = slots[(shown.indexOf(f)) % SLOTS]!;
          return <Ellipse key={`b${f.id}${i}`} cx={px(s.x)} cy={py(s.y)} rx={3.4} ry={4.6} fill={c.petalDeep} opacity={0.95} />;
        })}
      </Svg>
      {shown.map((f, i) => {
        if (f.kind === 'BUD') return null;
        const s = slots[i % SLOTS]!;
        const size = f.kind === 'FULL_BLOOM' ? 30 : 22;
        return <View key={f.id} pointerEvents="none" style={{ position: 'absolute', left: px(s.x) - size / 2, top: py(s.y) - size / 2 }}><Blossom size={size} deep={f.kind === 'FULL_BLOOM'} rotate={s.rot} /></View>;
      })}
      <SakuraPetals count={5} height={h} />
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
