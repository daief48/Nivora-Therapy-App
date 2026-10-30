import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { Locale } from '../../api/types';
import { AppText, Button, Check, Chip, Field, Row, Screen } from '../../components/ui';
import { useT } from '../../i18n';
import type { Nav } from '../../navigation/types';
import { useAuth } from '../../store/auth';
import { useSettings } from '../../store/settings';

export function SignUpScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const signInWith = useAuth((s) => s.signInWith);
  const uiLang = useSettings((s) => s.uiLang);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('');
  const [locale, setLocale] = useState<Locale>(uiLang === 'bn' ? 'bn' : 'en');
  const [age, setAge] = useState(false);
  const [ai, setAi] = useState(false);
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!(age && ai && priv)) { setError(t('consentRequiredMsg')); return; }
    setBusy(true);
    try {
      const d = await api<{ accessToken: string; refreshToken: string }>('/auth/register', {
        method: 'POST', auth: false,
        body: {
          email: email.trim(), password, displayName: name.trim(), locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          ...(country.trim().length === 2 ? { countryCode: country.trim().toUpperCase() } : {}),
          consents: { age18Plus: true, aiDisclosure: true, privacy: true },
        },
      });
      await signInWith(d);
    } catch (e) {
      const err = e as ApiError;
      setError(err.isNetwork ? t('errorNetwork') : err.details ? (err.details as { message: string }[]).map((x) => x.message).join(' ') : err.message);
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <AppText size={26} weight="700">{t('signUp')}</AppText>
      <Field label={t('displayName')} value={name} onChangeText={setName} autoComplete="name" />
      <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label={t('password')} hint={t('passwordHint')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <AppText weight="600" size={14}>{t('chooseLanguage')}</AppText>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={t('langEn')} selected={locale === 'en'} onPress={() => setLocale('en')} />
        <Chip label={t('langBn')} selected={locale === 'bn'} onPress={() => setLocale('bn')} />
        <Chip label={t('langMixed')} selected={locale === 'mixed'} onPress={() => setLocale('mixed')} />
      </Row>
      <Field label={t('country')} value={country} onChangeText={(v) => setCountry(v.replace(/[^a-zA-Z]/g, '').slice(0, 2))} autoCapitalize="characters" maxLength={2} />
      <Check checked={age} onToggle={() => setAge(!age)} label={t('consentAge')} />
      <Check checked={ai} onToggle={() => setAi(!ai)} label={t('consentAi')} />
      <Check checked={priv} onToggle={() => setPriv(!priv)} label={t('consentPrivacy')} />
      {error ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{error}</AppText> : null}
      <Button title={t('signUp')} onPress={submit} loading={busy} disabled={!name.trim() || !email.trim() || password.length < 10} />
      <Button title={t('haveAccount')} variant="ghost" onPress={() => nav.navigate('SignIn')} />
    </Screen>
  );
}
