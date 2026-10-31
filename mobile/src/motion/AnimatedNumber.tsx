import React, { useEffect, useRef, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { duration } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** Counts up (or down) to `value`. The accessibility label always carries the final value. Static under reduced motion. */
export function AnimatedNumber({ value, from = 0, ms = duration.calm, format, style }: {
  value: number; from?: number; ms?: number; format?: (n: number) => string; style?: StyleProp<TextStyle>;
}) {
  const { text } = useTheme();
  const reduced = useReducedMotion();
  const fmt = format ?? ((n: number) => String(Math.round(n)));
  const [shown, setShown] = useState(reduced ? value : from);
  const last = useRef(reduced ? value : from);
  useEffect(() => {
    if (reduced) { last.current = value; setShown(value); return; }
    const start = last.current;
    const t0 = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = k >= 1 ? value : start + (value - start) * eased;
      last.current = v;
      setShown(v);
      if (k >= 1) clearInterval(id);
    }, 33);
    return () => clearInterval(id);
  }, [value, ms, reduced]);
  return <Text accessibilityLabel={fmt(value)} style={[text(16, '700'), style]}>{fmt(shown)}</Text>;
}
