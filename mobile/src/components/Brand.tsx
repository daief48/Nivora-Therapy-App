import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { Blossom } from './sakura';

/** Nivora mark: a single cherry blossom. Decorative (hidden from screen readers). */
export function Logo({ size = 64, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? c.tint[0], alignItems: 'center', justifyContent: 'center' }}>
      <Blossom size={size * 0.72} />
    </View>
  );
}

const BARS = [0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.85, 0.55, 0.75];
/** Simple sound-wave. Animates while the user is being listened to or the AI is speaking; static when reduced motion is on. */
export function Waveform({ active, tone = 'primary', height = 44 }: { active: boolean; tone?: 'primary' | 'light'; height?: number }) {
  const { c } = useTheme();
  const reduced = useSettings((s) => s.reducedMotion);
  const vals = useRef(BARS.map(() => new Animated.Value(0.25))).current;
  useEffect(() => {
    if (!active || reduced) { vals.forEach((v, i) => v.setValue(active ? BARS[i]! : 0.2)); return; }
    const id = setInterval(() => {
      vals.forEach((v, i) => Animated.timing(v, { toValue: 0.2 + Math.random() * BARS[i]! * 0.8, duration: 160, useNativeDriver: false }).start());
    }, 170);
    return () => clearInterval(id);
  }, [active, reduced, vals]);
  const color = tone === 'light' ? 'rgba(255,255,255,0.9)' : c.accent;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 5, borderRadius: 3, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [4, height] }) }} />
      ))}
    </View>
  );
}

/** Three softly bouncing dots shown while the AI is preparing a reply. */
export function TypingDots() {
  const { c } = useTheme();
  const reduced = useSettings((s) => s.reducedMotion);
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) { dots.forEach((d) => d.setValue(0.5)); return; }
    const loops = dots.map((d, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 160),
      Animated.timing(d, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(d, { toValue: 0, duration: 350, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(320 - i * 160),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduced, dots]);
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 8, paddingHorizontal: 2 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

/** Slowly drifting translucent circles for immersive backgrounds (static with reduced motion). */
export function SoftOrbs({ colors = ['rgba(120,200,180,0.18)', 'rgba(150,140,230,0.16)', 'rgba(120,170,230,0.14)'] }: { colors?: string[] }) {
  const reduced = useSettings((s) => s.reducedMotion);
  const drift = useRef(colors.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) return;
    const loops = drift.map((d, i) => Animated.loop(Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 7000 + i * 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(d, { toValue: 0, duration: 7000 + i * 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduced, drift]);
  const pos = [{ left: '-15%', top: '5%', s: 260 }, { right: '-20%', top: '35%', s: 300 }, { left: '10%', bottom: '-8%', s: 240 }] as const;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {drift.map((d, i) => {
        const p = pos[i % pos.length] as any;
        return <Animated.View key={i} style={{ position: 'absolute', ...p, width: p.s, height: p.s, borderRadius: p.s / 2, backgroundColor: colors[i % colors.length], transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, 28] }) }, { translateX: d.interpolate({ inputRange: [0, 1], outputRange: [0, i % 2 ? -22 : 22] }) }] }} />;
      })}
    </View>
  );
}

/** Soft concentric rings that ripple outward from its child while `active` (listening / speaking), like a phone-call contact photo. */
export function PulseRings({ active, size, color = 'rgba(232,180,194,0.5)', children }: { active: boolean; size: number; color?: string; children: React.ReactNode }) {
  const reduced = useSettings((s) => s.reducedMotion);
  const rings = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!active || reduced) { rings.forEach((r) => r.setValue(0)); return; }
    const loops = rings.map((r, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 520),
      Animated.timing(r, { toValue: 1, duration: 1560, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.delay((2 - i) * 520),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, reduced, rings]);
  const box = size; // rings ripple outside this box (overflow is visible) so they never push layout
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((r, i) => (
        <Animated.View key={i} pointerEvents="none" style={{
          position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color,
          opacity: active ? r.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }) : 0,
          transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.75] }) }],
        }} />
      ))}
      {children}
    </View>
  );
}
