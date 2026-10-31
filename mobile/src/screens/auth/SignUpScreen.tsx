import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import type { Locale } from '../../api/types';
import { AuthField, AuthLayout, ErrorNote, StrengthMeter, isEmail, passwordScore, useFieldRefs } from '../../components/auth';
import { AppText, Button, Card, Check, Chip, Row } from '../../components/ui';
import { AiDisclosure } from '../../components/AiBadge';
import { useT } from '../../i18n';
import type { Nav } from '../../navigation/types';
import { useAuth } from '../../store/auth';
import { useSettings } from '../../store/settings';
import { radius, useTheme } from '../../theme';

const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'bn', label: 'বাংলা' }, { id: 'hi', label: 'हिन्दी' }, { id: 'ne', label: 'नेपाली' }, { id: 'mixed', label: 'Mixed' },
];

/** Two short steps instead of one long form: account details, then language + consent. */
export function SignUpScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const signInWith = useAuth((s) => s.signInWith);
  const uiLang = useSettings((s) => s.uiLang);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [country, setCountry] = useState('');
  const [locale, setLocale] = useState<Locale>(uiLang);
  const [age, setAge] = useState(false);
  const [ai, setAi] = useState(false);
  const [priv, setPriv] = useState(false);
  const [remember, setRemember] = useState(true);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = useFieldRefs(['email', 'password'] as const);

  const emailErr = touched.email && email.trim() && !isEmail(email) ? t('authEmailInvalid') : null;
  const pwErr = touched.password && password
    ? (password.length < 10 ? t('authPwShort') : passwordScore(password) < 2 ? t('authPwNeedsMix') : null) : null;
  const step1Ok = !!name.trim() && isEmail(email) && password.length >= 10 && passwordScore(password) >= 2;
  const allAgreed = age && ai && priv;
  const toggleAll = () => { const v = !allAgreed; setAge(v); setAi(v); setPriv(v); };

  const submit = async () => {
    setError(null);
    if (!allAgreed) { setError(t('consentRequiredMsg')); return; }
    setBusy(true);
    try {
      const d = await api<{ accessToken: string; refreshToken: string }>('/auth/register', {
        method: 'POST', auth: false,
        body: {
          email: email.trim(), password, displayName: name.trim(), locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          ...(country.trim().length === 2 ? { countryCode: country.trim().toUpperCase() } : {}),
          consents: { age18Plus: true, aiDisclosure: true, privacy: true },
          rememberSessions: remember,
        },
      });
      await signInWith(d);
    } catch (e) {
      const err = e as ApiError;
      setError(err.isNetwork ? t('errorNetwork') : err.details ? (err.details as { message: string }[]).map((x) => x.message).join(' ') : err.message);
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('authSignUpTitle')} subtitle={t('authSignUpSub')}
      footer={<Button title={t('haveAccount')} variant="ghost" onPress={() => nav.navigate('SignIn')} />}>
      {/* progress */}
      <View accessible accessibilityLabel={`${step}/2`} style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2].map((i) => <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= step ? c.primary : c.border }} />)}
      </View>

      {step === 1 ? (
        <>
          <AuthField label={t('displayName')} icon="person-outline" value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={f.focus('email')} blurOnSubmit={false} />
          <AuthField ref={f.set('email')} label={t('email')} icon="mail-outline" value={email} onChangeText={setEmail} onBlur={() => setTouched((s) => ({ ...s, email: true }))} error={emailErr}
            autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={f.focus('password')} blurOnSubmit={false} />
          <AuthField ref={f.set('password')} label={t('password')} icon="lock-closed-outline" password value={password} onChangeText={setPassword} onBlur={() => setTouched((s) => ({ ...s, password: true }))}
            error={pwErr} hint={t('passwordHint')} autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => step1Ok && setStep(2)} />
          <StrengthMeter password={password} />
          <Button title={t('next')} onPress={() => setStep(2)} disabled={!step1Ok} />
        </>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <AppText size={14} weight="700">{t('chooseLanguage')}</AppText>
            <Row style={{ flexWrap: 'wrap' }}>
              {LOCALES.map((l) => <Chip key={l.id} label={l.id === 'mixed' ? t('langMixed') : l.label} selected={locale === l.id} onPress={() => setLocale(l.id)} />)}
            </Row>
          </View>
          <AuthField label={`${t('country')} (${t('optional')})`} icon="language" value={country} onChangeText={(v) => setCountry(v.replace(/[^a-zA-Z]/g, '').slice(0, 2))} autoCapitalize="characters" maxLength={2} placeholder="BD" />

          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText size={14} weight="700">{t('authConsentTitle')}</AppText>
              <Pressable accessibilityRole="button" onPress={toggleAll} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                <AppText size={14} weight="700" style={{ color: c.primary }}>{t('authAgreeAll')}</AppText>
              </Pressable>
            </View>
            <AiDisclosure />
            <Check checked={age} onToggle={() => setAge(!age)} label={t('consentAge')} />
            <Check checked={ai} onToggle={() => setAi(!ai)} label={t('consentAi')} />
            <Check checked={priv} onToggle={() => setPriv(!priv)} label={t('consentPrivacy')} />
          </View>

          <Card tone="lavender" style={{ borderRadius: radius.lg }}>
            <Check checked={remember} onToggle={() => setRemember(!remember)} label={t('memSignupLabel')} />
            <AppText size={13} muted>{t('memSignupWhat')}</AppText>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore(!more)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <AppText size={14} weight="700" style={{ color: c.primary }}>{more ? t('memLearnLess') : t('memLearnMore')}</AppText>
            </Pressable>
            {more ? <AppText size={13}>{t('memLearnBody')}</AppText> : null}
          </Card>

          <ErrorNote message={error} />
          <Button title={t('signUp')} onPress={submit} loading={busy} disabled={!allAgreed} />
          <Button title={t('back')} variant="ghost" onPress={() => setStep(1)} />
        </>
      )}
    </AuthLayout>
  );
}
