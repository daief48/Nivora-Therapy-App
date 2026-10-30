import React, { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../api/client';
import { useGoals, useInvalidatingMutation } from '../api/hooks';
import type { Goal } from '../api/types';
import { AppText, Button, Card, EmptyState, Field, QueryBoundary, Row, Screen } from '../components/ui';
import { useT, type StringKey } from '../i18n';

const STATUS: Record<Goal['status'], StringKey> = { ACTIVE: 'goalActive', COMPLETED: 'goalCompleted', ARCHIVED: 'goalArchived' };

export function GoalsPanel() {
  const t = useT();
  const q = useGoals();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const create = useInvalidatingMutation((v: object) => api('/goals', { method: 'POST', body: v }), [['goals']]);
  const add = async () => {
    setErr(null);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr(t('targetDate')); return; }
    try { await create.mutateAsync({ title: title.trim(), ...(date ? { targetDate: new Date(date).toISOString() } : {}) }); setTitle(''); setDate(''); } catch { setErr(t('errorTitle')); }
  };
  return (
    <>
      <Card>
        <Field label={t('goalTitle')} value={title} onChangeText={setTitle} maxLength={200} />
        <Field label={t('targetDate')} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" maxLength={10} />
        {err ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{err}</AppText> : null}
        <Button title={t('addGoal')} onPress={add} disabled={!title.trim()} loading={create.isPending} />
      </Card>
      <QueryBoundary q={q}>
        {(goals) => goals.length === 0 ? <EmptyState body={t('noGoals')} /> : <>{goals.map((g) => <GoalCard key={g.id} goal={g} />)}</>}
      </QueryBoundary>
    </>
  );
}

export function GoalsScreen() {
  return <Screen><GoalsPanel /></Screen>;
}

function GoalCard({ goal }: { goal: Goal }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(false);
  const keys = [['goals']];
  const checkIn = useInvalidatingMutation((v: object) => api(`/goals/${goal.id}/check-ins`, { method: 'POST', body: v }), keys);
  const patch = useInvalidatingMutation((v: object) => api(`/goals/${goal.id}`, { method: 'PATCH', body: v }), keys);
  const del = useInvalidatingMutation(() => api(`/goals/${goal.id}`, { method: 'DELETE' }), keys);
  const n = Number(pct);
  const valid = pct !== '' && Number.isInteger(n) && n >= 0 && n <= 100;
  return (
    <Card>
      <AppText weight="700" size={17}>{goal.title}</AppText>
      <AppText size={13} muted>{t(STATUS[goal.status])}{goal.targetDate ? ` · ${new Date(goal.targetDate).toLocaleDateString()}` : ''} · {goal.checkIns[0]?.progressValue ?? 0}%</AppText>
      {goal.status === 'ACTIVE' ? (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={t('checkIn')} variant="secondary" onPress={() => setOpen(!open)} />
            <Button title={t('markComplete')} variant="ghost" onPress={() => { patch.mutate({ status: 'COMPLETED' }); }} />
            <Button title={t('archive')} variant="ghost" onPress={() => { patch.mutate({ status: 'ARCHIVED' }); }} />
          </Row>
          {open ? (
            <>
              <Field label={t('progressPct')} value={pct} onChangeText={(v) => setPct(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" />
              <Field label={t('goalNote')} value={note} onChangeText={setNote} multiline maxLength={1000} />
              {err ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{t('errorTitle')}</AppText> : null}
              <Button title={t('save')} disabled={!valid} loading={checkIn.isPending}
                onPress={async () => { setErr(false); try { await checkIn.mutateAsync({ progressValue: n, ...(note.trim() ? { note: note.trim() } : {}) }); setPct(''); setNote(''); setOpen(false); } catch { setErr(true); } }} />
            </>
          ) : null}
        </>
      ) : <Button title={t('goalActive')} variant="ghost" onPress={() => { patch.mutate({ status: 'ACTIVE' }); }} />}
      {goal.checkIns.length ? (
        <>
          <AppText size={13} weight="600">{t('history')}</AppText>
          {goal.checkIns.slice(0, 5).map((c) => <AppText key={c.id} size={13} muted>{new Date(c.createdAt).toLocaleDateString()} — {c.progressValue}%{c.note ? ` — ${c.note}` : ''}</AppText>)}
        </>
      ) : null}
      <Button title={t('delete')} variant="ghost" onPress={() => Alert.alert(t('delete'), goal.title, [{ text: t('cancel'), style: 'cancel' }, { text: t('delete'), style: 'destructive', onPress: () => { del.mutate(undefined as never); } }])} />
    </Card>
  );
}
