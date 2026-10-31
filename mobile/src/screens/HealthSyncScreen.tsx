import { useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { disconnectHealth, grantHealthConsent, importHealth, useHealthStatus } from '../api/health';
import { AppText, Button, Card, Check, IconCircle, Row, Screen, SectionTitle } from '../components/ui';
import { useTH } from '../i18n/th';
import { FadeInUp, successHaptic } from '../motion';
import { getHealthAdapter } from '../utils/healthNative';

const DAYS = 30;
const REFRESH = [['health'], ['sleep'], ['timeline'], ['summary'], ['routine'], ['today']];

/**
 * Optional import of sleep and steps from Health Connect (Android) or Apple Health (iOS).
 * Its own consent comes first; the native library is only touched when the user presses Connect, and every failure falls back
 * to a calm message so manual sleep entry is never affected.
 */
export function HealthSyncScreen() {
  const th = useTH();
  const qc = useQueryClient();
  const status = useHealthStatus();
  const adapter = useMemo(() => getHealthAdapter(), []);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const connected = !!status.data?.connected;
  const refresh = () => REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: k }));

  const sync = async (needConsent: boolean) => {
    if (!adapter) return;
    setBusy(true); setMsg(null);
    try {
      const avail = await adapter.availability();
      if (avail === 'needs_app') { setMsg({ text: th('thHealthNoApp'), ok: false }); return; }
      if (avail === 'unavailable') { setMsg({ text: th('thHealthUnavailable'), ok: false }); return; }
      if (needConsent) await grantHealthConsent();
      if (!(await adapter.request())) { setMsg({ text: th('thHealthDenied'), ok: false }); refresh(); return; }
      const data = await adapter.read(DAYS);
      if (!data.sleep.length && !data.activity.length) { setMsg({ text: th('thHealthNoData'), ok: false }); refresh(); return; }
      const r = await importHealth({ source: adapter.source, sleep: data.sleep, activity: data.activity });
      successHaptic();
      const skipped = r.skippedManual.sleep;
      setMsg({ text: `${th('thHealthDone', { sleep: r.imported.sleep, activity: r.imported.activity })}${skipped ? ` ${th('thHealthSkipped', { n: skipped })}` : ''}`, ok: true });
      refresh();
    } catch {
      setMsg({ text: th('thHealthFailed'), ok: false });
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await disconnectHealth();
      setConfirming(false); setAgree(false);
      setMsg({ text: th('thHealthDisconnected', { sleep: r.deleted.sleep, activity: r.deleted.activity }), ok: true });
      refresh();
    } catch { setMsg({ text: th('thHealthFailed'), ok: false }); }
    finally { setBusy(false); }
  };

  const srcName = adapter ? th(adapter.source === 'healthconnect' ? 'thHealthSourceHC' : 'thHealthSourceHK') : `${th('thHealthSourceHC')} / ${th('thHealthSourceHK')}`;

  return (
    <Screen>
      <FadeInUp>
        <View style={{ gap: 6 }}>
          <AppText size={22} weight="800" accessibilityRole="header">{th('thHealthTitle')}</AppText>
          <AppText muted>{th('thHealthIntro')}</AppText>
        </View>
      </FadeInUp>

      {!adapter ? <Card tone="lavender"><AppText>{th('thHealthUnavailable')}</AppText></Card> : null}

      {adapter && !connected ? (
        <FadeInUp delay={80}>
          <Card style={{ gap: 10 }}>
            <Row style={{ gap: 12 }}>
              <IconCircle icon="heart-outline" tone={0} size={44} />
              <AppText weight="800" size={16} style={{ flex: 1 }}>{srcName}</AppText>
            </Row>
            <AppText size={14} weight="700">{th('thHealthReads')}</AppText>
            <AppText size={14}>{th('thHealthReadSleep')}</AppText>
            <AppText size={14}>{th('thHealthReadSteps')}</AppText>
            <AppText size={13} muted>{th('thHealthNever')}</AppText>
            <Check checked={agree} onToggle={() => setAgree(!agree)} label={th('thHealthConsent')} />
            <Button title={busy ? th('thHealthWorking') : th('thHealthConnect')} icon="download-outline" disabled={!agree} loading={busy} onPress={() => sync(true)} />
          </Card>
        </FadeInUp>
      ) : null}

      {connected ? (
        <FadeInUp delay={80}>
          <Card style={{ gap: 10 }}>
            <Row style={{ gap: 12 }}>
              <IconCircle icon="checkmark-circle-outline" tone={1} size={44} />
              <AppText style={{ flex: 1 }} accessibilityLiveRegion="polite">
                {th('thHealthStatus', { sleep: status.data?.importedSleepNights ?? 0, activity: status.data?.importedActivityDays ?? 0 })}
              </AppText>
            </Row>
            {adapter ? <Button title={busy ? th('thHealthWorking') : th('thHealthSyncNow')} icon="refresh-outline" variant="secondary" loading={busy} onPress={() => sync(false)} /> : null}
          </Card>
        </FadeInUp>
      ) : status.data ? <AppText size={13} muted>{th('thHealthNotConnected')}</AppText> : null}

      {msg ? <Card tone={msg.ok ? undefined : 'alt'}><AppText accessibilityRole="alert" accessibilityLiveRegion="polite">{msg.text}</AppText></Card> : null}

      {connected ? (
        <>
          <SectionTitle>{th('thHealthDisconnect')}</SectionTitle>
          {confirming ? (
            <Card tone="alt" style={{ gap: 10 }} accessibilityRole="alert">
              <AppText weight="800">{th('thHealthConfirmTitle')}</AppText>
              <AppText size={14}>{th('thHealthConfirmBody')}</AppText>
              <Row style={{ flexWrap: 'wrap' }}>
                <Button title={th('thHealthConfirmYes')} variant="danger" loading={busy} onPress={disconnect} />
                <Button title={th('thHealthConfirmNo')} variant="ghost" onPress={() => setConfirming(false)} />
              </Row>
            </Card>
          ) : (
            <Button title={th('thHealthDisconnect')} variant="secondary" icon="trash-outline" onPress={() => setConfirming(true)} />
          )}
        </>
      ) : null}
    </Screen>
  );
}
