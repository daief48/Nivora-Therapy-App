import React, { useEffect, useState } from 'react';
import { Alert, Platform, Switch, View } from 'react-native';
import { saveSchedule, useSchedule, useTherapyMutation, type Schedule } from '../api/sessions';
import { Stepper } from '../components/nv';
import { AppText, Button, Card, Chip, Hero, QueryBoundary, Row, Screen, Segmented, SectionTitle } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import { useTheme } from '../theme';
import { fmtTime } from '../utils/reminders';
import { syncSessionReminders } from '../utils/sessionReminders';

/** Which days and time suit the user, plus an optional local reminder. Skipping a day is always fine. */
export function ScheduleScreen() {
  const t = useT();
  const { c } = useTheme();
  const q = useSchedule();
  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('sessSchedTitle')}</AppText>
        <AppText size={14} style={{ color: c.onHeroMuted }}>{t('sessSchedIntro')}</AppText>
      </Hero>
      <QueryBoundary q={q}>{(d) => <ScheduleForm initial={d} />}</QueryBoundary>
    </Screen>
  );
}

const DEFAULT: Schedule = { weekdays: [], timeMin: 19 * 60, lengthMin: 30, remindersOn: false };

function ScheduleForm({ initial }: { initial: Schedule }) {
  const t = useT();
  const { c } = useTheme();
  const [s, setS] = useState<Schedule>({ ...DEFAULT, ...initial });
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { setS({ ...DEFAULT, ...initial }); }, [initial]);
  const patch = (p: Partial<Schedule>) => { setS((x) => ({ ...x, ...p })); setNote(null); };
  const toggleDay = (d: number) => patch({ weekdays: s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d].sort() });
  const step = (delta: number) => patch({ timeMin: (((s.timeMin + delta) % 1440) + 1440) % 1440 });

  const save = useTherapyMutation(async () => {
    await saveSchedule(s);
    const ok = await syncSessionReminders(s, t);
    setNote(ok ? t('sessSchedSaved') : t('sessSchedDenied'));
  });
  const submit = () => save.mutate(undefined, { onError: () => Alert.alert(t('sessSchedError')) });

  return (
    <>
      <SectionTitle>{t('sessSchedDays')}</SectionTitle>
      <Row style={{ flexWrap: 'wrap' }}>
        {[0, 1, 2, 3, 4, 5, 6].map((d) => <Chip key={d} label={t(`sessDay${d}` as StringKey)} selected={s.weekdays.includes(d)} onPress={() => toggleDay(d)} />)}
      </Row>

      <Stepper label={t('sessSchedTime')} value={fmtTime(s.timeMin)} onMinus={() => step(-15)} onPlus={() => step(15)} />

      <SectionTitle>{t('sessSchedLength')}</SectionTitle>
      <Segmented<'15' | '30' | '45'> value={String(s.lengthMin) as '15' | '30' | '45'} onChange={(v) => patch({ lengthMin: Number(v) as Schedule['lengthMin'] })}
        options={(['15', '30', '45'] as const).map((v) => ({ value: v, label: t('sessMin', { n: v }) }))} />

      <Card tone="alt">
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText weight="700">{t('sessSchedRemind')}</AppText>
            <AppText size={13} muted>{t('sessSchedRemindDesc')}</AppText>
            {Platform.OS === 'web' ? <AppText size={12} muted>{t('sessSchedWebNote')}</AppText> : null}
          </View>
          <Switch value={s.remindersOn} onValueChange={(v) => patch({ remindersOn: v })} accessibilityLabel={t('sessSchedRemind')} trackColor={{ true: c.primary, false: c.border }} />
        </Row>
      </Card>

      {note ? <AppText accessibilityLiveRegion="polite" muted>{note}</AppText> : null}
      <Button title={t('sessSchedSave')} onPress={submit} loading={save.isPending} />
      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
    </>
  );
}
