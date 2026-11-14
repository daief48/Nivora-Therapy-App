import Ionicons from '@expo/vector-icons/Ionicons';
import NetInfo from '@react-native-community/netinfo';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { easing, PressScale, SelectFill, Shimmer, useReducedMotion } from '../motion';
import { BlossomBranch, SakuraPetals } from './sakura';
import { useSettings } from '../store/settings';
import { layout, radius, space, useTheme } from '../theme';

/** Frosted-glass backing (expo-blur on iOS; a translucent wash elsewhere, where blur is costly or unsupported). Place first inside a clipped, rounded parent. */
function GlassLayer() {
  const { isDark } = useTheme();
  return (
    <>
      {Platform.OS === 'ios' ? <BlurView pointerEvents="none" intensity={40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(40,41,38,0.55)' : 'rgba(255,255,255,0.55)' }]} />
    </>
  );
}

import type { IconName } from './icons';
export type { IconName };

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { c } = useTheme();
  return <Ionicons name={name as never} size={size} color={color ?? c.text} accessible={false} />;
}

/** Centers content and caps its width so wide web windows do not stretch a phone layout. */
const content: ViewStyle = { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' };

export function Screen({ children, scroll = true, padded = true, style }: { children: React.ReactNode; scroll?: boolean; padded?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const inner = [content, { padding: padded ? space.md : 0, gap: space.md, paddingBottom: 40 }, style];
  const reduced = useSettings((s) => s.reducedMotion);
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => { if (!reduced) Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: false }).start(); }, [reduced, fade]);
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      {/* soft blossom wash at the top of every screen */}
      <LinearGradient pointerEvents="none" colors={[c.bgTop, c.bg]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 280 }} />
      <OfflineBanner />
      <Animated.View style={{ flex: 1, opacity: fade }}>
        {scroll ? <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView> : <View style={[{ flex: 1 }, inner]}>{children}</View>}
      </Animated.View>
    </SafeAreaView>
  );
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  const { c, text } = useTheme();
  const t = useT();
  if (online) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.lavender, padding: space.sm, flexDirection: 'row', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
      <Icon name="cloud-offline-outline" size={16} />
      <Text style={text(14)}>{t('offlineBanner')}</Text>
    </View>
  );
}

export function AppText({ size = 16, weight, muted, style, children, ...rest }: { size?: number; weight?: '400' | '500' | '600' | '700' | '800'; muted?: boolean } & React.ComponentProps<typeof Text>) {
  const { c, text } = useTheme();
  return <Text {...rest} style={[text(size, weight), muted && { color: c.textMuted }, style]}>{children}</Text>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
      <AppText size={19} weight="800" accessibilityRole="header">{children}</AppText>
      {action}
    </View>
  );
}

export function Card({ children, style, tone, glass, onPress, accessibilityRole, accessibilityLabel }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'alt' | 'lavender' | 'danger'; glass?: boolean; onPress?: () => void;
  accessibilityRole?: React.ComponentProps<typeof View>['accessibilityRole']; accessibilityLabel?: string;
}) {
  const { c, shadow } = useTheme();
  const bg = glass ? 'transparent' : tone === 'alt' ? c.cardAlt : tone === 'lavender' ? c.lavender : c.card;
  const box: ViewStyle = { backgroundColor: bg, borderRadius: radius.lg, padding: 18, gap: space.sm, borderWidth: tone === 'danger' ? 2 : StyleSheet.hairlineWidth, borderColor: tone === 'danger' ? c.danger : c.border, overflow: glass ? 'hidden' : undefined };
  const body = <>{glass ? <GlassLayer /> : null}{children}</>;
  if (onPress) return <PressScale accessibilityRole={accessibilityRole ?? 'button'} accessibilityLabel={accessibilityLabel} onPress={onPress} scaleTo={0.985} style={[box, tone ? null : shadow('md'), style]}>{body}</PressScale>;
  return <View accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} style={[box, tone ? null : shadow('md'), style]}>{body}</View>;
}

/** Soft blossom surface for hero areas: blush-to-lavender wash, a few drifting petals and (optionally) a blossoming branch. */
export function Hero({ children, style, branch = false, petals = true, glass = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; branch?: boolean; petals?: boolean; glass?: boolean }) {
  const { c, shadow } = useTheme();
  return (
    <LinearGradient colors={[c.heroA, c.heroB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[{ borderRadius: radius.xl, padding: 22, gap: space.sm, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }, shadow('md'), style]}>
      {glass ? <GlassLayer /> : null}
      {petals ? <SakuraPetals count={4} height={230} /> : null}
      {branch ? <BlossomBranch width={118} /> : null}
      {children}
    </LinearGradient>
  );
}

/** Round tinted icon container. tone 0-3 = sage, lavender, blue, sand. */
export function IconCircle({ icon, tone = 0, size = 48 }: { icon: IconName; tone?: 0 | 1 | 2 | 3; size?: number }) {
  const { c } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.tint[tone], alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon as never} size={size * 0.48} color={c.tintFg[tone]} />
    </View>
  );
}

/** Quick-action tile (icon + label) used in grids. */
export function Tile({ icon, label, onPress, tone = 0, hint, style }: { icon: IconName; label: string; onPress: () => void; tone?: 0 | 1 | 2 | 3; hint?: string; style?: StyleProp<ViewStyle> }) {
  const { c, shadow, text } = useTheme();
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={hint ? `${label}. ${hint}` : label} onPress={onPress} scaleTo={0.97}
      style={[{ flex: 1, minWidth: 140, backgroundColor: c.card, borderRadius: radius.lg, padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }, shadow('md'), style]}>
      <IconCircle icon={icon} tone={tone} />
      <Text style={text(15, '700')}>{label}</Text>
      {hint ? <Text style={[text(12), { color: c.textMuted }]}>{hint}</Text> : null}
    </PressScale>
  );
}

/** Settings-style row: icon, label, optional value, chevron. */
export function ListRow({ icon, label, value, onPress, tone = 0, danger }: { icon: IconName; label: string; value?: string; onPress: () => void; tone?: 0 | 1 | 2 | 3; danger?: boolean }) {
  const { c, text } = useTheme();
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} scaleTo={0.98}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56 }}>
      <IconCircle icon={icon} tone={tone} size={40} />
      <Text style={[text(16, '600'), { flex: 1 }, danger && { color: c.danger }]}>{label}</Text>
      {value ? <Text style={[text(14), { color: c.textMuted }]}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
    </PressScale>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style, accessibilityLabel, icon }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; icon?: IconName;
}) {
  const { c, text, shadow } = useTheme();
  const fg = variant === 'primary' ? c.onPrimary : variant === 'danger' ? c.onDanger : c.text;
  const off = disabled || loading;
  const label = loading ? <ActivityIndicator color={fg} /> : (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {icon ? <Ionicons name={icon as never} size={18} color={fg} /> : null}
      <Text style={[text(16, '700'), { color: fg, textAlign: 'center', flexShrink: 1 }]}>{title}</Text>
    </View>
  );
  const base: ViewStyle = { minHeight: 52, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12, justifyContent: 'center' };
  return (
    <PressScale
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress} scaleTo={0.97} haptic={variant !== 'ghost'}
      style={[{ opacity: off ? 0.5 : 1, borderRadius: radius.pill }, variant === 'primary' && !off ? shadow('md') : null, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={[c.gradA, c.gradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={base}>{label}</LinearGradient>
      ) : (
        <View style={[base, { backgroundColor: variant === 'danger' ? c.danger : variant === 'secondary' ? c.cardAlt : 'transparent', borderWidth: variant === 'ghost' ? 1.5 : 0, borderColor: c.border }]}>{label}</View>
      )}
    </PressScale>
  );
}

export const Field = React.forwardRef<any, TextInputProps & { label?: string; hint?: string }>(function Field({ label, hint, style, onFocus, onBlur, ...props }, ref) {
  const { c, text } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={text(14, '700')}>{label}</Text> : null}
      <TextInput
        ref={ref} accessibilityLabel={label} placeholderTextColor={c.textMuted}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }} onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[text(16), { backgroundColor: c.card, borderColor: focused ? c.primary : c.border, borderWidth: focused ? 2 : 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, minHeight: 50 }, props.multiline && { minHeight: 110, textAlignVertical: 'top' }, style]}
        {...props}
      />
      {hint ? <Text style={[text(13), { color: c.textMuted }]}>{hint}</Text> : null}
    </View>
  );
});

export function Chip({ label, selected, onPress, disabled }: { label: string; selected?: boolean; onPress: () => void; disabled?: boolean }) {
  const { c, text } = useTheme();
  return (
    <PressScale accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled: !!disabled }} onPress={onPress} disabled={disabled} scaleTo={0.95}
      style={{ opacity: disabled ? 0.55 : 1, paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: selected ? c.primary : c.border, overflow: 'hidden' }}>
      <SelectFill on={!!selected} color={c.primary} />
      <Text style={[text(14, '700'), { color: selected ? c.onPrimary : c.text }]}>{label}</Text>
    </PressScale>
  );
}

/** Two-or-more option segmented control (e.g. Mood | Goals). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { c, text } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.cardAlt, borderRadius: radius.pill, padding: 4 }}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <PressScale key={o.value} accessibilityRole="tab" accessibilityState={{ selected: sel }} onPress={() => onChange(o.value)} scaleTo={0.97}
            style={{ flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <SelectFill on={sel} color={c.card} radius={radius.pill} />
            <Text style={[text(15, sel ? '800' : '600'), { color: sel ? c.primary : c.textMuted }]}>{o.label}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

export function Check({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  const { c, text } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} onPress={onToggle} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: c.primary, backgroundColor: checked ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        {checked ? <Ionicons name="checkmark" size={18} color={c.onPrimary} /> : null}
      </View>
      <Text style={[text(15), { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

/** Thin progress bar whose fill animates (static when reduced motion is on). */
export function ProgressBar({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const k = useSharedValue(pct);
  useEffect(() => { k.value = reduced ? pct : withTiming(pct, { duration: 400, easing: easing.out }); }, [pct, reduced, k]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: k.value }] }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: value }} style={{ height: 8, borderRadius: 4, backgroundColor: c.cardAlt, overflow: 'hidden' }}>
      <Reanimated.View style={[{ height: 8, width: '100%', borderRadius: 4, backgroundColor: c.primary, transformOrigin: 'left center' }, fill]} />
    </View>
  );
}

/** Soft shimmering placeholder block shown while data loads (still under reduced motion). */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  return <Shimmer height={height} width={width} style={style} />;
}

export function Loading() {
  const t = useT();
  return (
    <View accessibilityLabel={t('loading')} accessibilityRole="progressbar" style={{ padding: space.md, gap: 12 }}>
      <Skeleton height={22} width="55%" />
      <Skeleton height={14} />
      <Skeleton height={14} width="80%" />
      <Skeleton height={80} style={{ borderRadius: 20 }} />
    </View>
  );
}

export function EmptyState({ title, body, action, icon = 'leaf-outline' }: { title?: string; body?: string; action?: React.ReactNode; icon?: IconName }) {
  const t = useT();
  return (
    <View style={{ alignItems: 'center', padding: space.lg, gap: space.sm }}>
      <IconCircle icon={icon} tone={0} size={64} />
      <AppText size={18} weight="700" style={{ textAlign: 'center' }}>{title ?? t('emptyTitle')}</AppText>
      {body ? <AppText muted style={{ textAlign: 'center' }}>{body}</AppText> : null}
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const network = (error as { code?: string })?.code === 'NETWORK';
  return (
    <View accessibilityRole="alert" style={{ alignItems: 'center', padding: space.lg, gap: space.sm }}>
      <IconCircle icon={network ? 'cloud-offline-outline' : 'alert-circle-outline'} tone={3} size={64} />
      <AppText size={18} weight="700" style={{ textAlign: 'center' }}>{network ? t('errorNetwork') : t('errorTitle')}</AppText>
      {onRetry ? <Button title={t('retry')} onPress={onRetry} variant="secondary" icon="refresh-outline" /> : null}
    </View>
  );
}

/** Renders loading / error / empty / data for a TanStack query result. */
export function QueryBoundary<T>({ q, empty, children }: { q: { isLoading: boolean; isError: boolean; error: unknown; data?: T; refetch: () => void }; empty?: (d: T) => boolean; children: (d: T) => React.ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.isError || q.data === undefined) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (empty?.(q.data)) return null;
  return <>{children(q.data)}</>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>{children}</View>;
}
