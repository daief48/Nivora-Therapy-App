import { noteCrisis, isAlreadyCompleted } from '../api/crisisShape';
import type { CrisisPayload } from '../api/practice';
import { CrisisNotice } from '../components/CrisisNotice';
import { useGuideFeature, useGuideReaction, useGuideRiskSignal } from '../guide';
import { SupportOptions } from '../components/SupportOptions';
import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation, useKaizenToday } from '../api/hooks';
import type { ExtraStep, KaizenAction } from '../api/types';
import { Celebrate } from '../components/Celebrate';
import { WeeklyReportCard } from '../components/WeeklyReportCard';
import { useFeedT, type FeedKey } from '../i18n/feedT';
import { GrowthPlant } from '../components/nv';
import { AppText, Button, Card, Chip, Field, Hero, Icon, IconCircle, QueryBoundary, Row, Screen, SectionTitle, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { ExerciseKind, Nav } from '../navigation/types';
import { radius, useTheme } from '../theme';
import { KaizenSegmentedControl, type KaizenTab } from '../components/kaizen/KaizenSegmentedControl';
import { KaizenProgramsSection } from '../components/kaizen/KaizenProgramsSection';
import { ActiveProgramBanner } from '../components/kaizen/ActiveProgramBanner';
import { SoulBatterySlider, type EnergyLevel } from '../components/kaizen/SoulBatterySlider';
import { ZenPearlRewardModal } from '../components/kaizen/ZenPearlRewardModal';
import { SoulWeatherModal } from '../components/kaizen/SoulWeatherModal';
import { PlantChronicleCard } from '../components/kaizen/PlantChronicleCard';
import { OmikujiBloomModal } from '../components/kaizen/OmikujiBloomModal';
import { usePrograms, type ProgramSummary } from './ProgramsScreen';

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

/** Small extra steps from the journal, a walk, the action menu or a session close (new fields; tolerant when absent). */

function ExtraSteps({ extras }: { extras: ExtraStep[] }) {
  const f = useFeedT();
  const { c } = useTheme();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const complete = useInvalidatingMutation((id: string) => api(`/kaizen/actions/${id}/complete`, { method: 'POST', body: { level: 'FULL' } }), NIVORA_KEYS);
  return (
    <>
      <SectionTitle>{f('fdKzExtras')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        {extras.map((x) => {
          const isDone = done[x.id] || (x.status != null && x.status !== 'PLANNED');
          return (
            <Row key={x.id} style={{ gap: 10, justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <AppText weight="700">{x.title}</AppText>
                {x.source && x.source !== 'GOAL' ? <AppText size={12} muted>{f(`fdKzSrc_${x.source}` as FeedKey)}</AppText> : null}
              </View>
              {isDone ? <Row style={{ gap: 4 }}><Icon name="checkmark-circle" size={18} color={c.success} /><AppText size={13} weight="700" style={{ color: c.success }}>{f('fdKzExtraDone')}</AppText></Row>
                : <Button title={f('fdKzExtraMark')} variant="secondary" accessibilityLabel={f('fdKzExtraA11y', { title: x.title })} loading={complete.isPending && complete.variables === x.id} onPress={() => complete.mutate(x.id, { onSuccess: () => setDone((d) => ({ ...d, [x.id]: true })) })} />}
            </Row>
          );
        })}
        {complete.isError ? <AppText size={13} accessibilityRole="alert">{f('fdKzExtraFailed')}</AppText> : null}
      </Card>
    </>
  );
}

/** Kaizen tab: pick one focus, then one tiny step per day that adapts to how it went. */
export function KaizenScreen() {
  useGuideFeature('kaizen');
  const t = useT();
  const { c } = useTheme();
  const q = useKaizenToday();
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState<KaizenTab>('today');
  useGuideRiskSignal('kaizen', !!q.data?.riskMode);

  return (
    <Screen>
      {/* ── Top Segmented Sub-Tab Switcher ── */}
      <KaizenSegmentedControl
        activeTab={tab}
        onChangeTab={setTab}
        todayLabel={t('kzTodayTab')}
        programsLabel={t('kzProgramsTab')}
      />

      {tab === 'programs' ? (
        <KaizenProgramsSection />
      ) : (
        <>
          <QueryBoundary q={q}>
            {(d) => (d.riskMode ? <SupportOptions /> : d.needsGoal || picking ? <GoalPicker onDone={() => setPicking(false)} /> : <Today data={d} onChange={() => setPicking(true)} />)}
          </QueryBoundary>
          <AppText size={12} muted style={{ textAlign: 'center', color: c.textMuted }}>{t('stageNote')}</AppText>
        </>
      )}
    </Screen>
  );
}

function GoalPicker({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const [cat, setCat] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [showSoulWeather, setShowSoulWeather] = useState(false);
  const create = useInvalidatingMutation((v: { title: string; category: string }) => api('/kaizen/goals', { method: 'POST', body: v }), NIVORA_KEYS);
  return (
    <>
      <Hero>
        <AppText size={24} weight="800" style={{ color: c.onHero }}>{t('kzTitle')}</AppText>
        <AppText style={{ color: c.onHeroMuted }}>{t('kzIntro')}</AppText>
      </Hero>
      <SectionTitle action={<Chip label={t('kzSoulWeatherBtn')} onPress={() => setShowSoulWeather(true)} />}>
        {t('kzPick')}
      </SectionTitle>
      <SoulWeatherModal
        visible={showSoulWeather}
        onClose={() => setShowSoulWeather(false)}
        onAdoptRitual={(ritTitle) => {
          setTitle(ritTitle);
          setCat('GROUNDING');
        }}
      />
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
  const [batteryLevel, setBatteryLevel] = useState<EnergyLevel>('MED');
  const [showPearl, setShowPearl] = useState(false);
  const [showOmikuji, setShowOmikuji] = useState(false);
  const [showSoulWeather, setShowSoulWeather] = useState(false);
  const focusDay = (useRoute().params as { weekday?: unknown } | undefined)?.weekday;
  const [msg, setMsg] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const qc = useQueryClient();
  const f = useFeedT();
  const extras = Array.isArray(data.extras) ? data.extras.filter((x) => x && x.id && x.title) : [];
  const [win, setWin] = useState(0);
  const a = data.action as KaizenAction;
  const p = data.progress;
  const complete = useInvalidatingMutation((v: { level: string; feedback?: string }) => api<KaizenAction>(`/kaizen/actions/${a.id}/complete`, { method: 'POST', body: v }), NIVORA_KEYS);
  const adjust = useInvalidatingMutation((direction: 'easier' | 'harder') => api(`/kaizen/actions/${a.id}/adjust`, { method: 'POST', body: { direction } }), NIVORA_KEYS);
  const alchemize = useInvalidatingMutation(() => api<{ action: KaizenAction | null; atomicStep: { title: string; description: string } }>('/kaizen/alchemize', {
    method: 'POST',
    body: { actionId: a.id, energyLevel: 'LOW', category: data.goal?.category },
  }), NIVORA_KEYS);
  const planned = a.status === 'PLANNED';
  const guided = GUIDED[data.goal!.category];

  const programsQuery = usePrograms();
  const activeProgram = programsQuery.data?.find((p) => p.status === 'ACTIVE' && p.enrolled);
  const openProgramDay = (p: ProgramSummary) => {
    nav.navigate('ProgramDay', {
      programId: p.id,
      day: p.status === 'COMPLETED' ? 1 : Math.min(p.nextDay ?? 1, Math.max(1, p.unlockedDay)),
    });
  };

  const react = useGuideReaction();
  // 409 ALREADY_COMPLETED (a done step cannot become a skip): a quiet no-op, just show what is true now.
  const quietIfDone = (e: unknown) => { if (isAlreadyCompleted(e)) { setPending(null); void qc.invalidateQueries({ queryKey: ['kaizen'] }); void qc.invalidateQueries({ queryKey: ['today'] }); } };
  const finish = (feedback?: string) => {
    if (!pending) return;
    const isFull = pending === 'FULL';
    const isAtomic = a.micro;
    complete.mutate({ level: pending, ...(feedback ? { feedback } : {}) }, {
      onSuccess: (r) => {
        const found = noteCrisis(r);
        if (found) { setCrisis(found); setPending(null); return; }
        react('step');
        setMsg((r as KaizenAction).message ?? null);
        setPending(null);
        setWin((n) => n + 1);
        if (isAtomic) {
          setShowPearl(true);
        } else if (isFull) {
          setShowOmikuji(true);
        }
      },
      onError: quietIfDone,
    });
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

      {activeProgram ? (
        <ActiveProgramBanner
          program={activeProgram}
          onContinue={() => openProgramDay(activeProgram)}
        />
      ) : null}

      <SectionTitle action={<Chip label={t('kzSoulWeatherBtn')} onPress={() => setShowSoulWeather(true)} />}>
        {t('kzToday')}
      </SectionTitle>

      <Card style={{ gap: 12 }}>
        <Celebrate play={win} />
        {a.micro ? <AppText size={13} weight="700" style={{ color: c.accent }}>🌱 {t('kzRestart')} — {t('kzRestartNote')}</AppText> : null}
        <AppText size={20} weight="800">{a.title}</AppText>
        <AppText muted>{a.description}</AppText>
        {data.lightDay && data.reason ? <AppText size={13} muted testID="kz-light-reason" accessibilityLabel={f('fdWhyA11y', { reason: data.reason })}>{data.reason}</AppText> : null}
        {guided && planned ? <Button title={t('kzGuide')} variant="secondary" icon="play" onPress={() => nav.navigate('Exercise', { kind: guided })} /> : null}

        {/* Feature 1: The Energy Alchemist Soul Battery */}
        {planned ? (
          <SoulBatterySlider
            level={batteryLevel}
            onChangeLevel={setBatteryLevel}
            onAlchemize={() => alchemize.mutate()}
            isAlchemizing={alchemize.isPending}
          />
        ) : null}

        {crisis ? <CrisisNotice crisis={crisis} dismissLabel="notNow" onDismiss={() => setCrisis(null)} /> : null}
        {planned && !pending ? (
          <>
            <Button title={t('kzDid')} icon="checkmark" onPress={() => setPending('FULL')} />
            <Row style={{ gap: 10 }}>
              <Button title={t('kzLittle')} variant="secondary" style={{ flex: 1 }} onPress={() => setPending('PARTIAL')} />
              <Button title={t('kzNotToday')} variant="ghost" style={{ flex: 1 }} onPress={() => { setPending('SKIPPED'); complete.mutate({ level: 'SKIPPED' }, { onSuccess: (r) => { const found = noteCrisis(r); if (found) { setCrisis(found); setPending(null); return; } setMsg((r as KaizenAction).message ?? null); setPending(null); }, onError: quietIfDone }); }} />
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

      {extras.length ? <ExtraSteps extras={extras} /> : null}

      <SectionTitle>{t('kzThisWeek')}</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          {p.week.map((d) => {
            const ok = d.status === 'DONE' || d.status === 'PARTIAL';
            const skipped = d.status === 'SKIPPED';
            return (
              <View key={d.date} accessible accessibilityLabel={`${d.date}: ${d.status ?? '-'}`} style={{ alignItems: 'center', gap: 6 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: ok ? c.success : skipped ? c.lavender : c.cardAlt, ...(typeof focusDay === 'number' && new Date(`${d.date}T12:00:00`).getDay() === focusDay ? { borderWidth: 2, borderColor: c.primary } : {}) }}>
                  {ok ? <Icon name="checkmark" size={18} color="#fff" /> : skipped ? <Icon name="moon-outline" size={16} color={c.textMuted} /> : null}
                </View>
                <AppText size={11} muted>{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</AppText>
              </View>
            );
          })}
        </Row>
      </Card>

      <SectionTitle>{t('kzWeekly')}</SectionTitle>
      {/* Feature 3: The Living Zen Chronicle */}
      <PlantChronicleCard stage={p.stage} weeklyActions={p.week} />
      <WeeklyReportCard />
      <Button title={t('kzChangeFocus')} variant="ghost" icon="options-outline" onPress={onChange} />

      {/* Feature 1: Zen Pearl Modal */}
      <ZenPearlRewardModal visible={showPearl} onClose={() => setShowPearl(false)} />

      {/* Feature 5: Zen Omikuji Bloom Modal */}
      <OmikujiBloomModal
        visible={showOmikuji}
        actionTitle={a.title}
        streakCount={p.consistency7}
        onClose={() => setShowOmikuji(false)}
      />

      {/* Feature 2: Soul Weather Modal */}
      <SoulWeatherModal
        visible={showSoulWeather}
        onClose={() => setShowSoulWeather(false)}
        onAdoptRitual={() => {
          void qc.invalidateQueries({ queryKey: ['kaizen'] });
          void qc.invalidateQueries({ queryKey: ['today'] });
        }}
      />
    </>
  );
}
