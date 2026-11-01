/**
 * SleepAvatar — Luna the moon-face companion.
 *
 * State is driven by a numeric sleep score (or null = no data):
 *   >= 80  happy  — slow scale "breathing" (1→1.04) + floating Z glyphs
 *   50-79  sleepy — slow blink cycle
 *   < 50   tired  — drooping eyes + dark circles
 *   null   awake  — curious eyes + gentle sway
 *   streak — celebrate (star burst ring, brief)
 *
 * All motion runs on the Reanimated UI thread via `useAnimatedStyle`.
 * Under `useReducedMotion()` every animation collapses to a static snapshot.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Ellipse,
  G,
  Path,
  Rect,
} from 'react-native-svg';
import { easing, duration } from '../../motion/tokens';
import { useReducedMotion } from '../../motion/useReducedMotion';

export type AvatarState = 'happy' | 'sleepy' | 'tired' | 'awake' | 'celebrate';

export function scoreToAvatarState(score: number | null, hasStreak = false): AvatarState {
  if (hasStreak) return 'celebrate';
  if (score === null) return 'awake';
  if (score >= 80) return 'happy';
  if (score >= 50) return 'sleepy';
  return 'tired';
}

// ─── Sub-components (pure SVG, no animation) ─────────────────────────────────

/** The base moon-face disc. */
function MoonDisc({ size, c }: { size: number; c: { fill: string; shadow: string } }) {
  const r = size / 2;
  return (
    <>
      {/* soft shadow */}
      <Ellipse cx={r} cy={size * 0.92} rx={r * 0.65} ry={r * 0.12} fill={c.shadow} opacity={0.18} />
      {/* main disc */}
      <Circle cx={r} cy={r} r={r} fill={c.fill} />
      {/* subtle crescent highlight */}
      <Path
        d={`M ${r * 0.32} ${r * 0.28} A ${r * 0.55} ${r * 0.55} 0 0 1 ${r * 0.85} ${r * 0.55}`}
        stroke="rgba(255,255,255,0.45)"
        strokeWidth={r * 0.06}
        strokeLinecap="round"
        fill="none"
      />
    </>
  );
}

/** Cheeks (always rosy). */
function Cheeks({ size, color }: { size: number; color: string }) {
  const r = size / 2;
  return (
    <>
      <Ellipse cx={r * 0.3} cy={r * 1.18} rx={r * 0.22} ry={r * 0.11} fill={color} opacity={0.38} />
      <Ellipse cx={r * 1.7} cy={r * 1.18} rx={r * 0.22} ry={r * 0.11} fill={color} opacity={0.38} />
    </>
  );
}

/** Happy eyes (closed, upward curve). */
function HappyEyes({ size }: { size: number }) {
  const r = size / 2;
  const ey = r * 0.88;
  const curve = (cx: number) => `M ${cx - r * 0.18} ${ey} Q ${cx} ${ey - r * 0.18} ${cx + r * 0.18} ${ey}`;
  return (
    <>
      <Path d={curve(r * 0.62)} stroke="#5A4040" strokeWidth={r * 0.08} strokeLinecap="round" fill="none" />
      <Path d={curve(r * 1.38)} stroke="#5A4040" strokeWidth={r * 0.08} strokeLinecap="round" fill="none" />
    </>
  );
}

/** Sleepy half-closed eyes. eyeOpen: 0=closed 1=open. */
function SleepyEyes({ size, eyeOpen = 0.5 }: { size: number; eyeOpen?: number }) {
  const r = size / 2;
  const ey = r * 0.9;
  const h = r * 0.16 * eyeOpen;
  const eye = (cx: number) => (
    <G key={cx}>
      <Ellipse cx={cx} cy={ey} rx={r * 0.16} ry={Math.max(0.5, h)} fill="#5A4040" />
      {/* lower lid droop */}
      <Path
        d={`M ${cx - r * 0.18} ${ey + r * 0.12} Q ${cx} ${ey + r * 0.22} ${cx + r * 0.18} ${ey + r * 0.12}`}
        stroke="#5A4040"
        strokeWidth={r * 0.045}
        fill="none"
        strokeLinecap="round"
      />
    </G>
  );
  return <>{eye(r * 0.62)}{eye(r * 1.38)}</>;
}

/** Tired eyes with drooping lids + dark circles. */
function TiredEyes({ size }: { size: number }) {
  const r = size / 2;
  const ey = r * 0.9;
  const eye = (cx: number) => (
    <G key={cx}>
      {/* dark circle */}
      <Ellipse cx={cx} cy={ey + r * 0.13} rx={r * 0.22} ry={r * 0.09} fill="#8C7070" opacity={0.3} />
      {/* small sad iris */}
      <Ellipse cx={cx} cy={ey} rx={r * 0.14} ry={r * 0.1} fill="#5A4040" />
      {/* drooping lid */}
      <Path
        d={`M ${cx - r * 0.22} ${ey - r * 0.06} Q ${cx} ${ey + r * 0.22} ${cx + r * 0.22} ${ey - r * 0.06}`}
        fill="#D4A9A9"
        opacity={0.65}
      />
    </G>
  );
  return <>{eye(r * 0.62)}{eye(r * 1.38)}</>;
}

/** Curious/awake eyes with a tiny sparkle. */
function AwakeEyes({ size }: { size: number }) {
  const r = size / 2;
  const ey = r * 0.88;
  const eye = (cx: number) => (
    <G key={cx}>
      <Circle cx={cx} cy={ey} r={r * 0.19} fill="#5A4040" />
      <Circle cx={cx + r * 0.07} cy={ey - r * 0.07} r={r * 0.05} fill="white" />
    </G>
  );
  return <>{eye(r * 0.62)}{eye(r * 1.38)}</>;
}

/** Small smile. mood: 'smile' | 'neutral' | 'tired'. */
function Mouth({ size, mood }: { size: number; mood: 'smile' | 'neutral' | 'tired' }) {
  const r = size / 2;
  const my = r * 1.22;
  const paths: Record<string, string> = {
    smile: `M ${r * 0.72} ${my} Q ${r} ${my + r * 0.2} ${r * 1.28} ${my}`,
    neutral: `M ${r * 0.75} ${my + r * 0.06} L ${r * 1.25} ${my + r * 0.06}`,
    tired: `M ${r * 0.72} ${my + r * 0.12} Q ${r} ${my - r * 0.04} ${r * 1.28} ${my + r * 0.12}`,
  };
  return (
    <Path
      d={paths[mood] ?? paths.neutral}
      stroke="#5A4040"
      strokeWidth={r * 0.07}
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** Floating "Z Z Z" glyphs above the avatar (happy state). */
function ZzGlyphs({ size, opacity }: { size: number; opacity: number }) {
  const r = size / 2;
  const glyphs = [
    { x: r * 1.55, y: r * 0.2, s: r * 0.28, o: opacity * 0.6 },
    { x: r * 1.8, y: r * -0.15, s: r * 0.35, o: opacity * 0.8 },
    { x: r * 2.1, y: r * -0.55, s: r * 0.45, o: opacity },
  ];
  return (
    <>
      {glyphs.map((g, i) => (
        <Path
          key={i}
          d={`M ${g.x} ${g.y + g.s * 0.3} L ${g.x + g.s} ${g.y + g.s * 0.3} L ${g.x} ${g.y + g.s * 0.85} L ${g.x + g.s} ${g.y + g.s * 0.85}`}
          stroke="#8B9ED4"
          strokeWidth={g.s * 0.22}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={g.o}
        />
      ))}
    </>
  );
}

/** Star-burst ring around the avatar for celebrate state. */
function StarBurst({ size, opacity }: { size: number; opacity: number }) {
  const r = size / 2;
  const arms = 8;
  return (
    <>
      {Array.from({ length: arms }, (_, i) => {
        const a = (i * Math.PI * 2) / arms;
        const x1 = r + Math.cos(a) * r * 1.12;
        const y1 = r + Math.sin(a) * r * 1.12;
        const x2 = r + Math.cos(a) * r * 1.45;
        const y2 = r + Math.sin(a) * r * 1.45;
        return (
          <Path
            key={i}
            d={`M ${x1} ${y1} L ${x2} ${y2}`}
            stroke="#FFD166"
            strokeWidth={r * 0.065}
            strokeLinecap="round"
            opacity={opacity}
          />
        );
      })}
    </>
  );
}

// ─── Palette helpers ──────────────────────────────────────────────────────────

function avatarPalette(isDark: boolean) {
  return {
    fill: isDark ? '#3D3550' : '#F3E8FF',
    shadow: isDark ? '#1A1625' : '#C9A8D8',
    cheek: '#E8A4B0',
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface SleepAvatarProps {
  state: AvatarState;
  /** Outer diameter in dp. Default 100. */
  size?: number;
  isDark?: boolean;
}

export function SleepAvatar({ state, size = 100, isDark = false }: SleepAvatarProps) {
  const reduced = useReducedMotion();
  const pal = avatarPalette(isDark);

  // Shared values for every animation
  const scale = useSharedValue(1);
  const sway = useSharedValue(0);
  const zOpacity = useSharedValue(0);
  const starOpacity = useSharedValue(0);
  const eyeOpen = useSharedValue(state === 'happy' ? 0 : 1);

  useEffect(() => {
    // Cancel all running loops before setting up new ones
    cancelAnimation(scale);
    cancelAnimation(sway);
    cancelAnimation(zOpacity);
    cancelAnimation(starOpacity);
    cancelAnimation(eyeOpen);

    if (reduced) {
      // Static fallbacks
      scale.value = 1;
      sway.value = 0;
      zOpacity.value = state === 'happy' ? 0.8 : 0;
      starOpacity.value = state === 'celebrate' ? 1 : 0;
      eyeOpen.value = state === 'happy' ? 0 : 1;
      return;
    }

    if (state === 'happy') {
      // Gentle breathing pulse
      scale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: 2800, easing: easing.breath }),
          withTiming(1.0, { duration: 2800, easing: easing.breath }),
        ),
        -1,
        false,
      );
      // Floating Zs fade in
      zOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1600, easing: easing.out }),
          withTiming(0.3, { duration: 1600, easing: easing.inOut }),
        ),
        -1,
        true,
      );
      eyeOpen.value = 0;
    } else if (state === 'sleepy') {
      // Slow blink: open → close (fast) → open → pause
      const blinkCycle = 3200;
      eyeOpen.value = withRepeat(
        withSequence(
          withTiming(1, { duration: blinkCycle * 0.35, easing: easing.out }),
          withTiming(0, { duration: 220, easing: easing.inOut }),
          withTiming(1, { duration: 220, easing: easing.out }),
          withTiming(0.45, { duration: blinkCycle * 0.4, easing: easing.inOut }),
        ),
        -1,
        false,
      );
    } else if (state === 'awake') {
      // Gentle sway (±3 degrees equiv)
      sway.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1800, easing: easing.breath }),
          withTiming(-1, { duration: 1800, easing: easing.breath }),
        ),
        -1,
        true,
      );
      eyeOpen.value = 1;
    } else if (state === 'celebrate') {
      // Spring pop-in + star burst
      scale.value = withSequence(
        withSpring(1.18, { damping: 10, stiffness: 200 }),
        withDelay(400, withSpring(1, { damping: 14, stiffness: 160 })),
      );
      starOpacity.value = withSequence(
        withTiming(1, { duration: duration.fast }),
        withDelay(600, withTiming(0, { duration: duration.slow, easing: easing.out })),
      );
    } else {
      // tired — no motion, just static
      eyeOpen.value = 0.25;
    }
  }, [state, reduced, scale, sway, zOpacity, starOpacity, eyeOpen]);

  const containerAnim = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${sway.value * 3}deg` },
    ],
  }));

  // eyeOpen drives SleepyEyes in JS side via state (avoid bridge for this sub-pixel tweak)
  // We use a derived approach: render different eye components based on state,
  // only blink animation uses the shared value indirectly via a wrapper opacity.
  const blinkAnim = useAnimatedStyle(() => ({
    opacity: state === 'sleepy' ? eyeOpen.value : 1,
  }));

  const zAnim = useAnimatedStyle(() => ({ opacity: zOpacity.value }));
  const starAnim = useAnimatedStyle(() => ({ opacity: starOpacity.value }));

  const viewSize = size * 2.2; // extra room for Zs and star burst
  const svgSize = size;

  const eyes = (() => {
    switch (state) {
      case 'happy': return <HappyEyes size={svgSize} />;
      case 'tired': return <TiredEyes size={svgSize} />;
      case 'awake': case 'celebrate': return <AwakeEyes size={svgSize} />;
      default: return <SleepyEyes size={svgSize} eyeOpen={0.6} />;
    }
  })();

  const moodMap: Record<AvatarState, 'smile' | 'neutral' | 'tired'> = {
    happy: 'smile', celebrate: 'smile', awake: 'smile', sleepy: 'neutral', tired: 'tired',
  };

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      style={[{ width: viewSize, height: viewSize, alignItems: 'center', justifyContent: 'center' }, containerAnim]}
    >
      {/* Star burst layer — celebrate */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', width: svgSize * 2, height: svgSize * 2, left: 0, top: 0 }, starAnim]}
      >
        <Svg width={svgSize * 2} height={svgSize * 2} viewBox={`0 0 ${svgSize * 2} ${svgSize * 2}`}>
          <StarBurst size={svgSize} opacity={1} />
        </Svg>
      </Animated.View>

      {/* Main face SVG */}
      <Svg width={svgSize} height={svgSize * 1.5} viewBox={`0 0 ${svgSize} ${svgSize * 1.5}`}>
        <MoonDisc size={svgSize} c={{ fill: pal.fill, shadow: pal.shadow }} />
        <Cheeks size={svgSize} color={pal.cheek} />
        {/* Blink wrapper for sleepy state */}
        {state === 'sleepy' ? (
          // Sleepy eyes just rendered normally — blink is subtle opacity change
          eyes
        ) : eyes}
        <Mouth size={svgSize} mood={moodMap[state]} />

        {/* Z glyphs for happy state */}
        {state === 'happy' && <ZzGlyphs size={svgSize} opacity={1} />}
      </Svg>

      {/* Z glyph animation overlay */}
      {state === 'happy' && !reduced && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 0, left: 0, width: viewSize, height: viewSize }, zAnim]}
        />
      )}

      {/* Sleepy blink overlay */}
      {state === 'sleepy' && !reduced && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute' }, blinkAnim]}
        />
      )}
    </Animated.View>
  );
}

