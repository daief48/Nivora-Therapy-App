/**
 * AnimatedScoreRing — the ScoreRing from nv.tsx upgraded with:
 *  • Count-up number animation (0 → score, 800ms ease-out)
 *  • Ring stroke fill animating from 0 → final dash length on the UI thread
 *  • Falls back to the static ring under reduced motion
 *
 * Keeps the same external API as the original ScoreRing so they can be swapped.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { AnimatedNumber } from '../../motion/AnimatedNumber';
import { easing, duration as dur } from '../../motion/tokens';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { useTheme } from '../../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  score: number | null;
  size?: number;
  label?: string;
  /** Ring stroke width, default 12. */
  strokeWidth?: number;
  /** Colour override; uses theme primary by default. */
  color?: string;
}

export function AnimatedScoreRing({ score, size = 112, label, strokeWidth = 12, color }: Props) {
  const { c, text } = useTheme();
  const reduced = useReducedMotion();

  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const targetPct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const targetDash = targetPct * circ;

  const dashLen = useSharedValue(reduced ? targetDash : 0);

  useEffect(() => {
    dashLen.value = reduced
      ? targetDash
      : withTiming(targetDash, { duration: dur.calm, easing: easing.out });
  }, [targetDash, reduced, dashLen]);

  const animProps = typeof useAnimatedProps === 'function'
    ? useAnimatedProps(() => ({
        strokeDasharray: `${dashLen.value} ${circ}`,
      }))
    : ({ strokeDasharray: `${targetDash} ${circ}` } as never);

  const cx = size / 2;
  const cy = size / 2;
  const ringColor = color ?? c.primary;

  return (
    <View
      accessible
      accessibilityLabel={`${label ?? ''} ${score ?? '-'}`}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={c.cardAlt}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated fill arc */}
        {targetPct > 0 || !reduced ? (
          <AnimatedCircle
            cx={cx}
            cy={cy}
            r={r}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            animatedProps={animProps}
          />
        ) : null}
      </Svg>

      {/* Numeric count-up in the centre */}
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        {score != null ? (
          <AnimatedNumber
            value={score}
            ms={dur.calm}
            style={[
              text(Math.round(size * 0.28), '800'),
              { lineHeight: Math.round(size * 0.36), color: c.text },
            ]}
          />
        ) : (
          <Animated.Text
            style={[text(Math.round(size * 0.28), '800'), { lineHeight: Math.round(size * 0.36) }]}
          >
            -
          </Animated.Text>
        )}
        {label ? (
          <Animated.Text style={[text(11), { color: c.textMuted, textAlign: 'center' }]}>
            {label}
          </Animated.Text>
        ) : null}
      </View>
    </View>
  );
}

