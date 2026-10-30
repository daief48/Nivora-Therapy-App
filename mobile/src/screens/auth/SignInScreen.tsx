import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { AppText, Button, Field, Screen } from '../../components/ui';
import { useT } from '../../i18n';
import type { Nav } from '../../navigation/types';
import { useAuth } from '../../store/auth';

export function SignInScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const signInWith = useAuth((s) => s.signInWith);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await signInWith(await api('/auth/login', { method: 'POST', auth: false, body: { email: email.trim(), password } }));
    } catch (e) {
      const err = e as ApiError;
      setError(err.isNetwork ? t('errorNetwork') : err.status === 429 ? t('aiBusy') : t('loginFailed'));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <AppText size={26} weight="700">{t('signIn')}</AppText>
      <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      {error ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{error}</AppText> : null}
      <Button title={t('signIn')} onPress={submit} loading={busy} disabled={!email.trim() || !password} />
      <Button title={t('forgotPassword')} variant="ghost" onPress={() => nav.navigate('Forgot')} />
      <Button title={t('noAccount')} variant="ghost" onPress={() => nav.navigate('SignUp')} />
    </Screen>
  );
}
