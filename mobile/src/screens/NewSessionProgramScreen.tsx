import { StackActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { createProgram, PROGRAM_DAYS, useProgramMutation } from '../api/sessionPrograms';
import { Stepper } from '../components/nv';
import { TopicPicker } from '../components/TopicPicker';
import { AppText, Button, Card, Chip, Field, Hero, ProgressBar, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useTheme } from '../theme';
import { track } from '../utils/analytics';

const STEPS = 5;
const DAY_PRESETS = [7, 14, 21, 30];
/** Reminder times as minutes after midnight; null = none. */
const REMINDERS: (number | null)[] = [null, 480, 780, 1140, 1260];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Five short steps: topic, name and hope, number of days, minutes a day, optional reminder. Each step explains itself and can go back. */
export function NewSessionProgramScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootParams, 'NewProgram'>>();
  const [step, setStep] = useState(0);
  const [topicId, setTopicId] = useState<string | null>(route.params?.topicId ?? null);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState(14);
  const [minutes, setMinutes] = useState<30 | 40>(30);
  const [reminder, setReminder] = useState<number | null>(null);
  const create = useProgramMutation(createProgram);

  // One message per step, shown only after the person tries to continue with something missing.
  const [tried, setTried] = useState(false);
  const problem: string | null =
    step === 0 ? (topicId ? null : t('spTopicNeeded'))
    : step === 1 ? (title.trim() ? null : t('spTitleNeeded'))
    : step === 2 ? (days >= PROGRAM_DAYS.min && days <= PROGRAM_DAYS.max ? null : t('spDaysErr'))
    : null;

  const next = () => { if (problem) { setTried(true); return; } setTried(false); setStep((s) => s + 1); };
  const back = () => { setTried(false); if (step === 0) nav.goBack(); else setStep((s) => s - 1); };
  const submit = () => {
    create.mutate({
      ...(topicId ? { topicId } : {}), title: title.trim(), ...(goal.trim() ? { goal: goal.trim() } : {}),
      plannedDays: days, dailyMinutes: minutes, ...(reminder != null ? { reminderTimeMin: reminder } : {}),
    }, {
      onSuccess: (p) => { track('program_created'); nav.dispatch(StackActions.replace('ProgramDetail', { programId: p.id })); },
      onError: () => Alert.alert(t('spCreateErr')),
    });
  };
  const setDaysClamped = (n: number) => setDays(Math.max(PROGRAM_DAYS.min, Math.min(PROGRAM_DAYS.max, n)));

  return (
    <Screen>
      <Hero>
        <AppText size={22} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('spWizTitle')}</AppText>
        <AppText size={13} style={{ color: c.onHeroMuted }}>{t('spStepOf', { n: step + 1, m: STEPS })}</AppText>
        <ProgressBar value={step + 1} max={STEPS} label={t('spStepOf', { n: step + 1, m: STEPS })} />
      </Hero>

      {step === 0 ? (
        <Card>
          <AppText size={18} weight="800" accessibilityRole="header">{t('spStep1')}</AppText>
          <AppText size={14} muted>{t('spStep1Hint')}</AppText>
          <TopicPicker value={topicId} onChange={setTopicId} allowNone={false} />
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <AppText size={18} weight="800" accessibilityRole="header">{t('spStep2')}</AppText>
          <Field label={t('spTitleLabel')} hint={t('spTitleHint')} value={title} onChangeText={setTitle} maxLength={80} accessibilityLabel={t('spTitleLabel')} />
          <Field label={t('spGoalLabel')} value={goal} onChangeText={setGoal} maxLength={300} multiline style={{ minHeight: 90 }} accessibilityLabel={t('spGoalLabel')} />
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <AppText size={18} weight="800" accessibilityRole="header">{t('spStep3')}</AppText>
          <AppText size={14} muted>{t('spDaysHint')}</AppText>
          <Stepper label={t('spDaysLabel')} value={String(days)} onMinus={() => setDaysClamped(days - 1)} onPlus={() => setDaysClamped(days + 1)} />
          <Row style={{ flexWrap: 'wrap' }}>
            {DAY_PRESETS.map((n) => <Chip key={n} label={t('spDaysValue', { n })} selected={days === n} onPress={() => setDays(n)} />)}
          </Row>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <AppText size={18} weight="800" accessibilityRole="header">{t('spStep4')}</AppText>
          <AppText size={14} muted>{t('spMinHint')}</AppText>
          <Row>
            <Chip label={t('sessMin', { n: 30 })} selected={minutes === 30} onPress={() => setMinutes(30)} />
            <Chip label={t('sessMin', { n: 40 })} selected={minutes === 40} onPress={() => setMinutes(40)} />
          </Row>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <AppText size={18} weight="800" accessibilityRole="header">{t('spStep5')}</AppText>
          <AppText size={14} muted>{t('spRemindHint')}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            {REMINDERS.map((m) => <Chip key={String(m)} label={m == null ? t('spRemindNone') : hhmm(m)} selected={reminder === m} onPress={() => setReminder(m)} />)}
          </Row>
          <View style={{ gap: 2, paddingTop: 6 }}>
            <AppText weight="700">{title.trim()}</AppText>
            <AppText size={13} muted>{t('spSummaryLine', { days, min: minutes })}</AppText>
          </View>
        </Card>
      ) : null}

      {tried && problem ? <AppText accessibilityRole="alert" style={{ color: c.danger }}>{problem}</AppText> : null}

      <Row style={{ gap: 10 }}>
        <Button title={t('spBack')} variant="ghost" onPress={back} style={{ flex: 1 }} />
        {step < STEPS - 1
          ? <Button title={t('spNext')} onPress={next} style={{ flex: 1 }} />
          : <Button title={t('spCreate')} icon="checkmark-circle" onPress={submit} loading={create.isPending} style={{ flex: 1 }} />}
      </Row>
      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
    </Screen>
  );
}
