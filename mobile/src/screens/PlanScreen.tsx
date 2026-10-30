import React, { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useMe } from '../api/hooks';
import { savePlan, useTherapyMutation, useTherapyPlan, type PlanGoal, type TherapyPlan } from '../api/sessions';
import { AppText, Button, Card, Chip, Field, Hero, Icon, QueryBoundary, Row, Screen, Segmented, SectionTitle } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { useTheme } from '../theme';

const APPROACHES: { value: TherapyPlan['approach']; label: StringKey }[] = [
  { value: 'MIXED', label: 'sessPlanMixed' }, { value: 'CBT', label: 'sessPlanCbt' }, { value: 'MI', label: 'sessPlanMi' }, { value: 'ACT', label: 'sessPlanAct' },
];

/** View and edit the personal plan. Saving creates a new version; the plan only shapes how sessions go. */
export function PlanScreen() {
  const t = useT();
  const { c } = useTheme();
  const q = useTherapyPlan();
  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('sessPlanTitle')}</AppText>
        <AppText size={14} style={{ color: c.onHeroMuted }}>{t('sessPlanNote')}</AppText>
      </Hero>
      <QueryBoundary q={q}>{(d) => <PlanForm plan={d.plan} version={d.version} />}</QueryBoundary>
    </Screen>
  );
}

function PlanForm({ plan, version }: { plan: TherapyPlan | null; version: number }) {
  const t = useT();
  const { c } = useTheme();
  const me = useMe();
  const [draft, setDraft] = useState<TherapyPlan>(() => plan ?? { goals: [], focusAreas: [], approach: 'MIXED', pace: 'GENTLE', tone: 'WARM', language: me.data?.locale ?? 'en' });
  const [focusInput, setFocusInput] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  // A newer version from the server (after saving) replaces the draft.
  useEffect(() => { if (plan) { setDraft(plan); setDirty(false); } }, [plan, version]);

  const patch = (p: Partial<TherapyPlan>) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); setSaved(false); };
  const setGoal = (id: string, title: string) => patch({ goals: draft.goals.map((g) => (g.id === id ? { ...g, title } : g)) });
  const addGoal = () => patch({ goals: [...draft.goals, { id: `new-${Date.now()}-${draft.goals.length}`, title: '' } as PlanGoal] });
  const addFocus = () => { const x = focusInput.trim(); if (x && !draft.focusAreas.includes(x)) patch({ focusAreas: [...draft.focusAreas, x] }); setFocusInput(''); };

  const save = useTherapyMutation(async () => {
    await savePlan({ ...draft, goals: draft.goals.filter((g) => g.title.trim()).map((g) => ({ ...g, title: g.title.trim() })) });
  });
  const submit = () => save.mutate(undefined, { onSuccess: () => { setSaved(true); setDirty(false); }, onError: () => Alert.alert(t('sessPlanSaveError')) });

  return (
    <>
      <AppText size={13} muted>{plan ? t('sessPlanVersion', { n: version }) : t('sessPlanNone')}</AppText>

      <SectionTitle>{t('sessPlanGoals')}</SectionTitle>
      <Card>
        {draft.goals.map((g, i) => (
          <Row key={g.id}>
            <View style={{ flex: 1 }}>
              <Field value={g.title} onChangeText={(x) => setGoal(g.id, x)} placeholder={t('sessPlanGoalPh')} accessibilityLabel={`${t('sessPlanGoalPh')} ${i + 1}`} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('sessPlanRemoveGoal')} onPress={() => patch({ goals: draft.goals.filter((x) => x.id !== g.id) })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={20} color={c.textMuted} />
            </Pressable>
          </Row>
        ))}
        <Button title={t('sessPlanAddGoal')} icon="add" variant="secondary" onPress={addGoal} />
      </Card>

      <SectionTitle>{t('sessPlanFocus')}</SectionTitle>
      <Card>
        <Row style={{ flexWrap: 'wrap' }}>
          {draft.focusAreas.map((x) => (
            <Pressable key={x} accessibilityRole="button" accessibilityLabel={t('sessPlanRemoveFocus', { x })} onPress={() => patch({ focusAreas: draft.focusAreas.filter((y) => y !== x) })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 44, borderRadius: 999, backgroundColor: c.lavender }}>
              <AppText size={14} weight="600">{x}</AppText><Icon name="close" size={14} color={c.textMuted} />
            </Pressable>
          ))}
        </Row>
        <Row>
          <View style={{ flex: 1 }}><Field value={focusInput} onChangeText={setFocusInput} placeholder={t('sessPlanFocusPh')} accessibilityLabel={t('sessPlanFocus')} onSubmitEditing={addFocus} /></View>
          <Button title={t('sessPlanAddFocus')} variant="secondary" onPress={addFocus} disabled={!focusInput.trim()} />
        </Row>
      </Card>

      <SectionTitle>{t('sessPlanApproach')}</SectionTitle>
      <Row style={{ flexWrap: 'wrap' }}>
        {APPROACHES.map((a) => <Chip key={a.value} label={t(a.label)} selected={draft.approach === a.value} onPress={() => patch({ approach: a.value })} />)}
      </Row>

      <SectionTitle>{t('sessPlanPace')}</SectionTitle>
      <Segmented value={draft.pace} onChange={(v) => patch({ pace: v })} options={[{ value: 'GENTLE', label: t('sessPlanGentle') }, { value: 'STEADY', label: t('sessPlanSteady') }]} />
      <SectionTitle>{t('sessPlanTone')}</SectionTitle>
      <Segmented value={draft.tone} onChange={(v) => patch({ tone: v })} options={[{ value: 'WARM', label: t('sessPlanWarm') }, { value: 'DIRECT', label: t('sessPlanDirect') }]} />

      <Field label={t('sessPlanBackground')} value={draft.background ?? ''} onChangeText={(x) => patch({ background: x })} multiline />
      <Field label={t('sessPlanHelps')} value={draft.whatHelps ?? ''} onChangeText={(x) => patch({ whatHelps: x })} multiline />
      <Field label={t('sessPlanDoesnt')} value={draft.whatDoesnt ?? ''} onChangeText={(x) => patch({ whatDoesnt: x })} multiline />

      {saved ? <AppText accessibilityLiveRegion="polite" style={{ color: c.success }}>{t('sessPlanSaved')}</AppText> : null}
      <Button title={t('sessPlanSave')} onPress={submit} loading={save.isPending} disabled={!dirty} />
      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
    </>
  );
}
