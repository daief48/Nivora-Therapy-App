import React from 'react';
import { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop, Svg } from './svg';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type AvatarReaction = 'empathy' | 'joy' | 'curious' | 'concern' | 'nod';
export type AvatarTone = 'warm' | 'cheerful' | 'concerned';

export interface Frame {
  breathe: number; blink: number; mouth: number; ring: number;
  smile: number; brow: number; lookX: number; lookY: number; tilt: number;
  nod: number;      // vertical head nod, in drawing units (positive = down)
  joy: number;      // 0..1  happy closed-eye smile
  blush: number;    // 0..1  extra blush
  mouthO: number;   // 0..1  small round "oh" mouth (curiosity / surprise)
  wide: number;     // 0..1  eyes opened wider
  lid: number;      // 0..1  softly lowered upper eyelids (concern, thinking)
  sparkle: number;  // 0..1  burst of sparkles
  twinkle: number;  // 0..1  slow background twinkle
  round?: number;   // 0..1  rounded "oo" lips while speaking (set by the lip-sync)
}
export interface ArtColors { plateA: string; plateB: string; ring: string; danger: string }

const BASE = { smile: 0, brow: 0, lookX: 0, lookY: 0, tilt: 0, nod: 0, joy: 0, blush: 0, mouthO: 0, wide: 0, lid: 0, sparkle: 0 };
export type Pose = typeof BASE;

/** Facial pose per conversation state. `now` (seconds) adds gentle, slow idle movement. */
export function expression(s: AvatarState, now: number, tone: AvatarTone = 'warm'): Pose {
  const e: Pose = { ...BASE };
  switch (s) {
    case 'listening': // attentive: head tilted, brows lifted, eyes bright and on the user
      Object.assign(e, { smile: 0.55, brow: 0.55, tilt: 4, wide: 0.25, blush: 0.15, lookX: Math.sin(now * 0.7) * 0.4 });
      break;
    case 'thinking':
      Object.assign(e, { smile: 0.1, brow: 0.35, lookX: -2, lookY: -2.2, tilt: -3, lid: 0.1 });
      break;
    case 'speaking':
      Object.assign(e, tone === 'cheerful' ? { smile: 0.85, brow: 0.45, blush: 0.5, tilt: Math.sin(now * 1.6) * 2 }
        : tone === 'concerned' ? { smile: -0.25, brow: -0.55, tilt: 1.5, lid: 0.18 }
        : { smile: 0.4, brow: 0.2 + Math.sin(now * 2) * 0.12, blush: 0.2, tilt: Math.sin(now * 1.3) * 1.4 });
      break;
    case 'error':
      Object.assign(e, { smile: -0.6, brow: -0.85, lookY: 0.5, lid: 0.15 });
      break;
    default:
      Object.assign(e, { smile: 0.75, blush: 0.2, lookX: Math.sin(now * 0.5) * 0.8, tilt: Math.sin(now * 0.4) * 0.8 });
  }
  return e;
}

/** Target pose for a reaction at full strength. `t` is seconds since the reaction started (drives the nods). */
export function reactionPose(r: AvatarReaction, t: number): Partial<Pose> {
  switch (r) {
    case 'joy': return { smile: 1, brow: 0.5, joy: 1, blush: 0.95, tilt: -4, sparkle: 1, nod: Math.sin(t * 9) * 1.2 };
    case 'empathy': return { smile: 0.05, brow: -0.6, blush: 0.35, tilt: 5, lookY: 1.2, nod: Math.max(0, Math.sin(t * 4.2)) * 3.4 }; // slow, caring nods
    case 'curious': return { smile: 0.35, brow: 0.95, wide: 1, tilt: 7, lookX: 1.6, mouthO: 0.55 };
    case 'concern': return { smile: -0.35, brow: -0.95, tilt: 2, lookY: 0.8, lid: 0.2, nod: Math.max(0, Math.sin(t * 3.4)) * 2.2 };
    default: return { smile: 0.7, brow: 0.2, blush: 0.25, nod: Math.max(0, Math.sin(t * 7.5)) * 3 }; // 'nod': an "mm-hm" double nod
  }
}

export const staticFrame = (s: AvatarState, tone: AvatarTone = 'warm'): Frame => ({ breathe: 0.5, blink: 1, mouth: s === 'speaking' ? 0.4 : 0, ring: 0, twinkle: 0.6, ...expression(s, 0, tone) });

// ---------------------------------------------------------------- palette ----------------------------------------------------------------
const SKIN = '#FCDCCB', SKIN_SHADE = '#EDB39C';
const HAIR_MID = '#A25E30', HAIR_DK = '#6B3A1C', HAIR_LT = '#D39A5C';
const GOLD = '#F4C95D', GOLD_DK = '#C98F1E', GEM = '#4FC6EE', GEM_DK = '#1E8FC4';
const LIP = '#E88388', LIP_LOW = '#F4A3A5', LASH = '#3A2214', BROW = '#8A5530';
const cx = 100;

const star = (x: number, y: number, r: number) => `M ${x} ${y - r} Q ${x} ${y} ${x + r} ${y} Q ${x} ${y} ${x} ${y + r} Q ${x} ${y} ${x - r} ${y} Q ${x} ${y} ${x} ${y - r} Z`;

/** Everything that never changes between frames (hair back, braid, sweater). Memoised so the 20 fps animation only redraws the face. */
const Body = React.memo(function Body({ uid, frame }: { uid: string; frame: boolean }) {
  const braid = Array.from({ length: 8 }, (_, i) => ({ x: 146 + i * 3.4, y: 172 + i * 14, rot: i % 2 ? 40 : -40, r: 10 - i * 0.55 }));
  return (
    <G>
      {/* hair volume behind the head */}
      <Path d="M100 22 C52 22 28 66 32 124 C34 148 40 164 56 174 Q100 186 144 174 C160 164 166 148 168 124 C172 66 148 22 100 22 Z" fill={`url(#${uid}hair)`} />

      {/* neck (with a soft shadow under the chin) */}
      <Path d="M88 168 L88 196 Q100 204 112 196 L112 168 Z" fill={SKIN_SHADE} />

      {/* knit turtleneck sweater */}
      <Path d="M8 256 Q12 204 70 196 Q100 208 130 196 Q188 204 192 256 Z" fill={`url(#${uid}knit)`} />
      {frame ? <Path d="M-90 560 L-90 264 Q-30 208 70 196 Q100 208 130 196 Q230 208 290 264 L290 560 Z" fill={`url(#${uid}knit)`} /> : null}
      <Path d="M8 256 Q12 204 70 196 Q100 208 130 196 Q188 204 192 256 Z" fill={`url(#${uid}stitch)`} opacity={0.4} />
      {frame ? <Path d="M-90 560 L-90 264 Q-30 208 70 196 Q100 208 130 196 Q230 208 290 264 L290 560 Z" fill={`url(#${uid}stitch)`} opacity={0.4} /> : null}
      <Ellipse cx={42} cy={222} rx={30} ry={18} fill="#FFFFFF" opacity={0.1} />
      <Ellipse cx={158} cy={222} rx={30} ry={18} fill="#FFFFFF" opacity={0.08} />
      {/* ribbed cowl collar */}
      <Path d="M76 170 Q100 184 124 170 L130 200 Q100 216 70 200 Z" fill={`url(#${uid}collar)`} />
      <G stroke="#1F6F96" strokeWidth={1.2} opacity={0.35} strokeLinecap="round">
        {[82, 88, 94, 100, 106, 112, 118].map((x, i) => <Path key={i} d={`M${x} ${178 + Math.abs(x - 100) * 0.12} L${x + (x - 100) * 0.18} ${204 - Math.abs(x - 100) * 0.12}`} />)}
      </G>
      <Path d="M76 170 Q100 184 124 170" stroke="#9ADAF2" strokeWidth={2} fill="none" opacity={0.7} strokeLinecap="round" />

      {/* side braid over the shoulder */}
      <G>
        {braid.map((b, i) => (
          <G key={i}>
            <Ellipse cx={b.x} cy={b.y} rx={b.r} ry={7.4} transform={`rotate(${b.rot} ${b.x} ${b.y})`} fill={i % 2 ? HAIR_DK : HAIR_MID} stroke={HAIR_DK} strokeWidth={0.8} />
            <Path d={`M${b.x - 5} ${b.y - 2} Q${b.x} ${b.y - 5} ${b.x + 5} ${b.y - 1}`} stroke={HAIR_LT} strokeWidth={1.2} fill="none" opacity={0.7} strokeLinecap="round" />
          </G>
        ))}
        <Path d="M171 280 Q175 292 168 300 Q161 292 165 282 Z" fill={HAIR_MID} stroke={HAIR_DK} strokeWidth={0.8} />
        <Circle cx={168} cy={281} r={3.4} fill={GEM} stroke={GEM_DK} strokeWidth={0.8} />
      </G>
    </G>
  );
});

/**
 * Original illustrated character "Nivora": a sweet storybook princess with warm brown hair, a side braid, big blue-green eyes,
 * a gold tiara with a blue gem and a teal knit turtleneck. Pure SVG drawing (no network, no photos, no paid avatar service).
 * It is NOT a real person. Depends only on the svg primitives, so it can also be rendered offline to an image for review.
 */
export function AvatarArt({ f, state, uid, colors, width, height, variant = 'portrait' }: { f: Frame; state: AvatarState; uid: string; colors: ArtColors; width: number; height: number; variant?: 'portrait' | 'frame' }) {
  const frame = variant === 'frame'; // 'frame' fills the whole rectangle like a video feed; 'portrait' is a round profile picture

  // ---- eyes: big, glossy, blue-green. With joy they close into happy arcs. ----
  const EY = 117;
  const open = Math.max(0.08, f.blink * (1 + f.wide * 0.22) * (1 - f.joy * 0.4) * (1 - f.lid * 0.35));
  const eye = (ex: number, side: -1 | 1, id: string) => {
    const h = 11.6 * open;
    const shape = `M ${ex - 12.5} ${EY} Q ${ex} ${EY - h * 1.45} ${ex + 12.5} ${EY} Q ${ex} ${EY + h * 1.1} ${ex - 12.5} ${EY} Z`;
    const ix = ex + f.lookX, iy = EY + f.lookY;
    if (f.joy > 0.55) {
      return (
        <G key={id}>
          <Path d={`M ${ex - 11} ${EY + 3} Q ${ex} ${EY - 11.5} ${ex + 11} ${EY + 3}`} stroke={LASH} strokeWidth={3.4} fill="none" strokeLinecap="round" />
          <Path d={`M ${ex + side * 11} ${EY + 3} l ${side * 2.6} -2.6`} stroke={LASH} strokeWidth={2.4} strokeLinecap="round" />
        </G>
      );
    }
    return (
      <G key={id}>
        <ClipPath id={id}><Path d={shape} /></ClipPath>
        <Path d={shape} fill="#FBFBFB" />
        <G clipPath={`url(#${id})`}>
          <Ellipse cx={ix} cy={iy} rx={8.4} ry={10.4} fill={`url(#${uid}iris)`} />
          <Ellipse cx={ix} cy={iy} rx={8.4} ry={10.4} fill="none" stroke="#1F3F45" strokeWidth={1.1} opacity={0.8} />
          <Ellipse cx={ix} cy={iy + 0.4} rx={4} ry={5} fill="#0C1519" />
          <Circle cx={ix - 2.8} cy={iy - 3.6} r={2.9} fill="#FFFFFF" />
          <Circle cx={ix + 2.6} cy={iy + 3.4} r={1.3} fill="#FFFFFF" opacity={0.85} />
          <Rect x={ex - 14} y={EY - h * 1.45} width={28} height={3.6} fill="#3A2214" opacity={0.2} />
        </G>
        <Path d={`M ${ex - side * 12.5} ${EY + 0.6} Q ${ex} ${EY - h * 1.5 - 0.8} ${ex + side * 12.5} ${EY - 0.2} L ${ex + side * 15} ${EY - 3}`} stroke={LASH} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={`M ${ex - 9} ${EY + h * 0.95} Q ${ex} ${EY + h * 1.3} ${ex + 9} ${EY + h * 0.95}`} stroke="#C99A88" strokeWidth={0.9} fill="none" opacity={0.55} />
        <Path d={`M ${ex - 10} ${EY - h * 1.45 - 2.4} Q ${ex} ${EY - h * 2 - 3.6} ${ex + 10} ${EY - h * 1.45 - 2.2}`} stroke="#B17D66" strokeWidth={1} fill="none" opacity={0.45} strokeLinecap="round" />
      </G>
    );
  };

  // ---- eyebrows: soft, arched, brown ----
  const by = 98 - f.brow * 3.6;
  const innerLift = f.brow < 0 ? -f.brow * 3.6 : 0;
  const browPath = (ex: number, side: -1 | 1) => `M ${ex - side * 12} ${by + 2.6 - innerLift} Q ${ex - side * 1} ${by - 3.6} ${ex + side * 13} ${by + 2.4}`;

  // ---- mouth: small and sweet. Opens while speaking, rounds into an "o" when curious. ----
  const mw = 8 + Math.max(0, f.smile) * 3 + f.joy * 1.6;
  const my = 153 + f.mouth * 1.2;
  const cy = my - f.smile * 2.4;
  const Lx = cx - mw, Rx = cx + mw;
  const o = Math.max(f.mouth * 8.5, f.joy * 4.6);
  const upper = `M ${Lx} ${cy} Q ${cx - mw / 2} ${my - 3.2} ${cx} ${my - 2} Q ${cx + mw / 2} ${my - 3.2} ${Rx} ${cy} Q ${cx} ${my - 0.2 + o * 0.25} ${Lx} ${cy} Z`;
  const interior = `M ${Lx + 0.8} ${cy} Q ${cx} ${my - 1} ${Rx - 0.8} ${cy} Q ${cx} ${my + o * 1.9 + 2.6} ${Lx + 0.8} ${cy} Z`;
  const lower = `M ${Lx} ${cy} Q ${cx} ${my + o * 2 + 6} ${Rx} ${cy} Q ${cx} ${my + o * 1.9 + 2.8} ${Lx} ${cy} Z`;
  const oo = (f.round ?? 0) > 0.5 && f.mouth > 0.12; // rounded lips mid-speech
  const showO = oo || (f.mouthO > 0.25 && f.mouth < 0.3);
  const closed = o < 0.9;
  const blushA = 0.4 + f.blush * 0.4;
  const sway = f.breathe * 1.4;
  const ringR = 98 + f.ring * 14;
  const sparkles: [number, number, number][] = [[30, 52, 6], [172, 44, 5], [20, 128, 4], [182, 120, 6], [44, 22, 4], [150, 20, 4], [176, 176, 5], [24, 190, 5]];

  return (
    <Svg width={width} height={height} viewBox={frame ? '-30 -10 260 420' : '-8 0 216 232'} preserveAspectRatio={frame ? 'xMidYMid slice' : 'xMidYMid meet'}>
      <Defs>
        <ClipPath id={`${uid}plate`}><Circle cx={cx} cy={112} r={98} /></ClipPath>
        <RadialGradient id={`${uid}bg`} cx="50%" cy="35%" r="75%"><Stop offset="0" stopColor={colors.plateA} /><Stop offset="1" stopColor={colors.plateB} /></RadialGradient>
        <RadialGradient id={`${uid}face`} cx="48%" cy="38%" r="72%"><Stop offset="0" stopColor="#FFEDE1" /><Stop offset="0.65" stopColor={SKIN} /><Stop offset="1" stopColor={SKIN_SHADE} /></RadialGradient>
        <LinearGradient id={`${uid}hair`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={HAIR_LT} /><Stop offset="0.35" stopColor={HAIR_MID} /><Stop offset="1" stopColor={HAIR_DK} /></LinearGradient>
        <LinearGradient id={`${uid}knit`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#4FB4D6" /><Stop offset="1" stopColor="#1F7CA8" /></LinearGradient>
        <LinearGradient id={`${uid}collar`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#3E9FC6" /><Stop offset="1" stopColor="#2B87B1" /></LinearGradient>
        <LinearGradient id={`${uid}gold`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FFE9A0" /><Stop offset="0.5" stopColor={GOLD} /><Stop offset="1" stopColor={GOLD_DK} /></LinearGradient>
        <RadialGradient id={`${uid}iris`} cx="50%" cy="32%" r="80%"><Stop offset="0" stopColor="#A5D3C9" /><Stop offset="0.55" stopColor="#5E9AA0" /><Stop offset="1" stopColor="#2C555C" /></RadialGradient>
        <Pattern id={`${uid}stitch`} patternUnits="userSpaceOnUse" width={9} height={7}>
          <Path d="M0.8 1 L3.2 4.6 L5.6 1" stroke="#FFFFFF" strokeWidth={1.1} fill="none" opacity={0.55} strokeLinecap="round" />
          <Path d="M4.4 4.4 L6.8 8 L9.2 4.4" stroke="#1F6F96" strokeWidth={0.9} fill="none" opacity={0.3} strokeLinecap="round" />
        </Pattern>
      </Defs>

      {state === 'listening' && !frame ? <Circle cx={cx} cy={112} r={ringR} stroke={colors.ring} strokeWidth={3} fill="none" opacity={0.6 * (1 - f.ring)} /> : null}
      {frame ? (
        <>
          <Rect x={-80} y={-70} width={400} height={600} fill={`url(#${uid}bg)`} />
          <Circle cx={cx} cy={150} r={150} fill="#FFFFFF" opacity={0.1} />
          <Circle cx={-14} cy={70} r={50} fill="#FFFFFF" opacity={0.06} />
          <Circle cx={216} cy={120} r={40} fill="#FFFFFF" opacity={0.07} />
          <Circle cx={190} cy={300} r={28} fill="#FFFFFF" opacity={0.06} />
          {sparkles.map(([x, y, r], i) => <Path key={i} d={star(x, y + 30, r * 1.4)} fill="#FFFFFF" opacity={0.25 + 0.5 * Math.abs(Math.sin(i + f.twinkle * 3))} />)}
        </>
      ) : (
        <>
          <Circle cx={cx} cy={112} r={98} fill={`url(#${uid}bg)`} />
          <G clipPath={`url(#${uid}plate)`}>
            {sparkles.map(([x, y, r], i) => <Path key={i} d={star(x, y, r)} fill="#FFFFFF" opacity={0.4 + 0.55 * Math.abs(Math.sin(i + f.twinkle * 3))} />)}
          </G>
        </>
      )}

      <G clipPath={frame ? undefined : `url(#${uid}plate)`}>
        <G transform={frame ? `translate(0 40) translate(0 ${sway})` : `translate(100 124) scale(0.82) translate(-100 -118) translate(0 ${sway})`}>
          <Body uid={uid} frame={frame} />

          {/* head (nods and tilts as one piece) */}
          <G transform={`translate(0 ${f.nod}) rotate(${f.tilt} 100 184)`}>
            <Ellipse cx={41.5} cy={133} rx={5.4} ry={9} fill="#F6C6B2" />
            <Ellipse cx={158.5} cy={133} rx={5.4} ry={9} fill="#F6C6B2" />
            <Path d="M100 44 C145 44 160 78 157 116 C154 152 134 177 100 183 C66 177 46 152 43 116 C40 78 55 44 100 44 Z" fill={`url(#${uid}face)`} />
            <Ellipse cx={100} cy={178} rx={22} ry={5} fill={SKIN_SHADE} opacity={0.35} />
            <Ellipse cx={65} cy={141} rx={14} ry={8.5} fill="#F59AA0" opacity={blushA} />
            <Ellipse cx={135} cy={141} rx={14} ry={8.5} fill="#F59AA0" opacity={blushA} />
            {f.joy > 0.4 ? (
              <G stroke="#F2768A" strokeWidth={1.2} strokeLinecap="round" opacity={0.7}>
                <Path d="M57 139 l3 5" /><Path d="M63 138 l3 5" /><Path d="M69 138 l3 5" /><Path d="M128 138 l3 5" /><Path d="M134 138 l3 5" /><Path d="M140 139 l3 5" />
              </G>
            ) : null}

            <Path d={browPath(79, -1)} stroke={BROW} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.92} />
            <Path d={browPath(121, 1)} stroke={BROW} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.92} />
            {eye(79, -1, `${uid}eL`)}
            {eye(121, 1, `${uid}eR`)}

            {/* small rosy nose with a highlight */}
            <Ellipse cx={100} cy={137} rx={4.2} ry={3} fill="#F2A59C" opacity={0.7} />
            <Ellipse cx={99} cy={135.8} rx={1.6} ry={1} fill="#FFFFFF" opacity={0.7} />
            <Path d="M96.8 138.6 Q100 140.6 103.2 138.6" stroke="#D88C80" strokeWidth={1} fill="none" strokeLinecap="round" opacity={0.6} />

            {showO ? (
              <Ellipse cx={cx} cy={my + 1.5} rx={oo ? 3.6 + f.mouth * 2 : 4.2 + f.mouthO * 1.2} ry={oo ? 2.2 + f.mouth * 4.6 : 2.6 + f.mouthO * 3.4} fill="#7A2D3A" stroke={LIP} strokeWidth={1.6} />
            ) : closed ? (
              <>
                <Path d={upper} fill={LIP} />
                <Path d={lower} fill={LIP_LOW} />
                <Ellipse cx={cx - 1.5} cy={my + 2.6} rx={2.2} ry={0.9} fill="#FFFFFF" opacity={0.45} />
              </>
            ) : (
              <>
                <Path d={interior} fill="#6A2634" />
                <Path d={`M ${Lx + 2} ${cy + 0.3} Q ${cx} ${my - 0.8} ${Rx - 2} ${cy + 0.3} L ${Rx - 3} ${cy + 2.4} Q ${cx} ${my + 1.2} ${Lx + 3} ${cy + 2.4} Z`} fill="#FFFFFF" opacity={Math.min(1, o / 3)} />
                <Path d={`M ${Lx} ${cy} Q ${cx - mw / 2} ${my - 3.2} ${cx} ${my - 2} Q ${cx + mw / 2} ${my - 3.2} ${Rx} ${cy}`} stroke={LIP} strokeWidth={2.2} fill="none" strokeLinecap="round" />
                <Path d={`M ${cx - 3.4} ${my + o * 1.5 + 2.6} Q ${cx} ${my + o * 1.2 + 0.4} ${cx + 3.4} ${my + o * 1.5 + 2.6} Q ${cx} ${my + o * 1.9 + 5} ${cx - 3.4} ${my + o * 1.5 + 2.6} Z`} fill="#F27F94" opacity={0.9} />
                <Path d={lower} fill={LIP_LOW} />
              </>
            )}

            {/* warm brown hair swept back from a side part, with strands and face-framing wisps */}
            <Path d="M38 134 C28 58 62 20 106 22 C150 22 174 58 162 134 L152 126 C146 92 124 68 96 62 C72 70 56 92 50 126 Z" fill={`url(#${uid}hair)`} />
            <G fill="none" strokeLinecap="round">
              <Path d="M94 62 C74 46 56 62 48 104" stroke={HAIR_LT} strokeWidth={1.8} opacity={0.65} />
              <Path d="M98 62 C122 42 150 60 156 108" stroke={HAIR_LT} strokeWidth={1.8} opacity={0.6} />
              <Path d="M92 60 C66 36 44 66 40 112" stroke={HAIR_DK} strokeWidth={1.5} opacity={0.5} />
              <Path d="M100 60 C130 34 160 62 158 112" stroke={HAIR_DK} strokeWidth={1.5} opacity={0.5} />
              <Path d="M70 40 C86 30 110 28 128 38" stroke="#FFE2B8" strokeWidth={2.2} opacity={0.45} />
              <Path d="M50 124 C45 140 46 160 53 178" stroke={HAIR_MID} strokeWidth={3.4} />
              <Path d="M150 124 C155 140 154 160 147 178" stroke={HAIR_MID} strokeWidth={3.4} />
            </G>

            {/* ornate gold tiara with a blue gem */}
            <Path d="M56 56 Q100 22 144 56 L141 63 Q100 36 59 63 Z" fill={`url(#${uid}gold)`} />
            <G fill="none" stroke={`url(#${uid}gold)`} strokeWidth={2.6} strokeLinecap="round">
              <Path d="M70 47 C58 40 52 54 62 58" /><Path d="M130 47 C142 40 148 54 138 58" />
              <Path d="M84 38 C76 28 66 36 72 44" /><Path d="M116 38 C124 28 134 36 128 44" />
              <Path d="M92 28 C88 16 100 12 100 22 C100 12 112 16 108 28" />
            </G>
            <Path d="M100 27 L109 40 L100 53 L91 40 Z" fill={GEM} stroke={GOLD_DK} strokeWidth={1.8} />
            <Path d="M100 27 L109 40 L100 40 Z" fill="#BFEFFF" opacity={0.7} />
            <Circle cx={76} cy={52} r={2.8} fill={GEM} stroke={GOLD_DK} strokeWidth={1} />
            <Circle cx={124} cy={52} r={2.8} fill={GEM} stroke={GOLD_DK} strokeWidth={1} />
            <Circle cx={100} cy={13} r={2} fill="#FFFDF0" />
          </G>
        </G>

        {f.sparkle > 0.05 ? (
          <G opacity={f.sparkle}>
            <Path d={star(34, 78, 9)} fill="#FFF6B5" /><Path d={star(168, 70, 8)} fill="#FFF6B5" /><Path d={star(24, 142, 6)} fill="#FFFFFF" />
            <Path d={star(178, 140, 7)} fill="#FFFFFF" /><Path d={star(150, 30, 6)} fill="#CDEBFF" /><Path d={star(54, 30, 5)} fill="#CDEBFF" />
          </G>
        ) : null}
      </G>

      {state === 'thinking' && !frame ? (
        <G>
          <Circle cx={166} cy={34} r={4} fill={colors.ring} opacity={0.4} />
          <Circle cx={178} cy={24} r={5.5} fill={colors.ring} opacity={0.7} />
          <Circle cx={192} cy={12} r={7} fill={colors.ring} />
        </G>
      ) : null}
      {state === 'error' && !frame ? <Circle cx={cx} cy={112} r={98} fill="none" stroke={colors.danger} strokeWidth={2} opacity={0.35} /> : null}
    </Svg>
  );
}
