import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { layout, radius, useTheme } from '../theme';
import { Logo } from './Brand';
import { AppText, Icon, OfflineBanner, type IconName } from './ui';

/** Shared shell for auth screens: soft wash, brand mark, title, and a single elevated form card. Keyboard-safe. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { c, shadow } = useTheme();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient pointerEvents="none" colors={[c.bgTop, c.bg]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 320 }} />
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: 20, gap: 20 }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Logo size={48} />
              <AppText size={26} weight="800" accessibilityRole="header" style={{ textAlign: 'center' }}>{title}</AppText>
              {subtitle ? <AppText muted style={{ textAlign: 'center' }}>{subtitle}</AppText> : null}
            </View>
            <View style={[{ backgroundColor: c.card, borderRadius: radius.xl, padding: 20, gap: 16, borderWidth: 1, borderColor: c.border }, shadow('md')]}>{children}</View>
            {footer}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type AuthFieldProps = TextInputProps & { label: string; icon?: IconName; error?: string | null; hint?: string; password?: boolean };

/** Input with leading icon, inline error, and (for passwords) a show/hide toggle. */
export const AuthField = React.forwardRef<any, AuthFieldProps>(function AuthField({ label, icon, error, hint, password, onFocus, onBlur, ...props }, ref) {
  const { c, text } = useTheme();
  const t = useT();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const border = error ? c.danger : focused ? c.primary : c.border;
  return (
    <View style={{ gap: 6 }}>
      <AppText size={14} weight="700">{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: c.bg, borderWidth: focused || error ? 2 : 1, borderColor: border }}>
        {icon ? <Icon name={icon} size={20} color={focused ? c.primary : c.textMuted} /> : null}
        <TextInput
          ref={ref} accessibilityLabel={label} placeholderTextColor={c.textMuted} secureTextEntry={password && !shown}
          autoCorrect={false} onFocus={(e) => { setFocused(true); onFocus?.(e); }} onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[text(16), { flex: 1, paddingVertical: 12 }]} {...props}
        />
        {password ? (
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? t('authHide') : t('authShow')} hitSlop={10} onPress={() => setShown(!shown)}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <AppText accessibilityRole="alert" size={13} style={{ color: c.danger }}>{error}</AppText>
        : hint ? <AppText size={13} muted>{hint}</AppText> : null}
    </View>
  );
});

/** 0-3 score: length, letter+digit mix, extra length/symbol. */
export function passwordScore(pw: string) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (pw.length >= 14 || /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export function StrengthMeter({ password }: { password: string }) {
  const { c } = useTheme();
  const t = useT();
  if (!password) return null;
  const score = passwordScore(password);
  const color = score <= 1 ? c.danger : score === 2 ? c.accent : c.success;
  const label = score <= 1 ? t('authStrengthWeak') : score === 2 ? t('authStrengthOk') : t('authStrengthStrong');
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
        {[1, 2, 3].map((i) => <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= score ? color : c.border }} />)}
      </View>
      <AppText size={12} weight="700" style={{ color }}>{label}</AppText>
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  const { c } = useTheme();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: radius.md, backgroundColor: c.bg, borderWidth: 1, borderColor: c.danger }}>
      <Icon name="alert-circle-outline" size={18} color={c.danger} />
      <AppText size={14} style={{ flex: 1, color: c.danger }}>{message}</AppText>
    </View>
  );
}

export function InfoNote({ message }: { message: string | null }) {
  const { c } = useTheme();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: radius.md, backgroundColor: c.bg, borderWidth: 1, borderColor: c.success }}>
      <Icon name="checkmark-circle" size={18} color={c.success} />
      <AppText size={14} style={{ flex: 1 }}>{message}</AppText>
    </View>
  );
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** Ref registry so "next" on the keyboard moves focus to the following field. */
export function useFieldRefs<K extends string>(_keys: readonly K[]) {
  const refs = useRef<Partial<Record<K, { focus: () => void } | null>>>({});
  const set = (k: K) => (el: { focus: () => void } | null) => { refs.current[k] = el; };
  const focus = (k: K) => () => refs.current[k]?.focus();
  return { set, focus };
}
