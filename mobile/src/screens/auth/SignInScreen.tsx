import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { AuthField, AuthLayout, ErrorNote, isEmail, useFieldRefs } from '../../components/auth';
import { AppText, Button } from '../../components/ui';
import { useT } from '../../i18n';
import type { Nav } from '../../navigation/types';
import { useAuth } from '../../store/auth';
import { useTheme } from '../../theme';

export function SignInScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const signInWith = useAuth((s) => s.signInWith);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = useFieldRefs(['email', 'password'] as const);
  const emailErr = touched && email.trim() && !isEmail(email) ? t('authEmailInvalid') : null;
  const ready = isEmail(email) && !!password;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await signInWith(await api('/auth/login', { method: 'POST', auth: false, body: { email: email.trim(), password } }));
    } catch (e) {
      const err = e as ApiError;
      setError(err.isNetwork ? t('errorNetwork') : err.status === 429 ? t('aiBusy') : t('loginFailed'));
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('authWelcomeBack')} subtitle={t('authSignInSub')}
      footer={<Button title={t('noAccount')} variant="ghost" onPress={() => nav.navigate('SignUp')} />}>
      <AuthField ref={f.set('email')} label={t('email')} icon="mail-outline" value={email} onChangeText={setEmail} onBlur={() => setTouched(true)} error={emailErr}
        autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={f.focus('password')} blurOnSubmit={false} />
      <AuthField ref={f.set('password')} label={t('password')} icon="lock-closed-outline" password value={password} onChangeText={setPassword}
        autoCapitalize="none" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
      <View style={{ alignItems: 'flex-end', marginTop: -6 }}>
        <AppText accessibilityRole="link" size={14} weight="700" onPress={() => nav.navigate('Forgot')} style={{ color: c.primary, paddingVertical: 8 }}>{t('forgotPassword')}</AppText>
      </View>
      <ErrorNote message={error} />
      <Button title={t('signIn')} onPress={submit} loading={busy} disabled={!ready} />
    </AuthLayout>
  );
}
