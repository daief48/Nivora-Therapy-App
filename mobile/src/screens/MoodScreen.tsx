import React, { useMemo, useState } from 'react';
import { Alert, useWindowDimensions } from 'react-native';
import { api } from '../api/client';
import { noteCrisis } from '../api/crisisShape';
import type { CrisisPayload } from '../api/practice';
import { CrisisNotice } from '../components/CrisisNotice';
import { errorMessageKey, useInvalidatingMutation, useMoods } from '../api/hooks';
import { MoodChart } from '../components/MoodChart';
import { MoodFace, type MoodLevel } from '../components/MoodFace';
import { ScorePicker } from '../components/MoodPicker';
import { AppText, Button, Card, Chip, EmptyState, Field, QueryBoundary, Row, Screen } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { aggregateMoods, type Range } from '../utils/moods';

export function MoodPanel() {
  const t = useT();
  const { width } = useWindowDimensions();
  const q = useMoods();
  const [range, setRange] = useState<Range>('days');
  const [mood, setMood] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; key: StringKey } | null>(null);
  const save = useInvalidatingMutation((v: object) => api('/moods', { method: 'POST', body: v }), [['moods']]);
  const del = useInvalidatingMutation((id: string) => api(`/moods/${id}`, { method: 'DELETE' }), [['moods']]);
  const points = useMemo(() => aggregateMoods(q.data ?? [], range), [q.data, range]);

  const submit = async () => {
    if (!mood) return;
    try {
      setCrisis(null);
      const res = await save.mutateAsync({ moodScore: mood, ...(stress ? { stressScore: stress } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      // High-risk note: nothing was stored. Keep what they wrote, show support, no "saved".
      const found = noteCrisis(res);
      if (found) { setCrisis(found); setMsg(null); return; }
      setMood(null); setStress(null); setNote(''); setMsg({ ok: true, key: 'moodSaved' });
    } catch (e) { setMsg({ ok: false, key: errorMessageKey(e) }); }
  };

  return (
    <>
      <Card>
        <ScorePicker value={mood} onChange={setMood} labelKey="moodScore" faces />
        <ScorePicker value={stress} onChange={setStress} labelKey="stressScore" />
        <Field label={t('moodNote')} value={note} onChangeText={setNote} multiline maxLength={2000} />
        {crisis ? <CrisisNotice crisis={crisis} dismissLabel="notNow" onDismiss={() => setCrisis(null)} /> : null}
        <Button title={t('saveCheckin')} onPress={submit} disabled={!mood} loading={save.isPending} />
        {msg ? <AppText accessibilityRole="alert" style={{ color: msg.ok ? '#2E7D5B' : '#B3261E' }}>{t(msg.key)}</AppText> : null}
      </Card>
      <Row>
        <Chip label={t('range7')} selected={range === 'days'} onPress={() => setRange('days')} />
        <Chip label={t('range12w')} selected={range === 'weeks'} onPress={() => setRange('weeks')} />
        <Chip label={t('range12m')} selected={range === 'months'} onPress={() => setRange('months')} />
      </Row>
      <QueryBoundary q={q}>
        {(rows) => (
          <>
            <Card>
              <AppText size={13} muted>{t('userDataLabel')}</AppText>
              <MoodChart points={points} width={Math.min(width - 64, 520)} />
              <AppText size={12} muted>{t('chartNote')}</AppText>
            </Card>
            <AppText size={18} weight="700">{t('moodHistory')}</AppText>
            {rows.length === 0 ? <EmptyState body={t('chartEmpty')} /> : rows.slice(0, 30).map((m) => (
              <Card key={m.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ flex: 1, gap: 10 }}>
                    <MoodFace level={m.moodScore as MoodLevel} size={34} uid={`h${m.id.slice(0, 6)}`} />
                    <AppText weight="600" style={{ flex: 1 }}>{t(`moods${m.moodScore}` as StringKey)} ({m.moodScore}/5){m.stressScore ? ` · ${t('stressScore')} ${m.stressScore}/5` : ''}</AppText>
                  </Row>
                  <Button title={t('delete')} variant="ghost" style={{ minHeight: 40, paddingVertical: 4 }}
                    onPress={() => Alert.alert(t('deleteEntry'), undefined, [{ text: t('cancel'), style: 'cancel' }, { text: t('delete'), style: 'destructive', onPress: () => { del.mutate(m.id); } }])} />
                </Row>
                <AppText size={12} muted>{new Date(m.createdAt).toLocaleString()}</AppText>
                {m.note ? <AppText>{m.note}</AppText> : null}
              </Card>
            ))}
          </>
        )}
      </QueryBoundary>
    </>
  );
}

export function MoodScreen() {
  return <Screen><MoodPanel /></Screen>;
}
