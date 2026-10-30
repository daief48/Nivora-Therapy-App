import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation, useMe } from '../api/hooks';
import type { Locale } from '../api/types';
import { Logo } from '../components/Brand';
import { AppText, Button, Card, Check, Chip, Field, Icon, IconCircle, ListRow, Row, Screen, SectionTitle } from '../components/ui';
import { SUPPORT_EMAIL } from '../config';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { setDailyReminder } from '../utils/reminders';

/** Profile tab: account header, then clearly grouped settings. */
export function SettingsScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const s = useSettings();
  const me = useMe();
  const signOut = useAuth((a) => a.signOut);
  const patchMe = useInvalidatingMutation((v: object) => api('/me', { method: 'PATCH', body: v }), [['me']]);
  const [hour, setHour] = useState(String(s.reminderHour));
  const [notice, setNotice] = useState<string | null>(null);

  const toggleReminder = async () => {
    const next = !s.reminderEnabled;
    const ok = await setDailyReminder(next, s.reminderHour, t('reminderText'), t('appName'));
    if (!ok) { Alert.alert(t('reminderLabel'), t('errorTitle')); return; }
    s.set({ reminderEnabled: next });
  };
  const applyHour = async () => {
    const h = Number(hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return;
    s.set({ reminderHour: h });
    if (s.reminderEnabled) await setDailyReminder(true, h, t('reminderText'), t('appName'));
    setNotice(t('savedOk'));
  };

  const initial = (me.data?.displayName ?? '?').trim().charAt(0).toUpperCase();
  return (
    <Screen>
      <Row style={{ gap: 14 }}>
        <View accessible={false} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <AppText size={28} weight="800" style={{ color: c.onPrimary }}>{initial}</AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText size={22} weight="800" accessibilityRole="header">{me.data?.displayName ?? t('profileTitle')}</AppText>
          <AppText size={13} muted numberOfLines={1}>{me.data?.email ?? ''}</AppText>
        </View>
        <Logo size={44} />
      </Row>

      <SectionTitle>{t('secLanguage')}</SectionTitle>
      <Card>
        <AppText weight="700" size={14}>{t('language')}</AppText>
        <Row style={{ flexWrap: 'wrap' }}><Chip label="English" selected={s.uiLang === 'en'} onPress={() => s.set({ uiLang: 'en' })} /><Chip label="বাংলা" selected={s.uiLang === 'bn'} onPress={() => s.set({ uiLang: 'bn' })} /></Row>
        <AppText weight="700" size={14}>{t('aiLanguage')}</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          {(['en', 'bn', 'mixed'] as Locale[]).map((l) => (
            <Chip key={l} label={t(l === 'en' ? 'langEn' : l === 'bn' ? 'langBn' : 'langMixed')} selected={me.data?.locale === l} onPress={() => patchMe.mutate({ locale: l })} />
          ))}
        </Row>
        <AppText weight="700" size={14}>{t('themeLabel')}</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label={t('themeSystem')} selected={s.theme === 'system'} onPress={() => s.set({ theme: 'system' })} />
          <Chip label={t('themeLight')} selected={s.theme === 'light'} onPress={() => s.set({ theme: 'light' })} />
          <Chip label={t('themeDark')} selected={s.theme === 'dark'} onPress={() => s.set({ theme: 'dark' })} />
        </Row>
      </Card>

      <SectionTitle>{t('secVoice')}</SectionTitle>
      <Card>
        <Row style={{ alignItems: 'flex-start', gap: 12 }}>
          <IconCircle icon="volume-high-outline" tone={2} size={40} />
          <View style={{ flex: 1, gap: 6 }}>
            <Check checked={s.naturalVoice} onToggle={() => s.set({ naturalVoice: !s.naturalVoice })} label={t('naturalVoice')} />
            <AppText size={12} muted>{t('naturalVoiceNote')}</AppText>
          </View>
        </Row>
      </Card>

      <SectionTitle>{t('secAccessibility')}</SectionTitle>
      <Card>
        <AppText weight="700" size={14}>{t('textSize')}</AppText>
        <Row>{([1, 1.15, 1.3] as const).map((f) => <Chip key={f} label={`${Math.round(f * 100)}%`} selected={s.fontScale === f} onPress={() => s.set({ fontScale: f })} />)}</Row>
        <Check checked={s.reducedMotion} onToggle={() => s.set({ reducedMotion: !s.reducedMotion })} label={t('reduceMotion')} />
      </Card>

      <SectionTitle>{t('notifications')}</SectionTitle>
      <Card>
        <AppText size={13} muted>{t('reminderNote')}</AppText>
        <Check checked={s.reminderEnabled} onToggle={toggleReminder} label={t('reminderLabel')} />
        {s.reminderEnabled ? (
          <>
            <Field label={t('reminderHour')} value={hour} onChangeText={(v) => setHour(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
            <Button title={t('save')} variant="secondary" onPress={applyHour} />
            {notice ? <AppText size={13}>{notice}</AppText> : null}
          </>
        ) : null}
      </Card>

      <SectionTitle>{t('sectionPrivacy')}</SectionTitle>
      <Card>
        <ListRow icon="bookmark-outline" tone={3} label={t('rowMemory')} onPress={() => nav.navigate('Memory')} />
        <ListRow icon="shield-checkmark-outline" tone={0} label={t('privacy')} onPress={() => nav.navigate('Privacy')} />
        <ListRow icon="phone-portrait-outline" tone={2} label={t('devicesSessions')} onPress={() => nav.navigate('Privacy')} />
        <ListRow icon="download-outline" tone={1} label={t('exportDelete')} onPress={() => nav.navigate('Privacy')} />
        <ListRow icon="time-outline" tone={2} label={t('historyTitle')} onPress={() => nav.navigate('History')} />
      </Card>

      <SectionTitle>{t('emergency')}</SectionTitle>
      <Card>
        <ListRow icon="medkit-outline" tone={3} label={t('emergency')} onPress={() => nav.navigate('Emergency')} />
        <ListRow icon="information-circle-outline" tone={1} label={t('aboutNivora')} onPress={() => nav.navigate('About')} />
      </Card>

      <Button title={t('signOut')} variant="ghost" icon="log-out-outline"
        onPress={() => Alert.alert(t('signOutConfirm'), undefined, [{ text: t('cancel'), style: 'cancel' }, { text: t('signOut'), onPress: () => { void signOut(); } }])} />
    </Screen>
  );
}

export function AboutScreen() {
  const t = useT();
  return (
    <Screen>
      <Row style={{ gap: 12 }}><Logo size={52} /><AppText size={24} weight="800">{t('appName')}</AppText></Row>
      <AppText muted>{t('tagline')}</AppText>
      <Card tone="lavender">
        <Row><Icon name="information-circle-outline" size={20} /><AppText weight="800">{t('limitsTitle')}</AppText></Row>
        <AppText>{t('limitsBody')}</AppText>
      </Card>
      <Card>
        <AppText size={17} weight="800">{t('support')}</AppText>
        {SUPPORT_EMAIL
          ? <Button title={SUPPORT_EMAIL} variant="secondary" icon="mail-outline" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          : <AppText>{t('supportBody')}</AppText>}
      </Card>
    </Screen>
  );
}
