import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { AuthField, AuthLayout, ErrorNote, InfoNote, StrengthMeter, isEmail, passwordScore } from '../../components/auth';
import { Button } from '../../components/ui';
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
  const go = (s: 'request' | 'reset') => { setStep(s); setError(null); setMsg(null); };
  const pwOk = password.length >= 10 && passwordScore(password) >= 2;

  return (
    <AuthLayout title={t('resetTitle')} subtitle={t('authResetSub')}
      footer={<Button title={t('authBackToSignIn')} variant="ghost" onPress={() => nav.navigate('SignIn')} />}>
      {step === 'request' ? (
        <>
          <AuthField label={t('email')} icon="mail-outline" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <ErrorNote message={error} />
          <InfoNote message={msg} />
          <Button title={t('resetSend')} loading={busy} disabled={!isEmail(email)}
            onPress={() => run(async () => { await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email: email.trim() } }); setMsg(t('resetSent')); })} />
          <Button title={t('resetHaveCode')} variant="secondary" onPress={() => go('reset')} />
        </>
      ) : (
        <>
          <AuthField label={t('resetToken')} icon="keypad-outline" value={token} onChangeText={setToken} autoCapitalize="none" />
          <AuthField label={t('newPassword')} icon="lock-closed-outline" password hint={t('passwordHint')} value={password} onChangeText={setPassword} autoCapitalize="none" autoComplete="new-password" />
          <StrengthMeter password={password} />
          <ErrorNote message={error} />
          <InfoNote message={msg} />
          <Button title={t('save')} loading={busy} disabled={!token.trim() || !pwOk}
            onPress={() => run(async () => { await api('/auth/reset-password', { method: 'POST', auth: false, body: { token: token.trim(), password } }); setMsg(t('resetDone')); setTimeout(() => nav.navigate('SignIn'), 800); })} />
          <Button title={t('back')} variant="ghost" onPress={() => go('request')} />
        </>
      )}
    </AuthLayout>
  );
}
