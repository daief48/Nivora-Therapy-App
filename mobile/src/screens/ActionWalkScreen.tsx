import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { View } from 'react-native';
import { postWalk, useWalkChoices, type WalkResult } from '../api/actions';
import { Celebrate } from '../components/Celebrate';
import { CrisisSupport } from '../components/practice/parts';
import { AppText, Button, Card, Chip, ErrorState, Field, Hero, Loading, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useAT } from '../i18n/actionsT';
import { FadeInUp } from '../motion';

const MINUTES = [5, 10, 15, 20, 30];

/** A small pleasant or movement task for today (WALK_10): pick a gentle idea or write one. It becomes one small Kaizen step. */
export function ActionWalkScreen() {
  const t = useT();
  const at = useAT();
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const choices = useWalkChoices();
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [need, setNeed] = useState(false);
  const [res, setRes] = useState<WalkResult | null>(null);

  if (choices.isLoading) return <Screen><Loading /></Screen>;
  if (choices.isError && !choices.data) return <Screen><ErrorState error={choices.error} onRetry={() => { void choices.refetch(); }} /></Screen>;

  if (res?.crisis) return <Screen><CrisisSupport crisis={res} onEmergency={() => nav.navigate('Emergency')} onExit={() => nav.goBack()} /></Screen>;
  if (res) {
    const flower = !res.alreadyDone && res.flowers > 0;
    return (
      <Screen>
        <Card>
          <View style={{ alignItems: 'center', gap: 10, minHeight: 150, justifyContent: 'center' }}>
            <AppText size={18} weight="800" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{res.alreadyDone ? at('awAlready') : at('awDone')}</AppText>
            <AppText style={{ textAlign: 'center' }}>{res.action.title}</AppText>
            {flower ? <AppText weight="700" style={{ textAlign: 'center' }}>{at('awFlower')}</AppText> : null}
            <Celebrate play={flower ? 1 : 0} variant="petals" haptic />
          </View>
          <Button title={at('awFinish')} onPress={() => nav.goBack()} />
        </Card>
      </Screen>
    );
  }

  const free = text.trim();
  const submit = async () => {
    if (busy) return;
    if (!choice && !free) { setNeed(true); return; }
    setNeed(false); setErr(false); setBusy(true);
    try {
      const r = await postWalk(free ? { text: free.slice(0, 80), minutes } : { choice: choice! });
      setRes(r);
      if (!r.crisis) void qc.invalidateQueries({ queryKey: ['kaizen'] });
    } catch { setErr(true); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header">{at('awTitle')}</AppText>
        <AppText size={14}>{at('awIntro')}</AppText>
      </Hero>
      <FadeInUp>
        <SectionTitle>{at('awChoose')}</SectionTitle>
        <Row style={{ flexWrap: 'wrap' }}>
          {(choices.data?.choices ?? []).map((c) => (
            <Chip key={c.key} label={`${c.label} · ${at('acMinutes', { n: c.minutes })}`} selected={choice === c.key && !free} onPress={() => { setChoice(c.key); setText(''); setNeed(false); }} />
          ))}
        </Row>
      </FadeInUp>
      <SectionTitle>{at('awOwn')}</SectionTitle>
      <Field value={text} onChangeText={(v) => { setText(v); if (v) setChoice(null); }} placeholder={at('awOwnPh')} maxLength={80} accessibilityLabel={at('awOwn')} />
      {free ? (
        <>
          <AppText size={14} muted>{at('awMinutes')}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>{MINUTES.map((m) => <Chip key={m} label={at('acMinutes', { n: m })} selected={minutes === m} onPress={() => setMinutes(m)} />)}</Row>
        </>
      ) : null}
      {need ? <AppText accessibilityRole="alert" size={14}>{at('awNeed')}</AppText> : null}
      {err ? <AppText accessibilityRole="alert" size={14}>{at('acError')}</AppText> : null}
      <Button title={at('awSave')} onPress={() => { void submit(); }} loading={busy} />
      <Button title={t('cancel')} variant="ghost" onPress={() => nav.goBack()} />
    </Screen>
  );
}
