import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useT } from '../i18n';
import { useTheme } from '../theme';
import { hasData, type Point } from '../utils/moods';
import { AppText, EmptyState } from './ui';

/** Simple accessible line chart of user-reported mood (and optional stress) on a 1–5 scale. */
export function MoodChart({ points, width = 320, height = 180 }: { points: Point[]; width?: number; height?: number }) {
  const { c } = useTheme();
  const t = useT();
  if (!hasData(points)) return <EmptyState body={t('chartEmpty')} />;
  const padL = 24, padR = 8, padT = 10, padB = 24;
  const w = width - padL - padR, h = height - padT - padB;
  const x = (i: number) => padL + (points.length === 1 ? w / 2 : (i * w) / (points.length - 1));
  const y = (v: number) => padT + h - ((v - 1) / 4) * h;
  const line = (key: 'mood' | 'stress') =>
    points.map((p, i) => (p[key] === null ? null : `${x(i)},${y(p[key] as number)}`)).filter(Boolean).join(' ');
  const summary = points.filter((p) => p.mood !== null).map((p) => `${p.label}: ${p.mood}`).join(', ');
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
        {points.some((p) => p.stress !== null) ? <Polyline points={line('stress')} fill="none" stroke={c.accent} strokeWidth={2} strokeDasharray="5,4" /> : null}
        <Polyline points={line('mood')} fill="none" stroke={c.primary} strokeWidth={3} />
        {points.map((p, i) => (p.mood === null ? null : <Circle key={i} cx={x(i)} cy={y(p.mood)} r={4} fill={c.primary} />))}
        {points.map((p, i) => (i % step === 0 ? <SvgText key={`l${i}`} x={x(i)} y={height - 6} fontSize={10} fill={c.textMuted} textAnchor="middle">{p.label}</SvgText> : null))}
      </Svg>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        <AppText size={12} muted>━ {t('moodScore')}</AppText>
        <AppText size={12} muted>┅ {t('stressScore')}</AppText>
      </View>
    </View>
  );
}
