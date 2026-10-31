import React, { useEffect, useRef, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { useReducedMotion } from './useReducedMotion';

/**
 * Streamed-text reveal. `speed` is characters per second; `slow` halves it for a calmer pace.
 * Reveals by whole characters (Array.from) so Bangla and emoji never split mid-glyph. Shows all text at once under reduced motion.
 */
export function TypeWriter({ text, speed = 40, slow = false, onDone, style }: {
  text: string; speed?: number; slow?: boolean; onDone?: () => void; style?: StyleProp<TextStyle>;
}) {
  const { text: t } = useTheme();
  const reduced = useReducedMotion();
  const chars = Array.from(text);
  const [n, setN] = useState(reduced ? chars.length : 0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const total = Array.from(text).length;
    if (reduced || total === 0) { setN(total); done.current?.(); return; }
    setN(0);
    const perSec = Math.max(1, slow ? speed / 2 : speed);
    const started = Date.now();
    const id = setInterval(() => {
      const shown = Math.min(total, Math.floor(((Date.now() - started) / 1000) * perSec) + 1);
      setN(shown);
      if (shown >= total) { clearInterval(id); done.current?.(); }
    }, 33);
    return () => clearInterval(id);
  }, [text, speed, slow, reduced]);
  return <Text accessibilityLabel={text} style={[t(16), style]}>{chars.slice(0, n).join('')}</Text>;
}
