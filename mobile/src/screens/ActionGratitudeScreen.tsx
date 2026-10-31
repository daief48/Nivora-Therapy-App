import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { postGratitude, type GratitudeResult } from '../api/actions';
import { Celebrate } from '../components/Celebrate';
import { CrisisSupport } from '../components/practice/parts';
import { AppText, Button, Card, Field, Hero, Screen } from '../components/ui';
import { useT } from '../i18n';
import { useAT } from '../i18n/actionsT';

/** GRATITUDE_NOTE: one field, saved as a normal journal entry with a GRATITUDE type marker. Nothing is stored if the text raises a safety flag. */
export function ActionGratitudeScreen() {
  const t = useT();
  const at = useAT();
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [res, setRes] = useState<GratitudeResult | null>(null);

  if (res?.crisis) return <Screen><CrisisSupport crisis={res} onEmergency={() => nav.navigate('Emergency')} onExit={() => nav.goBack()} /></Screen>;
  if (res) {
    return (
      <Screen>
        <Card>
          <AppText size={18} weight="800" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{at('agSaved')}</AppText>
          <Celebrate play={1} variant="glow" />
          <Button title={at('agFinish')} onPress={() => nav.goBack()} />
        </Card>
      </Screen>
    );
  }
  const body = text.trim();
  const save = async () => {
    if (!body || busy) return;
    setErr(false); setBusy(true);
    try {
      const r = await postGratitude(body);
      setRes(r);
      if (!r.crisis) void qc.invalidateQueries({ queryKey: ['journal'] });
    } catch { setErr(true); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header">{at('agTitle')}</AppText>
        <AppText size={14}>{at('agIntro')}</AppText>
      </Hero>
      <Field value={text} onChangeText={setText} placeholder={at('agPh')} multiline maxLength={1000} accessibilityLabel={at('agTitle')} style={{ minHeight: 120 }} />
      {err ? <AppText accessibilityRole="alert" size={14}>{at('acError')}</AppText> : null}
      <Button title={at('agSave')} onPress={() => { void save(); }} disabled={!body} loading={busy} />
      <Button title={t('cancel')} variant="ghost" onPress={() => nav.goBack()} />
    </Screen>
  );
}
