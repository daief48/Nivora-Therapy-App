import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../api/client';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation, useKaizenToday } from '../api/hooks';
import type { KaizenAction } from '../api/types';
import { Celebrate } from '../components/Celebrate';
import { GrowthPlant } from '../components/nv';
import { AppText, Button, Card, Chip, Field, Hero, Icon, IconCircle, QueryBoundary, Row, Screen, SectionTitle, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { ExerciseKind, Nav } from '../navigation/types';
import { radius, useTheme } from '../theme';

const CATS: { id: string; icon: IconName; label: StringKey }[] = [
  { id: 'BREATHING', icon: 'flower-outline', label: 'catBREATHING' }, { id: 'REFLECTION', icon: 'bulb-outline', label: 'catREFLECTION' },
  { id: 'JOURNALING', icon: 'book-outline', label: 'catJOURNALING' }, { id: 'GROUNDING', icon: 'hand-left-outline', label: 'catGROUNDING' },
  { id: 'MEDITATION', icon: 'leaf-outline', label: 'catMEDITATION' }, { id: 'SLEEP_ROUTINE', icon: 'moon-outline', label: 'catSLEEP_ROUTINE' },
  { id: 'SHORT_WALK', icon: 'walk-outline', label: 'catSHORT_WALK' }, { id: 'DIGITAL_BREAK', icon: 'phone-portrait-outline', label: 'catDIGITAL_BREAK' },
  { id: 'PLANNING', icon: 'list-outline', label: 'catPLANNING' }, { id: 'GRATITUDE', icon: 'heart-outline', label: 'catGRATITUDE' },
  { id: 'SOCIAL', icon: 'people-outline', label: 'catSOCIAL' }, { id: 'RELAXATION', icon: 'cloudy-night-outline', label: 'catRELAXATION' },
  { id: 'SELF_OBSERVATION', icon: 'eye-outline', label: 'catSELF_OBSERVATION' },
];
const GUIDED: Record<string, ExerciseKind> = { BREATHING: 'breathing', GROUNDING: 'grounding', GRATITUDE: 'gratitude', REFLECTION: 'daily' };

/** Kaizen tab: pick one focus, then one tiny step per day that adapts to how it went. */
export function KaizenScreen() {
  const t = useT();
  const { c } = useTheme();
  const q = useKaizenToday();
  const [picking, setPicking] = useState(false);
  return (
    <Screen>
      <QueryBoundary q={q}>
        {(d) => (d.needsGoal || picking ? <GoalPicker onDone={() => setPicking(false)} /> : <Today data={d} onChange={() => setPicking(true)} />)}
      </QueryBoundary>
      <AppText size={12} muted style={{ textAlign: 'center', color: c.textMuted }}>{t('stageNote')}</AppText>
    </Screen>
  );
}

function GoalPicker({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const [cat, setCat] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const create = useInvalidatingMutation((v: { title: string; category: string }) => api('/kaizen/goals', { method: 'POST', body: v }), NIVORA_KEYS);
  return (
    <>
      <Hero>
        <AppText size={24} weight="800" style={{ color: c.onHero }}>{t('kzTitle')}</AppText>
        <AppText style={{ color: c.onHeroMuted }}>{t('kzIntro')}</AppText>
      </Hero>
      <SectionTitle>{t('kzPick')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {CATS.map((k) => {
          const sel = cat === k.id;
          return (
            <Pressable key={k.id} accessibilityRole="button" accessibilityState={{ selected: sel }} onPress={() => setCat(k.id)}
              style={{ width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: sel ? c.lavender : c.card, borderWidth: 2, borderColor: sel ? c.primary : c.border }}>
              <IconCircle icon={k.icon} tone={sel ? 0 : 2} size={36} />
              <AppText size={14} weight="700" style={{ flex: 1 }}>{t(k.label)}</AppText>
            </Pressable>
          );
        })}
      </View>
      <Field label={t('kzGoalName')} value={title} onChangeText={setTitle} maxLength={120} />
      <Button title={t('kzStart')} icon="rocket-outline" disabled={!cat} loading={create.isPending}
        onPress={() => cat && create.mutate({ title: title.trim() || t(CATS.find((x) => x.id === cat)!.label), category: cat }, { onSuccess: onDone })} />
      {create.isError ? <AppText style={{ color: c.danger }}>{t(errorMessageKey(create.error))}</AppText> : null}
    </>
  );
}

function Today({ data, onChange }: { data: NonNullable<ReturnType<typeof useKaizenToday>['data']>; onChange: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const [pending, setPending] = useState<'FULL' | 'PARTIAL' | 'SKIPPED' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [weekly, setWeekly] = useState<string | null>(null);
  const [win, setWin] = useState(0);
  const a = data.action as KaizenAction;
  const p = data.progress;
  const complete = useInvalidatingMutation((v: { level: string; feedback?: string }) => api<KaizenAction>(`/kaizen/actions/${a.id}/complete`, { method: 'POST', body: v }), NIVORA_KEYS);
  const adjust = useInvalidatingMutation((direction: 'easier' | 'harder') => api(`/kaizen/actions/${a.id}/adjust`, { method: 'POST', body: { direction } }), NIVORA_KEYS);
  const review = useInvalidatingMutation(() => api<{ text: string }>('/kaizen/weekly-review', { method: 'POST' }), []);
  const planned = a.status === 'PLANNED';
  const guided = GUIDED[data.goal!.category];

  const finish = (feedback?: string) => {
    if (!pending) return;
    complete.mutate({ level: pending, ...(feedback ? { feedback } : {}) }, { onSuccess: (r) => { setMsg((r as KaizenAction).message ?? null); setPending(null); setWin((n) => n + 1); } });
  };

  return (
    <>
      <Hero>
        <Row style={{ gap: 14 }}>
          <GrowthPlant stage={p.stage} size={92} />
          <View style={{ flex: 1 }}>
            <AppText size={13} style={{ color: c.onHeroMuted }}>{data.goal!.title}</AppText>
            <AppText size={24} weight="800" style={{ color: c.onHero }}>{t(`stage${p.stage}` as StringKey)}</AppText>
            <AppText size={13} style={{ color: c.onHeroMuted }}>{t('kzCompleted')} {p.completed} · {t('kzRestarts')} {p.restarts}</AppText>
          </View>
        </Row>
      </Hero>

      <SectionTitle>{t('kzToday')}</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Celebrate play={win} />
        {a.micro ? <AppText size={13} weight="700" style={{ color: c.accent }}>🌱 {t('kzRestart')} — {t('kzRestartNote')}</AppText> : null}
        <AppText size={20} weight="800">{a.title}</AppText>
        <AppText muted>{a.description}</AppText>
        {guided && planned ? <Button title={t('kzGuide')} variant="secondary" icon="play" onPress={() => nav.navigate('Exercise', { kind: guided })} /> : null}

        {planned && !pending ? (
          <>
            <Button title={t('kzDid')} icon="checkmark" onPress={() => setPending('FULL')} />
            <Row style={{ gap: 10 }}>
              <Button title={t('kzLittle')} variant="secondary" style={{ flex: 1 }} onPress={() => setPending('PARTIAL')} />
              <Button title={t('kzNotToday')} variant="ghost" style={{ flex: 1 }} onPress={() => { setPending('SKIPPED'); complete.mutate({ level: 'SKIPPED' }, { onSuccess: (r) => { setMsg((r as KaizenAction).message ?? null); setPending(null); } }); }} />
            </Row>
            <Row style={{ gap: 6 }}>
              <Chip label={t('kzEasier')} onPress={() => adjust.mutate('easier')} />
              <Chip label={t('kzHarder')} onPress={() => adjust.mutate('harder')} />
            </Row>
          </>
        ) : null}

        {pending && pending !== 'SKIPPED' ? (
          <>
            <AppText weight="700">{t('kzHowFelt')}</AppText>
            <Row style={{ flexWrap: 'wrap' }}>
              {([['EASY', 'kzEasy'], ['OK', 'kzOk'], ['HARD', 'kzHard'], ['OVERWHELMED', 'kzOverwhelmed']] as const).map(([k, l]) => <Chip key={k} label={t(l)} onPress={() => finish(k)} />)}
            </Row>
          </>
        ) : null}

        {!planned || msg ? (
          <Row style={{ gap: 10, alignItems: 'flex-start' }}>
            <Icon name="checkmark-circle" size={22} color={c.success} />
            <AppText style={{ flex: 1 }} weight="700">{msg ?? t('kzDoneToday')}</AppText>
          </Row>
        ) : null}
        {!planned && !a.reflected ? <Button title={t('kzReflectNow')} variant="secondary" icon="moon-outline" onPress={() => nav.navigate('CheckIn', { kind: 'EVENING' })} /> : null}
      </Card>

      <SectionTitle>{t('kzThisWeek')}</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          {p.week.map((d) => {
            const ok = d.status === 'DONE' || d.status === 'PARTIAL';
            const skipped = d.status === 'SKIPPED';
            return (
              <View key={d.date} accessible accessibilityLabel={`${d.date}: ${d.status ?? '-'}`} style={{ alignItems: 'center', gap: 6 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? c.success : skipped ? c.lavender : c.cardAlt }}>
                  {ok ? <Icon name="checkmark" size={18} color="#fff" /> : skipped ? <Icon name="moon-outline" size={16} color={c.textMuted} /> : null}
                </View>
                <AppText size={11} muted>{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</AppText>
              </View>
            );
          })}
        </Row>
      </Card>

      <SectionTitle>{t('kzWeekly')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        {weekly ? <AppText>{weekly}</AppText> : null}
        {review.isError ? <AppText style={{ color: c.danger }}>{t(errorMessageKey(review.error))}</AppText> : null}
        <Button title={t('kzWeeklyAsk')} variant="secondary" icon="sparkles-outline" loading={review.isPending}
          onPress={() => review.mutate(undefined, { onSuccess: (r) => setWeekly((r as { text: string }).text) })} />
      </Card>
      <Button title={t('kzChangeFocus')} variant="ghost" icon="options-outline" onPress={onChange} />
    </>
  );
}
