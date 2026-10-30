import React from 'react';
import { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop, Svg } from './svg';

export type MoodLevel = 1 | 2 | 3 | 4 | 5;

// Soft, friendly gradient per level: coral → peach → sand → lime → mint.
const FILL: Record<MoodLevel, [string, string]> = {
  1: ['#FF9C8F', '#E8685F'],
  2: ['#FFC393', '#EE9A5E'],
  3: ['#FFE48A', '#F2C14E'],
  4: ['#C7E98F', '#8CCB62'],
  5: ['#84E3C0', '#3DB98F'],
};
const INK = '#3A2A26';

/**
 * Flat, modern mood face (drawn in SVG, so it looks identical on Android, iOS and web, unlike system emoji).
 * `level` 1 = very low … 5 = great. Decorative: the parent button carries the accessible label.
 */
export function MoodFace({ level, size = 44, uid = 'mf' }: { level: MoodLevel; size?: number; uid?: string }) {
  const [a, b] = FILL[level];
  const id = `${uid}${level}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={a} /><Stop offset="1" stopColor={b} /></LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={22} fill={`url(#${id})`} />
      <Ellipse cx={17} cy={11} rx={9} ry={4.5} fill="#FFFFFF" opacity={0.28} />
      <G stroke={INK} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {level === 1 ? (
          <>
            <Path d="M12.5 19.6 L20 16.6" strokeWidth={2} /><Path d="M35.5 19.6 L28 16.6" strokeWidth={2} />
            <Path d="M14.5 24 Q17 21.6 19.5 24" strokeWidth={2.2} /><Path d="M28.5 24 Q31 21.6 33.5 24" strokeWidth={2.2} />
            <Path d="M16 35 Q24 27.5 32 35" strokeWidth={2.4} />
            <Path d="M15.5 27.5 Q13.6 30.5 15.5 32 Q17.4 30.5 15.5 27.5 Z" fill="#7CC4F0" stroke="none" />
          </>
        ) : null}
        {level === 2 ? (
          <>
            <Path d="M13.5 19 L20 17.4" strokeWidth={1.8} /><Path d="M34.5 19 L28 17.4" strokeWidth={1.8} />
            <Circle cx={17} cy={24} r={2.3} fill={INK} stroke="none" /><Circle cx={31} cy={24} r={2.3} fill={INK} stroke="none" />
            <Path d="M17.5 33.5 Q24 29.5 30.5 33.5" strokeWidth={2.4} />
          </>
        ) : null}
        {level === 3 ? (
          <>
            <Circle cx={17} cy={22} r={2.4} fill={INK} stroke="none" /><Circle cx={31} cy={22} r={2.4} fill={INK} stroke="none" />
            <Path d="M17.5 32 L30.5 32" strokeWidth={2.4} />
          </>
        ) : null}
        {level === 4 ? (
          <>
            <Circle cx={17} cy={21.5} r={2.4} fill={INK} stroke="none" /><Circle cx={31} cy={21.5} r={2.4} fill={INK} stroke="none" />
            <Path d="M16 29.5 Q24 38 32 29.5" strokeWidth={2.6} />
            <Ellipse cx={11.5} cy={28.5} rx={3} ry={2} fill="#FFB3A7" opacity={0.7} stroke="none" /><Ellipse cx={36.5} cy={28.5} rx={3} ry={2} fill="#FFB3A7" opacity={0.7} stroke="none" />
          </>
        ) : null}
        {level === 5 ? (
          <>
            <Path d="M13.5 23 Q17 17.5 20.5 23" strokeWidth={2.6} /><Path d="M27.5 23 Q31 17.5 34.5 23" strokeWidth={2.6} />
            <Path d="M14 28.5 Q24 43 34 28.5 Z" fill="#4B1F24" strokeWidth={1.4} />
            <Path d="M19 35.8 Q24 32.6 29 35.8 Q24 40.6 19 35.8 Z" fill="#FF8C9A" stroke="none" />
            <Ellipse cx={10.5} cy={29} rx={3.2} ry={2.2} fill="#FFB3A7" opacity={0.7} stroke="none" /><Ellipse cx={37.5} cy={29} rx={3.2} ry={2.2} fill="#FFB3A7" opacity={0.7} stroke="none" />
          </>
        ) : null}
      </G>
    </Svg>
  );
}
