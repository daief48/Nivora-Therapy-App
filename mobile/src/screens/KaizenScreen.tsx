import { useQuery } from '@tanstack/react-query';
import { useGuideFeature, useGuideRiskSignal } from '../guide';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { AppText, Button, Card, Chip, Field, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useTheme } from '../theme';
import { TaskCard } from '../components/kaizen/TaskCard';
import { GoalCard } from '../components/kaizen/GoalCard';
import { api } from '../api/client';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation, useUserGoals } from '../api/hooks';
import type { GoalTemplate } from '../api/types';
import { noteCrisis } from '../api/crisisShape';
import type { CrisisPayload } from '../api/practice';
import { needsClarification, needsConfirmation, type GoalBody, type GoalClarify, type GoalConfirm } from '../api/goalFlow';
import { CapabilitiesCard } from '../components/CapabilitiesCard';
import { CrisisNotice } from '../components/CrisisNotice';
import { recognition } from '../utils/speech';

/**
 * Kaizen — one simple screen with two fully separate blocks:
 *  - "Your task" (Feature A): the single small task a therapy session may have suggested.
 *  - "Your goal" (Feature B): the user's own goals — as many as they like, each split by the AI
 *    into small tasks, with a progress score. This block never touches therapy session data.
 */
export function KaizenScreen() {
  useGuideFeature('kaizen');
  const t = useT();
  const { c } = useTheme();
  useGuideRiskSignal('kaizen', false);

  return (
    <Screen>
      <CapabilitiesCard section="KAIZEN" />
      {/* ── Feature A: the one therapy-given task ── */}
      <SectionTitle>{t('kzTaskSection')}</SectionTitle>
      <TaskCard />

      {/* ── Feature B: the user's own goals (never session data) ── */}
      <UserGoalsBlock />

      <AppText size={12} muted style={{ textAlign: 'center', color: c.textMuted }}>{t('kzArchivedNotice')}</AppText>
    </Screen>
  );
}

function UserGoalsBlock() {
  const t = useT();
  const goals = useUserGoals();
  if (goals.isLoading) return null;
  return (
    <View style={{ gap: 8 }}>
      <SectionTitle>{t('kzGoalSection')}</SectionTitle>
      <GoalStart />
      {(goals.data ?? []).map((goal) => <GoalCard key={goal.id} goal={goal} />)}
      {goals.data && goals.data.length > 0 ? null : <AppText size={13} muted>{t('kzGoalStartBody')}</AppText>}
    </View>
  );
}

/** The always-available field for adding another goal; the AI splits it into small steps. */
function GoalStart() {
  const t = useT();
  const { c } = useTheme();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [stage, setStage] = useState<{ kind: 'edit' } | ({ kind: 'clarify'; answers: string[] } & GoalClarify) | ({ kind: 'confirm' } & GoalConfirm)>({ kind: 'edit' });
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const create = useInvalidatingMutation(
    (v: GoalBody) => api<unknown>('/kaizen/goal', { method: 'POST', body: v }),
    NIVORA_KEYS,
  );
  const base = (): GoalBody => ({ title: title.trim(), ...(minutes ? { timePerDayMin: minutes } : {}), guided: true });
  const submit = (body: GoalBody) => create.mutate(body, {
    onSuccess: (r) => {
      const cr = noteCrisis(r);
      if (cr) { setCrisis(cr); setStage({ kind: 'edit' }); return; }
      setCrisis(null);
      if (needsClarification(r)) setStage({ kind: 'clarify', ...r, answers: r.questions.map(() => '') });
      else if (needsConfirmation(r)) setStage({ kind: 'confirm', ...r });
      else { setTitle(''); setMinutes(null); setStage({ kind: 'edit' }); }
    },
  });
  const Voice = recognition()
    ? (require('../components/kaizen/GoalVoiceMic').GoalVoiceMic as React.ComponentType<{ onText: (text: string) => void }>)
    : null;
  const setAnswer = (i: number, v: string) => setStage((st) => (st.kind === 'clarify' ? { ...st, answers: st.answers.map((x, j) => (j === i ? v : x)) } : st));
  if (stage.kind === 'clarify') {
    const st = stage;
    const max = Math.max(1, Math.min(st.maxAnswers || 2, st.questions.length));
    const filled = st.answers.map((x) => x.trim()).filter(Boolean).slice(0, max);
    return (
      <Card style={{ gap: 10 }}>
        {st.intro ? <AppText size={15}>{st.intro}</AppText> : null}
        {st.questions.slice(0, max).map((qn, i) => (
          <View key={i} style={{ gap: 4 }}>
            <AppText size={14} weight="700">{qn}</AppText>
            <Field value={st.answers[i] ?? ''} onChangeText={(v) => setAnswer(i, v)} placeholder={t('kzClarifyAnswer', { n: i + 1 })} maxLength={200} accessibilityLabel={qn} />
            {Voice ? <Voice onText={(tx) => setAnswer(i, st.answers[i] ? `${st.answers[i]!.trimEnd()} ${tx}` : tx)} /> : null}
          </View>
        ))}
        <Button title={create.isPending ? t('kzGoalSplitting') : t('kzClarifyContinue')} disabled={create.isPending} loading={create.isPending}
          onPress={() => submit({ ...base(), ...(filled.length ? { answers: filled } : {}) })} />
        {create.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(create.error))}</AppText> : null}
      </Card>
    );
  }
  if (stage.kind === 'confirm') {
    const st = stage;
    return (
      <Card style={{ gap: 10 }}>
        <AppText size={15}>{st.understood}</AppText>
        <Button title={st.actions?.confirm || t('kzConfirmYes')} icon="checkmark" disabled={create.isPending} loading={create.isPending}
          onPress={() => submit({ ...base(), ...(st.answers?.length ? { answers: st.answers } : {}), confirm: true })} />
        <Button title={st.actions?.notQuite || t('kzNotQuite')} variant="secondary" disabled={create.isPending} onPress={() => setStage({ kind: 'edit' })} />
        {create.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(create.error))}</AppText> : null}
      </Card>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <AppText size={17} weight="800">{t('kzGoalStartTitle')}</AppText>
      <Field
        label={t('kzGoalTitleLabel')}
        value={title}
        onChangeText={setTitle}
        placeholder={t('kzGoalTitlePlaceholder')}
        maxLength={120}
      />
      <View style={{ gap: 6 }}>
        <AppText size={13} muted>{t('kzGoalTimeLabel')}</AppText>
        <Row style={{ flexWrap: 'wrap' }}>
          {[5, 10, 15, 20, 30].map((n) => (
            <Chip key={n} label={t('kzGoalTimeChip', { n })} selected={minutes === n} onPress={() => setMinutes((cur) => (cur === n ? null : n))} />
          ))}
        </Row>
      </View>
      <Button
        title={create.isPending ? t('kzGoalSplitting') : t('kzGoalSplitBtn')}
        icon="leaf-outline"
        disabled={!title.trim() || create.isPending}
        loading={create.isPending}
        onPress={() => submit(base())}
      />
      <GoalTemplateRow />
      {crisis ? <CrisisNotice crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}
      {create.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(create.error))}</AppText> : null}
      <AppText size={12} muted>{t('kzGoalStartHint')}</AppText>
    </Card>
  );
}

/** A horizontally scrollable row of gentle pre-made goals; tapping one starts the goal from that template. */
function GoalTemplateRow() {
  const t = useT();
  const { c } = useTheme();
  const q = useQuery({ queryKey: ['kaizen', 'goal-templates'], queryFn: () => api<GoalTemplate[]>('/kaizen/goal/templates') });
  const fromTemplate = useInvalidatingMutation(
    (templateId: string) => api('/kaizen/goal/from-template', { method: 'POST', body: { templateId } }),
    NIVORA_KEYS,
  );
  const templates = q.data;
  if (!templates?.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <AppText size={13} muted>{t('kzGoalTemplates')}</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {templates.map((tpl) => <Chip key={tpl.id} label={tpl.title} onPress={() => fromTemplate.mutate(tpl.id)} />)}
      </ScrollView>
      {fromTemplate.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(fromTemplate.error))}</AppText> : null}
    </View>
  );
}
