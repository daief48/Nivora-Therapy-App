import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useT } from '../i18n';
import { useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { hasData, type Point } from '../utils/moods';
import { AppText, EmptyState } from './ui';

/** 0 -> 1 over `ms` with ease-out; already 1 under reduced motion (the chart is simply drawn). Transform-free: drives stroke-dasharray. */
export function useDrawIn(ms = 1100, key: unknown = 0): number {
  const reduced = useReducedMotion();
  const [p, setP] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { setP(1); return; }
    setP(0);
    const t0 = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      setP(1 - Math.pow(1 - k, 3));
      if (k >= 1) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [reduced, ms, key]);
  return p;
}

const lengthOf = (pts: string) => {
  const xy = pts.split(' ').map((s) => s.split(',').map(Number));
  let len = 0;
  for (let i = 1; i < xy.length; i++) len += Math.hypot((xy[i]![0] ?? 0) - (xy[i - 1]![0] ?? 0), (xy[i]![1] ?? 0) - (xy[i - 1]![1] ?? 0));
  return Math.ceil(len) + 2;
};

/** Accessible line chart of user-reported mood (and optional stress) on a 1-5 scale. The mood line draws itself in; static under reduced motion. */
export function MoodChart({ points, width = 320, height = 180 }: { points: Point[]; width?: number; height?: number }) {
  const { c } = useTheme();
  const t = useT();
  const p = useDrawIn(1100, points.length);
  if (!hasData(points)) return <EmptyState body={t('chartEmpty')} />;
  const padL = 24, padR = 8, padT = 10, padB = 24;
  const w = width - padL - padR, h = height - padT - padB;
  const x = (i: number) => padL + (points.length === 1 ? w / 2 : (i * w) / (points.length - 1));
  const y = (v: number) => padT + h - ((v - 1) / 4) * h;
  const line = (key: 'mood' | 'stress') =>
    points.map((pt, i) => (pt[key] === null ? null : `${x(i)},${y(pt[key] as number)}`)).filter(Boolean).join(' ');
  const moodLine = line('mood');
  const len = lengthOf(moodLine || '0,0 0,0');
  const summary = points.filter((pt) => pt.mood !== null).map((pt) => `${pt.label}: ${pt.mood}`).join(', ');
  const step = Math.ceil(points.length / 6);
  return (
    <View accessible accessibilityLabel={`${t('moodScore')}: ${summary}`}>
      <Svg width={width} height={height}>
        {[1, 2, 3, 4, 5].map((v) => (
          <React.Fragment key={v}>
            <Line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={c.border} strokeWidth={1} />
            <SvgText x={4} y={y(v) + 4} fontSize={10} fill={c.textMuted}>{v}</SvgText>
          </React.Fragment>
        ))}
        {points.some((pt) => pt.stress !== null) ? <Polyline points={line('stress')} fill="none" stroke={c.accent} strokeWidth={2} strokeDasharray="5,4" opacity={0.4 + 0.6 * p} /> : null}
        <Polyline points={moodLine} fill="none" stroke={c.primary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p >= 1 ? undefined : `${len * p} ${len}`} />
        {points.map((pt, i) => (pt.mood === null || i / Math.max(1, points.length - 1) > p ? null : <Circle key={i} cx={x(i)} cy={y(pt.mood)} r={4} fill={c.card} stroke={c.primary} strokeWidth={2.5} />))}
        {points.map((pt, i) => (i % step === 0 ? <SvgText key={`l${i}`} x={x(i)} y={height - 6} fontSize={10} fill={c.textMuted} textAnchor="middle">{pt.label}</SvgText> : null))}
      </Svg>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        <AppText size={12} muted>━ {t('moodScore')}</AppText>
        <AppText size={12} muted>┅ {t('stressScore')}</AppText>
      </View>
    </View>
  );
}
