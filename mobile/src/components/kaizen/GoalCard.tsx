/**
 * GoalCard — Feature B: the user's own goal with its AI-split numbered tasks and score.
 * One-tap update (Done / Partly / Not today), an optional note (with a speak-instead mic when the
 * device has a recogniser), a habit anchor, a gentle momentum pill, a two-tone progress breakdown,
 * an optional daily nudge, and — once finished — the whole journey on one screen.
 * Rewriting / letting go are tucked at the end. This component never touches therapy session data.
 */
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Share, View } from 'react-native';
import { api } from '../../api/client';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation } from '../../api/hooks';
import type { GoalUpdateResult, UserGoal } from '../../api/types';
import { AppText, Button, Card, Chip, Field, Icon, Row } from '../ui';
import { useT } from '../../i18n';
import { space, radius, useTheme } from '../../theme';
import { successHaptic } from '../../motion/haptics';
import { recognition } from '../../utils/speech';

const MOMENTS = { RISING: '🔥', STEADY: '🌊', RESTING: '🍃' } as const;
const MOMENT_KEYS = { RISING: 'kzMomRising', STEADY: 'kzMomSteady', RESTING: 'kzMomResting' } as const;
type Difficulty = 'EASY' | 'OK' | 'HARD';

export function GoalCard({ goal }: { goal: UserGoal }) {
  const t = useT();
  const { c } = useTheme();
  const [journey, setJourney] = useState(false);
  const moment = goal.momentum && goal.momentum in MOMENTS ? goal.momentum : null;

  if (goal.status === 'COMPLETED') {
    return (
      <Card style={{ gap: 8 }} accessibilityLabel={t('kzGoalA11y', { title: goal.title, n: goal.score })}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText size={17} weight="800" style={{ flex: 1 }}>{goal.title}</AppText>
          {moment ? <MomentumPill momentum={moment} /> : null}
        </Row>
        <AppText style={{ color: c.success }} weight="700">✓ {t('kzGoalDoneMsg')}</AppText>
        <Button title={t('kzJourneyBtn')} variant="secondary" icon="footsteps-outline" onPress={() => setJourney(true)} accessibilityLabel={t('kzJourneyBtn')} />
        <JourneyModal goal={goal} visible={journey} onClose={() => setJourney(false)} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }} accessibilityLabel={t('kzGoalA11y', { title: goal.title, n: goal.score })}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText size={17} weight="800" style={{ flex: 1 }}>{goal.title}</AppText>
        {moment ? <MomentumPill momentum={moment} /> : null}
      </Row>

      <GoalScoreBar goal={goal} />

      {/* the numbered small tasks; the current one is highlighted, with the AI's "why" under it */}
      <View style={{ gap: 6 }}>
        {goal.tasks.map((task, i) => (
          <Row key={task.id} style={{ gap: 8, alignItems: 'flex-start' }}>
            <View style={{ width: 26, alignItems: 'center', paddingVertical: 2, borderRadius: radius.pill, backgroundColor: task.done ? c.success : task.state === 'CURRENT' ? c.primary : c.border }}>
              <AppText size={11} weight="800" style={{ color: task.done || task.state === 'CURRENT' ? '#fff' : c.textMuted }}>{i + 1}</AppText>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText style={{ textDecorationLine: task.done ? 'line-through' : 'none' }} muted={task.done} weight={task.state === 'CURRENT' ? '700' : '400'}>
                {task.title} {task.state === 'CURRENT' ? `· ${t('kzGoalStepCurrent')}` : ''}{task.done ? ` · ${t('kzGoalStepDone')}` : ''}
              </AppText>
              {task.why && !task.done ? <AppText size={12} muted>{task.why}</AppText> : null}
            </View>
          </Row>
        ))}
      </View>

      {goal.status === 'ACTIVE' ? <GoalAnchor goal={goal} /> : null}
      {goal.status === 'ACTIVE' ? <GoalUpdateBox goalId={goal.id} /> : null}
      {goal.status === 'ACTIVE' ? <GoalReminder goalId={goal.id} current={goal.reminderMin} /> : null}

      {goal.status === 'ACTIVE' ? (
        <Row style={{ gap: 12, justifyContent: 'flex-end' }}>
          <GoalEdit goalId={goal.id} current={goal.title} />
          <GoalAbandon goalId={goal.id} />
        </Row>
      ) : null}
    </Card>
  );
}

function MomentumPill({ momentum }: { momentum: keyof typeof MOMENTS }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <View accessibilityLabel={t(MOMENT_KEYS[momentum])} style={{ backgroundColor: c.lavender, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      <AppText size={12} weight="700">{MOMENTS[momentum]} {t(MOMENT_KEYS[momentum])}</AppText>
    </View>
  );
}

/** The progress bar: the steps-done part in the primary tone, the steadiness part in the accent tone. */
function GoalScoreBar({ goal }: { goal: UserGoal }) {
  const t = useT();
  const { c } = useTheme();
  const total = goal.tasks.length;
  const done = goal.tasks.filter((x) => x.done).length;
  const donePart = Math.max(0, Math.min(100, goal.breakdown?.donePart ?? goal.score));
  const streakPart = Math.max(0, Math.min(100 - donePart, goal.breakdown?.streakPart ?? 0));
  const line = t('kzGoalScoreBreakdown', { n: goal.score, done, total, m: goal.breakdown?.streakPart ?? 0 });
  return (
    <View style={{ gap: 6 }}>
      <View accessibilityRole="progressbar" accessibilityLabel={line} style={{ height: 8, borderRadius: 4, backgroundColor: c.cardAlt, overflow: 'hidden', flexDirection: 'row' }}>
        <View style={{ width: `${donePart}%` as const, backgroundColor: c.primary }} />
        <View style={{ width: `${streakPart}%` as const, backgroundColor: c.accent }} />
      </View>
      <AppText size={12} muted>{line}</AppText>
    </View>
  );
}

/** The habit anchor: a small line on the current step; tapping it (or the ghost chip) opens the inline editor. */
function GoalAnchor({ goal }: { goal: UserGoal }) {
  const t = useT();
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [retry, setRetry] = useState(false);
  const save = useInvalidatingMutation(
    (v: { anchor: string }) => api(`/kaizen/goal/${goal.id}/anchor`, { method: 'POST', body: v }),
    NIVORA_KEYS,
  );
  if (open) {
    return (
      <View style={{ gap: 8 }}>
        <Field label={t('kzGoalAnchorLabel')} value={text} onChangeText={(v) => { setText(v); setRetry(false); }} placeholder={goal.anchor ?? ''} maxLength={200} />
        <Button
          title={t('kzGoalAnchorSave')} disabled={!text.trim() || save.isPending} loading={save.isPending}
          onPress={() => save.mutate({ anchor: text.trim() }, { onSuccess: (r) => {
            if ((r as { saved?: boolean } | null)?.saved === false) { setRetry(true); return; } // safety check unavailable: nothing stored, keep the editor and text
            setRetry(false); setOpen(false);
          } })}
          accessibilityLabel={t('kzGoalAnchorSave')}
        />
        {retry ? <AppText size={13} muted accessibilityLiveRegion="polite">{t('kzSafetyRetry')}</AppText> : null}
        {save.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(save.error))}</AppText> : null}
      </View>
    );
  }
  if (goal.anchor) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('kzGoalAnchorLabel')} ${goal.anchor}`} onPress={() => setOpen(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Row style={{ gap: 6 }}>
          <Icon name="link-outline" size={14} color={c.accent} />
          <AppText size={13} muted style={{ flex: 1 }}>{t('kzGoalAnchorLabel')} {goal.anchor}</AppText>
        </Row>
      </Pressable>
    );
  }
  return <Chip label={t('kzGoalAnchorAdd')} onPress={() => setOpen(true)} />;
}

function GoalUpdateBox({ goalId }: { goalId: string }) {
  const t = useT();
  const { c } = useTheme();
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [milestone, setMilestone] = useState<string | null>(null);
  const [askDiff, setAskDiff] = useState(false);
  const [textSkipped, setTextSkipped] = useState(false);
  const update = useInvalidatingMutation(
    (v: { note?: string; doneCurrent?: boolean; difficulty?: Difficulty }) => api<GoalUpdateResult>(`/kaizen/goal/${goalId}/update`, { method: 'POST', body: v }),
    NIVORA_KEYS,
  );
  const send = (doneCurrent: boolean, autoNote?: string, difficulty?: Difficulty) => {
    const finalNote = note.trim() || autoNote;
    update.mutate(
      { ...(difficulty ? { difficulty } : { doneCurrent }), ...(finalNote ? { note: finalNote } : {}) },
      {
        onSuccess: (r) => {
          setNote(''); setNoteOpen(false);
          setTextSkipped(!!r?.textSkipped);
          setLine(r?.line ?? null); setMilestone(r?.milestone ?? null);
          if (difficulty) setAskDiff(false);
          else if (doneCurrent) { setAskDiff(true); successHaptic(); }
        },
      },
    );
  };
  // The mic exists only when the phone has an on-device recogniser; otherwise the button simply never appears.
  const Voice = recognition()
    ? (require('./GoalVoiceMic').GoalVoiceMic as React.ComponentType<{ onText: (text: string) => void }>)
    : null;
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ gap: 8 }}>
        <Button title={t('kzUpDone')} icon="checkmark" style={{ flex: 1 }} loading={update.isPending} onPress={() => send(true)} accessibilityLabel={t('kzUpDone')} />
        <Button title={t('kzUpPartly')} variant="secondary" style={{ flex: 1 }} onPress={() => send(false, 'partly')} accessibilityLabel={t('kzUpPartly')} />
        <Button title={t('kzUpNotToday')} variant="secondary" style={{ flex: 1 }} onPress={() => send(false, 'not today')} accessibilityLabel={t('kzUpNotToday')} />
      </Row>
      {askDiff ? (
        <View style={{ gap: 6 }}>
          <AppText size={13} muted>{t('kzDiffAsk')}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label={t('kzDiffEasy')} onPress={() => send(true, undefined, 'EASY')} />
            <Chip label={t('kzDiffOk')} onPress={() => send(true, undefined, 'OK')} />
            <Chip label={t('kzDiffHard')} onPress={() => send(true, undefined, 'HARD')} />
          </Row>
        </View>
      ) : null}
      <Row style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Chip label={t('kzUpAddNote')} selected={noteOpen} onPress={() => setNoteOpen((o) => !o)} />
        {Voice ? <Voice onText={(tx) => { setNote((cur) => (cur ? `${cur.trimEnd()} ${tx}` : tx)); setNoteOpen(true); }} /> : null}
      </Row>
      {noteOpen ? <Field label={t('kzUpNoteLabel')} value={note} onChangeText={setNote} maxLength={1000} multiline /> : null}
      {line ? <AppText size={13} muted>{line}</AppText> : null}
      {textSkipped ? <AppText size={12} muted accessibilityLiveRegion="polite">{t('kzTextSkipped')}</AppText> : null}
      {milestone ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('kzMilestoneTitle')} onPress={() => setMilestone(null)}>
          <Card tone="lavender" style={{ gap: 4 }}>
            <AppText size={13} weight="800" style={{ color: c.accent }}>{t('kzMilestoneTitle')}</AppText>
            <AppText size={14}>{milestone}</AppText>
          </Card>
        </Pressable>
      ) : null}
      {update.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(update.error))}</AppText> : null}
    </View>
  );
}

/** A quiet daily nudge: pick a time or turn it off (never a demand, just a gentle ping). */
function GoalReminder({ goalId, current }: { goalId: string; current: number | null | undefined }) {
  const t = useT();
  const { c } = useTheme();
  const set = useInvalidatingMutation(
    (v: { reminderMin: number | null }) => api(`/kaizen/goal/${goalId}/reminder`, { method: 'POST', body: v }),
    NIVORA_KEYS,
  );
  const options: { label: string; min: number | null }[] = [
    { label: '08:00', min: 480 }, { label: '13:00', min: 780 }, { label: '19:00', min: 1140 }, { label: '21:00', min: 1260 }, { label: t('kzReminderOff'), min: null },
  ];
  const cur = current ?? null;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ gap: 6 }}>
        <Icon name="bell-outline" size={14} color={c.textMuted} />
        <AppText size={13} muted>{t('kzGoalReminder')}</AppText>
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        {options.map((o) => <Chip key={o.label} label={o.label} selected={cur === o.min} onPress={() => set.mutate({ reminderMin: o.min })} />)}
      </Row>
      {set.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(set.error))}</AppText> : null}
    </View>
  );
}

const daysBetween = (from: string, to: string | null) => Math.max(1, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 86_400_000));

/** The finished goal's whole story, shown in a gentle bottom sheet. */
function JourneyModal({ goal, visible, onClose }: { goal: UserGoal; visible: boolean; onClose: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const q = useQuery({
    queryKey: ['kaizen', 'goal-card', goal.id],
    enabled: visible,
    queryFn: () => api<{ title: string; tasks: { title: string; done: boolean }[]; startedAt: string; completedAt: string | null; days: number; score: number }>(`/kaizen/goal/${goal.id}/card`),
  });
  const card = q.data;
  const tasks = card?.tasks ?? goal.tasks.map((x) => ({ title: x.title, done: x.done }));
  const title = card?.title ?? goal.title;
  const score = card?.score ?? goal.score;
  const days = card?.days ?? daysBetween(goal.createdAt, goal.completedAt);
  const share = () => {
    const lines = [title, `${score}% · ${t('kzJourneyDays', { n: days })}`, ...tasks.map((x) => `${x.done ? '✓' : '○'} ${x.title}`)];
    void Share.share({ message: lines.join('\n') });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('kzJourneyClose')} style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, maxHeight: '88%', gap: space.sm, borderWidth: 1, borderColor: c.border }} onPress={() => {}}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            <AppText size={20} weight="800" accessibilityRole="header">{title}</AppText>
            <Row style={{ gap: 12 }}>
              <AppText size={14} weight="800" style={{ color: c.primary }}>{score}%</AppText>
              <AppText size={14} muted>{t('kzJourneyDays', { n: days })}</AppText>
            </Row>
            <View style={{ gap: 6 }}>
              {tasks.map((x, i) => (
                <Row key={i} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Icon name={x.done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={x.done ? c.success : c.textMuted} />
                  <AppText size={14} muted={!x.done} style={{ flex: 1, textDecorationLine: x.done ? 'line-through' : 'none' }}>{x.title}</AppText>
                </Row>
              ))}
            </View>
          </ScrollView>
          <Button title={t('kzJourneyShare')} variant="secondary" onPress={share} accessibilityLabel={t('kzJourneyShare')} />
          <Button title={t('kzJourneyClose')} variant="ghost" onPress={onClose} accessibilityLabel={t('kzJourneyClose')} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Rewriting the goal: the AI re-splits the remaining steps; completed ones and the score stay. */
function GoalEdit({ goalId, current }: { goalId: string; current: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const { c } = useTheme();
  const edit = useInvalidatingMutation((v: { title: string }) => api(`/kaizen/goal/${goalId}/edit`, { method: 'POST', body: v }), NIVORA_KEYS);
  if (!open) {
    return <Button title={t('kzGoalEdit')} variant="ghost" onPress={() => setOpen(true)} accessibilityLabel={t('kzGoalEdit')} />;
  }
  return (
    <View style={{ flex: 1, gap: 8 }}>
      <Field label={t('kzGoalTitleLabel')} value={title} onChangeText={setTitle} placeholder={current} maxLength={120} />
      <Button
        title={t('kzGoalSplitBtn')}
        disabled={!title.trim() || edit.isPending}
        loading={edit.isPending}
        onPress={() => edit.mutate({ title: title.trim() }, { onSuccess: () => setOpen(false) })}
        accessibilityLabel={t('kzGoalSplitBtn')}
      />
      {edit.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(edit.error))}</AppText> : null}
    </View>
  );
}

function GoalAbandon({ goalId }: { goalId: string }) {
  const t = useT();
  const abandon = useInvalidatingMutation(() => api(`/kaizen/goal/${goalId}/abandon`, { method: 'POST' }), NIVORA_KEYS);
  return <Button title={t('kzGoalAbandon')} variant="ghost" onPress={() => abandon.mutate(undefined)} accessibilityLabel={t('kzGoalAbandon')} />;
}
