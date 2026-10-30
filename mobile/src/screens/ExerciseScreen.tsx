import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation } from '../api/hooks';
import { AppText, Button, Card, Chip, Field, IconCircle, ProgressBar, Row, Screen, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { ExerciseKind, Nav, RootParams } from '../navigation/types';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';

interface FormDef { entryType: string; fields: { key: string; label: StringKey; numeric?: boolean }[] }
const FORMS: Partial<Record<ExerciseKind, FormDef>> = {
  thought: { entryType: 'THOUGHT_RECORD', fields: [{ key: 'situation', label: 'tSituation' }, { key: 'thought', label: 'tThought' }, { key: 'emotion', label: 'tEmotion' }, { key: 'behavior', label: 'tBehavior' }] },
  balanced: { entryType: 'THOUGHT_RECORD', fields: [{ key: 'thought', label: 'tThought' }, { key: 'for', label: 'tEvidenceFor' }, { key: 'against', label: 'tEvidenceAgainst' }, { key: 'balanced', label: 'tBalanced' }, { key: 'feel', label: 'tFeelNow', numeric: true }] },
  next: { entryType: 'THOUGHT_RECORD', fields: [{ key: 'worry', label: 'tSituation' }, { key: 'step', label: 'tNextStep' }] },
  gratitude: { entryType: 'GRATITUDE', fields: [{ key: 'g', label: 'gratPrompt' }] },
  daily: { entryType: 'DAILY_REFLECTION', fields: [{ key: 'p1', label: 'dailyP1' }, { key: 'p2', label: 'dailyP2' }, { key: 'p3', label: 'dailyP3' }, { key: 'p4', label: 'dailyP4' }] },
  sleep: { entryType: 'SLEEP_STRESS', fields: [{ key: 'h', label: 'sleepHours', numeric: true }, { key: 'q', label: 'sleepQuality', numeric: true }, { key: 's', label: 'stressToday', numeric: true }, { key: 'n', label: 'sleepNotes' }] },
};
const META: Record<ExerciseKind, { title: StringKey; desc: StringKey; icon: IconName }> = {
  thought: { title: 'actThought', desc: 'actThoughtDesc', icon: 'bulb-outline' }, balanced: { title: 'actBalanced', desc: 'actBalancedDesc', icon: 'scale-outline' },
  grounding: { title: 'actGrounding', desc: 'actGroundingDesc', icon: 'hand-left-outline' }, breathing: { title: 'actBreathing', desc: 'engLibDesc', icon: 'leaf-outline' },
  gratitude: { title: 'actGratitude', desc: 'actGratitudeDesc', icon: 'heart-outline' }, daily: { title: 'actDaily', desc: 'actDailyDesc', icon: 'document-text-outline' },
  sleep: { title: 'actSleep', desc: 'actSleepDesc', icon: 'moon-outline' }, goal: { title: 'actGoal', desc: 'actGoalDesc', icon: 'flag-outline' }, next: { title: 'actNext', desc: 'actNextDesc', icon: 'footsteps-outline' },
};

export function ExerciseScreen() {
  const t = useT();
  const { kind } = useRoute<RouteProp<RootParams, 'Exercise'>>().params;
  const m = META[kind];
  return (
    <Screen>
      <Row style={{ gap: 14 }}>
        <IconCircle icon={m.icon} tone={0} size={56} />
        <View style={{ flex: 1 }}>
          <AppText size={24} weight="800" accessibilityRole="header">{t(m.title)}</AppText>
          <AppText muted size={14}>{t(m.desc)}</AppText>
        </View>
      </Row>
      <Card tone="lavender"><AppText size={13}>{t('exerciseDisclaimer')}</AppText></Card>
      {kind === 'breathing' ? <Library /> : kind === 'grounding' ? <Grounding /> : kind === 'goal' ? <GoalForm /> : <StepForm kind={kind} />}
    </Screen>
  );
}

function Done({ onAgain }: { onAgain?: () => void }) {
  const t = useT();
  const nav = useNavigation<Nav>();
  return (
    <Card>
      <IconCircle icon="checkmark" tone={0} size={56} />
      <AppText size={18} weight="800" accessibilityLiveRegion="polite">{t('activityDone')}</AppText>
      <Row style={{ flexWrap: 'wrap' }}>
        {onAgain ? <Button title={t('breathStart')} variant="secondary" onPress={onAgain} /> : null}
        <Button title={t('allActivities')} variant="ghost" onPress={() => nav.navigate('Wellness')} />
      </Row>
    </Card>
  );
}

/** One question per screen with a progress bar. Every step is skippable and you can leave at any time. */
function StepForm({ kind }: { kind: ExerciseKind }) {
  const t = useT();
  const def = FORMS[kind]!;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(false);
  const save = useInvalidatingMutation((content: string) => api('/journal', { method: 'POST', body: { content, entryType: def.entryType } }), [['journal']]);
  const total = def.fields.length;
  const f = def.fields[i]!;
  const last = i === total - 1;
  const filled = def.fields.some((x) => vals[x.key]?.trim());

  const finish = async () => {
    setErr(false);
    if (!filled) { setDone(true); return; }
    const content = def.fields.filter((x) => vals[x.key]?.trim()).map((x) => `${t(x.label)}\n${vals[x.key]!.trim()}`).join('\n\n');
    try { await save.mutateAsync(`[${t(META[kind].title)}]\n\n${content}`); setDone(true); } catch { setErr(true); }
  };

  if (done) return <><Done /><AppText size={13} muted>{filled ? t('savedToJournal') : ''}</AppText></>;
  return (
    <Card>
      <AppText size={13} weight="700" muted>{t('stepOf', { n: i + 1, total })}</AppText>
      <ProgressBar value={i + 1} max={total} label={t('stepOf', { n: i + 1, total })} />
      <Field label={`${t(f.label)} (${t('optional')})`} value={vals[f.key] ?? ''} onChangeText={(v) => setVals({ ...vals, [f.key]: v })}
        multiline={!f.numeric} keyboardType={f.numeric ? 'numeric' : 'default'} />
      {err ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{t('errorTitle')}</AppText> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title={t('back')} variant="ghost" disabled={i === 0} onPress={() => setI(i - 1)} style={{ flex: 1 }} />
        {last
          ? <Button title={filled ? t('saveToJournal') : t('finish')} onPress={finish} loading={save.isPending} style={{ flex: 2 }} />
          : <Button title={vals[f.key]?.trim() ? t('next') : t('skipStep')} onPress={() => setI(i + 1)} style={{ flex: 2 }} />}
      </Row>
    </Card>
  );
}

function GoalForm() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const [title, setTitle] = useState('');
  const [step, setStep] = useState('');
  const [err, setErr] = useState(false);
  const save = useInvalidatingMutation(async (v: { title: string; step: string }) => {
    const g = await api<{ id: string }>('/goals', { method: 'POST', body: { title: v.title } });
    if (v.step) await api(`/goals/${g.id}/check-ins`, { method: 'POST', body: { progressValue: 0, note: v.step } });
  }, [['goals']]);
  return (
    <Card>
      <Field label={t('goalTitleLabel')} value={title} onChangeText={setTitle} maxLength={200} />
      <Field label={`${t('goalNext')} (${t('optional')})`} value={step} onChangeText={setStep} multiline maxLength={1000} />
      <Button title={t('save')} disabled={!title.trim()} loading={save.isPending}
        onPress={async () => { setErr(false); try { await save.mutateAsync({ title: title.trim(), step: step.trim() }); nav.navigate('Goals'); } catch { setErr(true); } }} />
      {err ? <AppText accessibilityRole="alert" style={{ color: '#B3261E' }}>{t('errorTitle')}</AppText> : null}
    </Card>
  );
}

const SENSES: { label: StringKey; icon: IconName }[] = [
  { label: 'groundSee', icon: 'eye-outline' }, { label: 'groundFeel', icon: 'hand-left-outline' }, { label: 'groundHear', icon: 'ear-outline' },
  { label: 'groundSmell', icon: 'flower-outline' }, { label: 'groundTaste', icon: 'nutrition-outline' },
];
function Grounding() {
  const t = useT();
  const [i, setI] = useState(-1);
  if (i === -1) return <Card><AppText>{t('groundStart')}</AppText><Button title={t('breathStart')} onPress={() => setI(0)} /></Card>;
  if (i >= SENSES.length) return <><AppText size={18} weight="700">{t('groundFinish')}</AppText><Done onAgain={() => setI(0)} /></>;
  const s = SENSES[i]!;
  return (
    <Card>
      <AppText size={13} weight="700" muted>{t('stepOf', { n: i + 1, total: SENSES.length })}</AppText>
      <ProgressBar value={i + 1} max={SENSES.length} label={t('stepOf', { n: i + 1, total: SENSES.length })} />
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <IconCircle icon={s.icon} tone={(i % 4) as 0 | 1 | 2 | 3} size={80} />
        <AppText size={22} weight="800" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{t(s.label)}</AppText>
      </View>
      <Row>
        <Button title={t('back')} variant="ghost" disabled={i === 0} onPress={() => setI(i - 1)} style={{ flex: 1 }} />
        <Button title={t('next')} onPress={() => setI(i + 1)} style={{ flex: 2 }} />
      </Row>
      <Button title={t('close')} variant="ghost" onPress={() => setI(-1)} />
    </Card>
  );
}

type Phase = { k: StringKey; ms: number; to: number | null };
type Pattern = 'classic' | 'box' | 'p478' | 'coherent';
const PACES = { slow: [4000, 4000, 6000], medium: [4000, 2000, 4000], fast: [3000, 1000, 3000] } as const;
const IN = 'breathIn', HOLD = 'breathHold', OUT = 'breathOut';
function phasesFor(p: Pattern, pace: keyof typeof PACES): Phase[] {
  if (p === 'box') return [{ k: IN, ms: 4000, to: 1 }, { k: HOLD, ms: 4000, to: null }, { k: OUT, ms: 4000, to: 0.6 }, { k: 'engRest', ms: 4000, to: null }];
  if (p === 'p478') return [{ k: IN, ms: 4000, to: 1 }, { k: HOLD, ms: 7000, to: null }, { k: OUT, ms: 8000, to: 0.6 }];
  if (p === 'coherent') return [{ k: IN, ms: 5000, to: 1 }, { k: OUT, ms: 5000, to: 0.6 }];
  const [i, h, o] = PACES[pace];
  return [{ k: IN, ms: i, to: 1 }, { k: HOLD, ms: h, to: null }, { k: OUT, ms: o, to: 0.6 }];
}
const PATTERNS: { id: Pattern; label: StringKey }[] = [
  { id: 'classic', label: 'engPatClassic' }, { id: 'box', label: 'engPatBox' }, { id: 'p478', label: 'engPat478' }, { id: 'coherent', label: 'engPatCoherent' },
];

/** Breathing is the home of the small exercise library: patterns, muscle relaxation, mindful eating. */
function Library() {
  const t = useT();
  const [mode, setMode] = useState<'breath' | 'pmr' | 'meal'>('breath');
  return (
    <>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={t('engModeBreath')} selected={mode === 'breath'} onPress={() => setMode('breath')} />
        <Chip label={t('engModePmr')} selected={mode === 'pmr'} onPress={() => setMode('pmr')} />
        <Chip label={t('engModeMeal')} selected={mode === 'meal'} onPress={() => setMode('meal')} />
      </Row>
      {mode === 'breath' ? <Breathing /> : mode === 'pmr' ? <Pmr /> : <Meal />}
    </>
  );
}

function Breathing() {
  const t = useT();
  const { c } = useTheme();
  const reduced = useSettings((s) => s.reducedMotion);
  const [pattern, setPattern] = useState<Pattern>('classic');
  const [pace, setPace] = useState<keyof typeof PACES>('slow');
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  const [cycles, setCycles] = useState(0);
  const scale = useRef(new Animated.Value(0.6)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phases = phasesFor(pattern, pace);

  useEffect(() => {
    if (!running) { scale.stopAnimation(); scale.setValue(0.6); return; }
    let cancelled = false;
    const ps = phasesFor(pattern, pace);
    const step = (i: number) => {
      if (cancelled) return;
      const p = ps[i % ps.length]!;
      setIdx(i % ps.length);
      if (!reduced && p.to != null) Animated.timing(scale, { toValue: p.to, duration: p.ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }).start();
      timer.current = setTimeout(() => { if (i % ps.length === ps.length - 1) setCycles((n) => n + 1); step(i + 1); }, p.ms);
    };
    step(0);
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); scale.stopAnimation(); };
  }, [running, pattern, pace, reduced, scale]);

  const label = running ? t(phases[idx]?.k ?? IN) : t('breathStart');
  return (
    <Card>
      <View style={{ alignItems: 'center', paddingVertical: 28 }}>
        <Animated.View accessibilityLabel={label} style={{ width: 210, height: 210, borderRadius: 105, backgroundColor: c.primary, opacity: 0.85, transform: [{ scale }], alignItems: 'center', justifyContent: 'center' }}>
          <AppText size={20} weight="800" style={{ color: c.onPrimary }} accessibilityLiveRegion="polite">{label}</AppText>
        </Animated.View>
      </View>
      {cycles > 0 ? <AppText size={13} muted style={{ textAlign: 'center' }}>{cycles}</AppText> : null}
      <AppText weight="700" size={14}>{t('engPattern')}</AppText>
      <Row style={{ flexWrap: 'wrap' }}>
        {PATTERNS.map((p) => <Chip key={p.id} label={t(p.label)} selected={pattern === p.id} onPress={() => { setPattern(p.id); setCycles(0); }} />)}
      </Row>
      {pattern === 'classic' ? (
        <>
          <AppText weight="700" size={14}>{t('breathPace')}</AppText>
          <Row>
            {(['slow', 'medium', 'fast'] as const).map((p) => <Chip key={p} label={t(p === 'slow' ? 'breathSlow' : p === 'medium' ? 'breathMedium' : 'breathFast')} selected={pace === p} onPress={() => setPace(p)} />)}
          </Row>
        </>
      ) : <AppText size={13} muted>{t(pattern === 'box' ? 'engBoxNote' : pattern === 'p478' ? 'eng478Note' : 'engCohNote')}</AppText>}
      <Button title={running ? t('breathStop') : t('breathStart')} variant={running ? 'secondary' : 'primary'} icon={running ? 'stop' : 'play'} onPress={() => { if (running) setCycles(0); setRunning(!running); }} />
      <AppText size={13} muted>{t('breathNote')}</AppText>
    </Card>
  );
}

const PMR: { name: StringKey; how: StringKey; icon: IconName }[] = [
  { name: 'engPmr1', how: 'engPmr1h', icon: 'hand-left-outline' }, { name: 'engPmr2', how: 'engPmr2h', icon: 'flash-outline' },
  { name: 'engPmr3', how: 'engPmr3h', icon: 'body-outline' }, { name: 'engPmr4', how: 'engPmr4h', icon: 'happy-outline' },
  { name: 'engPmr5', how: 'engPmr5h', icon: 'heart-outline' }, { name: 'engPmr6', how: 'engPmr6h', icon: 'walk-outline' },
  { name: 'engPmr7', how: 'engPmr7h', icon: 'footsteps-outline' },
];
const TENSE_S = 5, RELEASE_S = 10;

/** Tense a body part gently for 5 s, then release for 10 s. Pause or move on whenever you like. */
function Pmr() {
  const t = useT();
  const [i, setI] = useState(-1);
  const [tense, setTense] = useState(true);
  const [left, setLeft] = useState(TENSE_S);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (i < 0 || i >= PMR.length || paused) return;
    const id = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [i, paused]);
  useEffect(() => {
    if (left > 0 || i < 0 || i >= PMR.length) return;
    if (tense) { setTense(false); setLeft(RELEASE_S); } else { setTense(true); setLeft(TENSE_S); setI(i + 1); }
  }, [left, tense, i]);
  const go = (n: number) => { setI(n); setTense(true); setLeft(TENSE_S); setPaused(false); };

  if (i === -1) return <Card><AppText>{t('engPmrIntro')}</AppText><Button title={t('breathStart')} onPress={() => go(0)} /></Card>;
  if (i >= PMR.length) return <><AppText size={18} weight="700">{t('engPmrEnd')}</AppText><Done onAgain={() => go(0)} /></>;
  const s = PMR[i]!;
  return (
    <Card>
      <AppText size={13} weight="700" muted>{t('stepOf', { n: i + 1, total: PMR.length })}</AppText>
      <ProgressBar value={i + 1} max={PMR.length} label={t('stepOf', { n: i + 1, total: PMR.length })} />
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 10 }}>
        <IconCircle icon={s.icon} tone={(i % 4) as 0 | 1 | 2 | 3} size={80} />
        <AppText size={22} weight="800" style={{ textAlign: 'center' }}>{t(s.name)}</AppText>
        <AppText style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{tense ? t(s.how) : t('engPmrRelease')}</AppText>
        <AppText size={34} weight="800" accessibilityLabel={`${left}`}>{left}</AppText>
      </View>
      <Row>
        <Button title={t('back')} variant="ghost" disabled={i === 0} onPress={() => go(i - 1)} style={{ flex: 1 }} />
        <Button title={paused ? t('engResume') : t('engPause')} variant="secondary" onPress={() => setPaused(!paused)} style={{ flex: 1 }} />
        <Button title={t('next')} onPress={() => go(i + 1)} style={{ flex: 1 }} />
      </Row>
      <Button title={t('close')} variant="ghost" onPress={() => setI(-1)} />
    </Card>
  );
}

const MEAL: StringKey[] = ['engMeal1', 'engMeal2', 'engMeal3', 'engMeal4', 'engMeal5', 'engMeal6'];
/** Step prompts for eating one bite or one meal with attention. No timer; go at your own pace. */
function Meal() {
  const t = useT();
  const [i, setI] = useState(-1);
  if (i === -1) return <Card><AppText>{t('engMealIntro')}</AppText><Button title={t('breathStart')} onPress={() => setI(0)} /></Card>;
  if (i >= MEAL.length) return <><AppText size={18} weight="700">{t('engMealEnd')}</AppText><Done onAgain={() => setI(0)} /></>;
  return (
    <Card>
      <AppText size={13} weight="700" muted>{t('stepOf', { n: i + 1, total: MEAL.length })}</AppText>
      <ProgressBar value={i + 1} max={MEAL.length} label={t('stepOf', { n: i + 1, total: MEAL.length })} />
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <IconCircle icon="nutrition-outline" tone={(i % 4) as 0 | 1 | 2 | 3} size={80} />
        <AppText size={20} weight="700" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{t(MEAL[i]!)}</AppText>
      </View>
      <Row>
        <Button title={t('back')} variant="ghost" disabled={i === 0} onPress={() => setI(i - 1)} style={{ flex: 1 }} />
        <Button title={t('next')} onPress={() => setI(i + 1)} style={{ flex: 2 }} />
      </Row>
      <Button title={t('close')} variant="ghost" onPress={() => setI(-1)} />
    </Card>
  );
}

