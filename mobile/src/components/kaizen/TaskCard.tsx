/**
 * TaskCard — Feature A: the ONE small task a therapy session may have suggested.
 * No duration, no deadline: just the task, why it fits, and two gentle actions
 * (Done / Can't today). An empty state is normal and healthy.
 */
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation, useKaizenTask } from '../../api/hooks';
import { useAuth } from '../../store/auth';
import { AppText, Button, Card, Chip, Field, Row } from '../ui';
import { noteCrisis } from '../../api/crisisShape';
import type { KaizenTask, KaizenTaskWrite } from '../../api/types';
import { CrisisNotice } from '../CrisisNotice';
import { useT } from '../../i18n';
import { SupportOptions } from '../SupportOptions';

/** The "how do you feel now?" prompt survives the card unmounting (tab switch, refetch swap): it lives here until answered, skipped or dismissed. */
let pendingFelt: { id: string; skipped: boolean } | null = null;
/** Test helper: forget any open prompt. */
export const resetFeltPrompt = () => { pendingFelt = null; };
// Signing out must not leave one person's prompt for the next sign-in.
useAuth.subscribe((s) => { if (s.status === 'out') resetFeltPrompt(); });

export function TaskCard() {
  const t = useT();
  const q = useKaizenTask();
  const [justDone, setJustDoneState] = useState<{ id: string; skipped: boolean } | null>(pendingFelt);
  const setJustDone = (v: { id: string; skipped: boolean } | null) => { pendingFelt = v; setJustDoneState(v); };

  if (q.isLoading) return null;
  const data = q.data;
  if (!data || data.riskMode) return data?.riskMode ? <SupportOptions /> : null;

  const task = data.task;
  const feltPrompt = justDone ? <FeltPrompt taskId={justDone.id} noteSkipped={justDone.skipped} onClose={() => setJustDone(null)} /> : null;
  if (!task) {
    return (
      <View style={{ gap: 8 }}>
      {feltPrompt}
      <Card style={{ gap: 6 }} accessibilityLabel={t('kzTaskEmptyA11y')}>
        <AppText weight="700">{t('kzTaskEmptyTitle')}</AppText>
        <AppText size={13} muted>{t('kzTaskEmptyBody')}</AppText>
      </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {feltPrompt}
      <Card style={{ gap: 8 }} accessibilityLabel={t('kzTaskA11y', { content: task.content ?? '' })}>
        {task.standingStill ? <AppText size={12} muted>{t('kzTaskStandingNote')}</AppText> : null}
        <AppText size={17} weight="800">{task.content}</AppText>
        {task.reason ? <AppText size={13} muted>{task.reason}</AppText> : null}
        {task.stateNote ? <AppText size={12} muted>{t('kzTaskLastCheck', { note: task.stateNote })}</AppText> : null}
        <CueSection key={task.id} task={task} />
        {data.backoff ? <AppText size={12} muted>{t('kzCueBackoff')}</AppText> : null}
        <TaskActions taskId={task.id} onDone={(skipped) => setJustDone({ id: task.id, skipped })} />
      </Card>
      {data.history.length ? (
        <AppText size={12} muted>{t('kzTaskHistory', { n: data.history.length })}</AppText>
      ) : null}
    </View>
  );
}

function TaskActions({ taskId, onDone }: { taskId: string; onDone: (noteSkipped: boolean) => void }) {
  const t = useT();
  const done = useInvalidatingMutation((note?: string) => api(`/kaizen/task/${taskId}/complete`, { method: 'POST', body: { note } }), NIVORA_KEYS);
  const qc = useQueryClient();
  const gone = () => { void qc.invalidateQueries({ queryKey: ['kaizen'] }); }; // e.g. TASK_DROPPED: the task changed under us, so reload
  const react = useInvalidatingMutation(() => api(`/kaizen/task/${taskId}/react`, { method: 'POST', body: {} }), NIVORA_KEYS);
  const [skipped, setSkipped] = useState(false);
  return (
    <View style={{ gap: 6 }}>
    <Row style={{ gap: 10 }}>
      <Button title={t('kzTaskDone')} icon="checkmark" style={{ flex: 1 }} loading={done.isPending}
        onPress={() => done.mutate(undefined, { onError: gone, onSuccess: (r) => onDone(!!(r as KaizenTaskWrite | null)?.textSkipped) })} accessibilityLabel={t('kzTaskDoneA11y')} />
      <Button title={t('kzTaskNotToday')} variant="ghost" style={{ flex: 1 }} loading={react.isPending}
        onPress={() => react.mutate(undefined, { onError: gone, onSuccess: (r) => setSkipped(!!(r as KaizenTaskWrite | null)?.textSkipped) })} accessibilityLabel={t('kzTaskNotTodayA11y')} />
    </Row>
    {skipped ? <AppText size={12} muted accessibilityLiveRegion="polite">{t('kzTextSkipped')}</AppText> : null}
    {done.isError || react.isError ? <AppText size={12} muted accessibilityLiveRegion="polite">{t(errorMessageKey(done.isError ? done.error : react.error))}</AppText> : null}
    </View>
  );
}

const PRESETS = [{ key: 'kzCueMorning', time: '08:00' }, { key: 'kzCueAfternoon', time: '14:00' }, { key: 'kzCueEvening', time: '19:00' }] as const;

/** "When will you do it?": the saved cue (tap to edit) or a suggested-cue chip plus a free field and optional time presets. */
function CueSection({ task }: { task: KaizenTask }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.cue ?? '');
  const [time, setTime] = useState<string | null>(task.cueTime);
  const [crisis, setCrisis] = useState<ReturnType<typeof noteCrisis>>(null);
  const [retry, setRetry] = useState(false);
  const save = useInvalidatingMutation((v: { cue: string; time?: string }) => api<unknown>(`/kaizen/task/${task.id}/cue`, { method: 'POST', body: v }), NIVORA_KEYS);
  const send = (cue: string, at: string | null) => save.mutate({ cue: cue.trim(), ...(cue.trim() && at ? { time: at } : {}) }, {
    onSuccess: (r) => {
      const w = (r ?? {}) as KaizenTaskWrite;
      if (w.saved === false) { setRetry(true); return; } // safety check unavailable: nothing stored, keep what they typed
      setRetry(false);
      const cr = noteCrisis(r);
      if (cr) { setCrisis(cr); setText(''); setTime(null); return; }
      setCrisis(null); setEditing(false);
      if (!cue.trim()) { setText(''); setTime(null); }
    },
  });
  const showSaved = !!task.cue && !editing;
  return (
    <View style={{ gap: 6 }}>
      <AppText size={13} weight="700">{t('kzCueTitle')}</AppText>
      {showSaved ? (
        <Button title={task.cueTime ? t('kzCueAt', { cue: task.cue!, time: task.cueTime }) : task.cue!} variant="ghost"
          onPress={() => { setText(task.cue ?? ''); setTime(task.cueTime); setEditing(true); }} accessibilityLabel={t('kzCueEditA11y')} />
      ) : (
        <>
          {task.suggestedCue && !task.cue ? <Row style={{ flexWrap: 'wrap', gap: 8 }}><Chip label={t('kzCueUse', { cue: task.suggestedCue })} onPress={() => setText(task.suggestedCue!)} /></Row> : null}
          <Field value={text} onChangeText={(v) => { setText(v); setRetry(false); }} placeholder={t('kzCuePlaceholder')} maxLength={120} accessibilityLabel={t('kzCueTitle')} />
          <Row style={{ flexWrap: 'wrap', gap: 8 }}>
            {PRESETS.map((p) => <Chip key={p.key} label={t(p.key)} selected={time === p.time} onPress={() => setTime((cur) => (cur === p.time ? null : p.time))} />)}
          </Row>
          <Row style={{ gap: 10 }}>
            <Button title={t('kzCueSave')} style={{ flex: 1 }} loading={save.isPending} disabled={!text.trim()} onPress={() => send(text, time)} />
            {task.cue ? <Button title={t('kzCueClear')} variant="ghost" style={{ flex: 1 }} onPress={() => send('', null)} /> : null}
          </Row>
        </>
      )}
      {retry ? <AppText size={12} muted accessibilityLiveRegion="polite">{t('kzSafetyRetry')}</AppText> : null}
      {crisis ? <CrisisNotice crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}
    </View>
  );
}

/** After Done: one gentle tap on how it feels. Skippable, never required. Closes only once the answer is saved. */
function FeltPrompt({ taskId, noteSkipped, onClose }: { taskId: string; noteSkipped: boolean; onClose: () => void }) {
  const t = useT();
  const [worse, setWorse] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [skipped, setSkipped] = useState(noteSkipped);
  const inFlight = useRef(false); // set synchronously: isPending lags a render behind a rapid second tap
  const send = useInvalidatingMutation((felt: 'BETTER' | 'SAME' | 'WORSE') => api(`/kaizen/task/${taskId}/complete`, { method: 'POST', body: { felt } }), NIVORA_KEYS);
  const pick = (f: 'BETTER' | 'SAME' | 'WORSE') => {
    if (inFlight.current) return;
    inFlight.current = true;
    send.mutate(f, { onSettled: () => { inFlight.current = false; }, onSuccess: (r) => {
      if ((r as KaizenTaskWrite | null)?.textSkipped) setSkipped(true);
      if (f === 'WORSE') setWorse(true); else onClose();
    } });
  };
  if (worse) {
    return (
      <Card tone="lavender" style={{ gap: 8 }} accessibilityLabel={t('kzFeltWorseNudge')}>
        <AppText size={14}>{t('kzFeltWorseNudge')}</AppText>
        {showSupport ? <SupportOptions /> : <Button title={t('kzFeltWorseShow')} variant="secondary" onPress={() => setShowSupport(true)} />}
        <Button title={t('kzFeltWorseDismiss')} variant="ghost" onPress={onClose} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 8 }}>
      <AppText weight="700">{t('kzFeltTitle')}</AppText>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        <Chip label={t('kzFeltBetter')} disabled={send.isPending} onPress={() => pick('BETTER')} />
        <Chip label={t('kzFeltSame')} disabled={send.isPending} onPress={() => pick('SAME')} />
        <Chip label={t('kzFeltWorse')} disabled={send.isPending} onPress={() => pick('WORSE')} />
      </Row>
      {send.isError ? <AppText size={12} muted accessibilityLiveRegion="polite">{t('kzFeltSaveErr')}</AppText> : null}
      {skipped ? <AppText size={12} muted accessibilityLiveRegion="polite">{t('kzTextSkipped')}</AppText> : null}
      <Button title={t('kzFeltSkip')} variant="ghost" onPress={onClose} />
    </Card>
  );
}
