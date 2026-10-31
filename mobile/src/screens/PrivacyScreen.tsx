import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Share, Switch, View } from 'react-native';
import { useSettings } from '../store/settings';
import { clearAnalyticsQueue } from '../utils/analytics';
import { api, ApiError } from '../api/client';
import { useConsents, useDevices, useInvalidatingMutation } from '../api/hooks';
import { AppText, Button, Card, Field, Icon, QueryBoundary, Row, Screen } from '../components/ui';
import { AiDisclosure } from '../components/AiBadge';
import { useT, type StringKey } from '../i18n';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme';

const LABEL: Record<string, StringKey> = { AGE_18_PLUS: 'consentAge', AI_DISCLOSURE: 'consentAi', PRIVACY: 'consentPrivacy', JOURNAL_AI_SHARING: 'shareConsentTitle', WELLNESS_AI_SHARING: 'consentWellness' };

type TherapyPrefs = { continuityOptIn: boolean; qualityReviewOptIn: boolean; guidedAck: boolean };
const NO_PREFS: TherapyPrefs = { continuityOptIn: true, qualityReviewOptIn: false, guidedAck: false };

/** Memory is ON when the preference was never stored (same as sign-up); sharing for quality review stays OFF until the server confirms it. */
function useTherapyPrefs() {
  const [prefs, setPrefs] = useState<TherapyPrefs>(NO_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Partial<TherapyPrefs>>('/therapy/preferences')
      .then((p) => { if (live) { setPrefs({ ...NO_PREFS, ...p, continuityOptIn: p?.continuityOptIn !== false }); setLoaded(true); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return { prefs, setPrefs, loaded, failed };
}

export function PrivacyScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<any>();
  const { prefs, setPrefs, loaded, failed: prefsFailed } = useTherapyPrefs();
  const [prefNote, setPrefNote] = useState<string | null>(null);
  const [prefBusy, setPrefBusy] = useState(false);
  const savePref = async (patch: Partial<TherapyPrefs>) => {
    setPrefBusy(true); setPrefNote(null);
    try {
      const next = await api<TherapyPrefs>('/therapy/preferences', { method: 'PUT', body: { ...prefs, ...patch } });
      setPrefs({ ...prefs, ...patch, ...next });
    } catch { setPrefNote(t('dcShareFail')); } finally { setPrefBusy(false); }
  };
  const setShare = async (on: boolean) => {
    if (on) return savePref({ qualityReviewOptIn: true });
    // Turning sharing off also deletes every excerpt already shared.
    setPrefBusy(true); setPrefNote(null);
    try { await api('/quality/revoke', { method: 'POST' }); setPrefs({ ...prefs, qualityReviewOptIn: false }); setPrefNote(t('dcShareOffDone')); }
    catch { setPrefNote(t('dcShareFail')); } finally { setPrefBusy(false); }
  };
  const signOut = useAuth((s) => s.signOut);
  const analyticsOptIn = useSettings((s) => s.analyticsOptIn);
  const setSettings = useSettings((s) => s.set);
  const consents = useConsents();
  const devices = useDevices();
  const withdraw = useInvalidatingMutation((id: string) => api(`/consents/${id}`, { method: 'DELETE' }), [['consents']]);
  const grant = useInvalidatingMutation((consentType: string) => api('/consents', { method: 'POST', body: { consentType } }), [['consents']]);
  const revoke = useInvalidatingMutation((id: string) => api(`/auth/devices/${id}`, { method: 'DELETE' }), [['devices']]);
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await api('/privacy/export', { method: 'POST' });
      // The export contains decrypted personal data: it is handed to the OS share sheet and never stored by the app.
      await Share.share({ title: 'my-data.json', message: JSON.stringify(data, null, 2) });
    } catch { Alert.alert(t('errorTitle')); } finally { setExporting(false); }
  };
  const doDelete = async () => {
    setDelBusy(true); setDelErr(null);
    try { await api('/privacy/account', { method: 'DELETE', body: { password } }); setShowDelete(false); await signOut(); }
    catch (e) { setDelErr((e as ApiError).isNetwork ? t('errorNetwork') : t('loginFailed')); }
    finally { setDelBusy(false); }
  };

  return (
    <Screen>
      <AppText size={26} weight="700">{t('privacy')}</AppText>
      <AppText size={13} muted>{t('retention')}</AppText>
      <AiDisclosure more />
      <Card tone="lavender">
        <Row style={{ alignItems: 'flex-start' }}><Icon name="volume-high-outline" size={20} color={c.accent} /><AppText size={13} style={{ flex: 1 }}>{t('privacyVoiceNote')}</AppText></Row>
      </Card>

      <Card>
        <AppText size={16} weight="700">{t('platAnalyticsTitle')}</AppText>
        <AppText size={13} muted>{t('platAnalyticsBody')}</AppText>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText size={14} style={{ flex: 1 }}>{t('platAnalyticsToggle')}</AppText>
          <Switch value={analyticsOptIn} accessibilityLabel={t('platAnalyticsToggle')}
            onValueChange={(v) => { setSettings({ analyticsOptIn: v }); if (!v) clearAnalyticsQueue(); }} />
        </Row>
      </Card>

      <AppText size={18} weight="700" accessibilityRole="header">{t('dcTitle')}</AppText>
      <Card>
        <AppText size={16} weight="700">{t('memCardTitle')}</AppText>
        <AppText size={13} muted>{t('memCardBody')}</AppText>
        <AppText size={13} muted>{t('memSignupWhat')}</AppText>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText size={14} style={{ flex: 1 }}>{t('memSwitchLabel')}</AppText>
          <Switch value={prefs.continuityOptIn} disabled={!loaded || prefBusy} accessibilityLabel={t('memSwitchLabel')}
            onValueChange={(v) => savePref({ continuityOptIn: v })} />
        </Row>
        {loaded && !prefs.continuityOptIn ? (
          <>
            <AppText size={13} accessibilityLiveRegion="polite">{t('memOffNote')}</AppText>
            <Button title={t('memOffLink')} variant="ghost" icon="trash-outline" onPress={() => nav.navigate('Memory')} />
          </>
        ) : null}
        <Button title={t('memHeading')} variant="ghost" icon="bookmark-outline" onPress={() => nav.navigate('Memory')} />
        <Button title={t('dcManage')} variant="secondary" icon="document-text-outline" accessibilityLabel={`${t('dcManage')}. ${t('dcManageHint')}`} onPress={() => nav.navigate('SessionData')} />
      </Card>

      <Card tone="lavender">
        <AppText size={16} weight="700">{t('dcShareTitle')}</AppText>
        <AppText size={13}>{t('dcShareBody')}</AppText>
        <AppText size={13} muted>{t('dcShareNever')}</AppText>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText size={14} style={{ flex: 1 }}>{t('dcShareToggle')}</AppText>
          <Switch value={prefs.qualityReviewOptIn} disabled={!loaded || prefBusy} accessibilityLabel={t('dcShareToggle')}
            onValueChange={setShare} />
        </Row>
        {prefNote || prefsFailed ? <AppText size={13} accessibilityRole="alert" style={{ color: prefsFailed && !prefNote ? c.textMuted : undefined }}>{prefNote ?? t('dcShareFail')}</AppText> : null}
        <Button title={t('dcShareSee')} variant="ghost" icon="eye-outline" onPress={() => nav.navigate('SessionData')} />
      </Card>

      <AppText size={18} weight="700">{t('consentsHeader')}</AppText>
      <QueryBoundary q={consents}>
        {(rows) => {
          const active = new Map(rows.filter((r) => !r.withdrawnAt).map((r) => [r.consentType, r]));
          return (
            <>
              {Object.keys(LABEL).map((type) => {
                const a = active.get(type);
                return (
                  <Card key={type}>
                    <AppText size={14}>{t(LABEL[type]!)}</AppText>
                    <Button title={a ? t('withdraw') : t('grant')} variant={a ? 'ghost' : 'secondary'}
                      onPress={() => (a ? withdraw.mutate(a.id) : grant.mutate(type))} />
                  </Card>
                );
              })}
            </>
          );
        }}
      </QueryBoundary>

      <AppText size={18} weight="700">{t('sessionsDevices')}</AppText>
      <QueryBoundary q={devices}>
        {(rows) => (
          <>
            {rows.map((d) => (
              <Card key={d.id}>
                <AppText size={14}>{d.userAgent ?? '—'}{d.current ? ` (${t('thisDevice')})` : ''}</AppText>
                <AppText size={12} muted>{new Date(d.lastActiveAt).toLocaleString()}</AppText>
                {!d.current ? <Button title={t('revoke')} variant="ghost" onPress={() => revoke.mutate(d.id)} /> : null}
              </Card>
            ))}
            <Button title={t('signOutOthers')} variant="secondary" onPress={async () => { try { await api('/auth/logout-all', { method: 'POST' }); } finally { await signOut(); } }} />
          </>
        )}
      </QueryBoundary>

      <Button title={t('exportData')} variant="secondary" onPress={doExport} loading={exporting} />
      <Button title={t('deleteAccount')} variant="danger" onPress={() => { setPassword(''); setDelErr(null); setShowDelete(true); }} />

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 16, gap: 12 }}>
            <AppText size={20} weight="700">{t('deleteAccount')}</AppText>
            <AppText>{t('deleteAccountBody')}</AppText>
            <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
            {delErr ? <AppText accessibilityRole="alert" style={{ color: c.danger }}>{delErr}</AppText> : null}
            <Row>
              <Button title={t('cancel')} variant="ghost" onPress={() => setShowDelete(false)} style={{ flex: 1 }} />
              <Button title={t('delete')} variant="danger" onPress={doDelete} loading={delBusy} disabled={!password} style={{ flex: 1 }} />
            </Row>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
