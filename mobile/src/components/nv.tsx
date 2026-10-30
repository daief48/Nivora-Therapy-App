import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { radius, useTheme } from '../theme';
import { AppText, Icon, Row } from './ui';

/** 1-10 tap scale (mood, stress, energy, rested). Low-to-high colour ramp stays calm, never alarming. */
export function ScalePicker({ value, onChange, label, lowLabel, highLabel }: { value: number; onChange: (n: number) => void; label: string; lowLabel?: string; highLabel?: string }) {
  const { c, text } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText weight="700">{label}</AppText>
        <View style={{ backgroundColor: c.lavender, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 2 }}>
          <AppText weight="800" style={{ color: c.primary }}>{value}/10</AppText>
        </View>
      </Row>
      <View accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 1, max: 10, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(Math.max(1, Math.min(10, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
        style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const on = n <= value;
          return (
            <Pressable key={n} onPress={() => onChange(n)} hitSlop={4} style={{ flex: 1, height: 44, borderRadius: 12, overflow: 'hidden', backgroundColor: c.cardAlt, borderWidth: n === value ? 2 : 0, borderColor: c.primary }}>
              {on ? <View style={{ flex: 1, backgroundColor: c.accent, opacity: 0.22 + n * 0.07 }} /> : null}
              <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[text(13, '800'), { color: on ? c.text : c.textMuted }]}>{n}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {lowLabel || highLabel ? (
        <Row style={{ justifyContent: 'space-between' }}><AppText size={12} muted>{lowLabel}</AppText><AppText size={12} muted>{highLabel}</AppText></Row>
      ) : null}
    </View>
  );
}

/** Circular score (0-100). The number is also the accessibility label. */
export function ScoreRing({ score, size = 150, label }: { score: number | null; size?: number; label?: string }) {
  const { c, text } = useTheme();
  const stroke = 12, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <View accessible accessibilityLabel={`${label ?? ''} ${score ?? '-'}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.cardAlt} strokeWidth={stroke} fill="none" />
        {pct > 0 ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.primary} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /> : null}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={[text(Math.round(size * 0.3), '800'), { lineHeight: Math.round(size * 0.38) }]}>{score ?? '–'}</Text>
        {label ? <Text style={[text(12), { color: c.textMuted }]}>{label}</Text> : null}
      </View>
    </View>
  );
}

/** − value + control. Used for times (15 min steps) and counts. */
export function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const { c, text } = useTheme();
  const btn = (icon: 'remove-circle-outline' | 'add-circle-outline', fn: () => void, a: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${a}`} onPress={fn} hitSlop={6} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={32} color={c.primary} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingLeft: 16, paddingRight: 4, minHeight: 60 }}>
      <Text style={[text(15, '700'), { flex: 1 }]}>{label}</Text>
      {btn('remove-circle-outline', onMinus, '−')}
      <Text accessibilityLiveRegion="polite" style={[text(20, '800'), { minWidth: 72, textAlign: 'center', color: c.primary }]}>{value}</Text>
      {btn('add-circle-outline', onPlus, '+')}
    </View>
  );
}

/** Growth visual: seed → sprout → plant → flower. A personal milestone, not a ranking. */
export function GrowthPlant({ stage, size = 96 }: { stage: 'SEED' | 'GROWING' | 'GROWING_STRONG' | 'FLOURISHING'; size?: number }) {
  const { c } = useTheme();
  const leaf = c.success, stem = c.success;
  const n = stage === 'SEED' ? 0 : stage === 'GROWING' ? 1 : stage === 'GROWING_STRONG' ? 2 : 3;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={46} fill={c.lavender} />
        <Path d="M20 78 Q50 70 80 78 L76 88 Q50 94 24 88 Z" fill={c.tintFg[3]} opacity={0.55} />
        {n === 0 && <Circle cx={50} cy={72} r={6} fill={c.tintFg[3]} />}
        {n >= 1 && <Path d="M50 76 L50 54" stroke={stem} strokeWidth={4} strokeLinecap="round" />}
        {n >= 1 && <Path d="M50 60 Q36 58 32 46 Q46 46 50 60Z" fill={leaf} />}
        {n >= 1 && <Path d="M50 56 Q64 54 68 42 Q54 42 50 56Z" fill={leaf} opacity={0.85} />}
        {n >= 2 && <Path d="M50 66 Q34 68 28 58 Q44 56 50 66Z" fill={leaf} opacity={0.9} />}
        {n >= 2 && <Path d="M50 50 L50 36" stroke={stem} strokeWidth={4} strokeLinecap="round" />}
        {n >= 3 && (
          <G>
            {[0, 72, 144, 216, 288].map((a) => <Circle key={a} cx={50 + 9 * Math.cos((a * Math.PI) / 180)} cy={30 + 9 * Math.sin((a * Math.PI) / 180)} r={7} fill={c.tintFg[3]} />)}
            <Circle cx={50} cy={30} r={6} fill="#FFD166" />
          </G>
        )}
      </Svg>
    </View>
  );
}

export interface SeriesPoint { label: string; value: number | null }
/** Compact line chart for 0-max values. Gaps are real gaps, never filled. */
export function LineChart({ points, max = 10, color, height = 110, width = 320, summary }: { points: SeriesPoint[]; max?: number; color?: string; height?: number; width?: number; summary: string }) {
  const { c } = useTheme();
  const col = color ?? c.primary;
  const padX = 14, padT = 10, padB = 20;
  const w = width - padX * 2, h = height - padT - padB;
  const x = (i: number) => padX + (points.length <= 1 ? w / 2 : (i * w) / (points.length - 1));
  const y = (v: number) => padT + h - (Math.min(v, max) / max) * h;
  const segs: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.value == null) { if (cur.length) segs.push(cur.join(' ')); cur = []; } else cur.push(`${x(i)},${y(p.value)}`);
  });
  if (cur.length) segs.push(cur.join(' '));
  const every = Math.ceil(points.length / 7);
  return (
    <View accessible accessibilityLabel={summary}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {[0.25, 0.5, 0.75].map((f) => <Line key={f} x1={padX} x2={width - padX} y1={padT + h * f} y2={padT + h * f} stroke={c.border} strokeWidth={1} strokeDasharray="3 5" />)}
        {segs.map((s, i) => (s.includes(' ') ? <Polyline key={i} points={s} fill="none" stroke={col} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null))}
        {points.map((p, i) => (p.value == null ? null : <Circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill={c.card} stroke={col} strokeWidth={2.5} />))}
        {points.map((p, i) => (i % every === 0 ? <SvgText key={`l${i}`} x={x(i)} y={height - 4} fontSize={10} fill={c.textMuted} textAnchor="middle">{p.label}</SvgText> : null))}
      </Svg>
    </View>
  );
}

/** Small stat block: label, big value, optional change vs the previous period. */
export function StatBlock({ label, value, change, good, icon }: { label: string; value: string; change?: number | null; good?: 'up' | 'down'; icon?: React.ComponentProps<typeof Icon>['name'] }) {
  const { c, text, shadow } = useTheme();
  const better = change == null || change === 0 ? null : good === 'down' ? change < 0 : change > 0;
  return (
    <View style={[{ flex: 1, minWidth: 96, backgroundColor: c.card, borderRadius: radius.lg, padding: 14, gap: 4, borderWidth: 1, borderColor: c.border }, shadow('sm')]}>
      <Row style={{ gap: 6 }}>{icon ? <Icon name={icon} size={16} color={c.textMuted} /> : null}<Text style={[text(12, '700'), { color: c.textMuted }]}>{label}</Text></Row>
      <Text style={text(24, '800')}>{value}</Text>
      {change != null && change !== 0 ? (
        <Text style={[text(12, '700'), { color: better ? c.success : c.textMuted }]}>{change > 0 ? '▲' : '▼'} {Math.abs(change)}</Text>
      ) : <Text style={[text(12), { color: c.textMuted }]}> </Text>}
    </View>
  );
}
