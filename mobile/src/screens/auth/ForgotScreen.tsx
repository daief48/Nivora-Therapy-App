import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { AppText, Button, Field, Screen } from '../../components/ui';
import { useT } from '../../i18n';
import type { Nav } from '../../navigation/types';

export function ForgotScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setMsg(null);
    try { await fn(); } catch (e) { const err = e as ApiError; setError(err.isNetwork ? t('errorNetwork') : err.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <AppText size={26} weight="700">{t('resetTitle')}</AppText>
      {step === 'request' ? (
        <>
          <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Button title={t('resetSend')} loading={busy} disabled={!email.trim()}
            onPress={() => run(async () => { await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email: email.trim() } }); setMsg(t('resetSent')); })} />
          <Button title={t('resetHaveCode')} variant="ghost" onPress={() => setStep('reset')} />
        </>
      ) : (
        <>
          <Field label={t('resetToken')} value={token} onChangeText={setToken} autoCapitalize="none" />
          <Field label={t('newPassword')} hint={t('passwordHint')} value={password} onChangeText={setPassword} secureTextEntry />
          <Button title={t('save')} loading={busy} disabled={!token.trim() || password.length < 10}
            onPress={() => run(async () => { await api('/auth/reset-password', { method: 'POST', auth: false, body: { token: token.trim(), password } }); setMsg(t('resetDone')); setTimeout(() => nav.navigate('SignIn'), 800); })} />
        </>
      )}
      {msg ? <AppText accessibilityRole="alert" style={{ color: '#2E7D5B' }}>{msg}</AppText> : null}
      {error ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{error}</AppText> : null}
    </Screen>
  );
}
