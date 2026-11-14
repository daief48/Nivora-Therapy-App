import { noteCrisis } from '../api/crisisShape';
import type { CrisisPayload } from '../api/practice';
import { CrisisNotice } from '../components/CrisisNotice';
import { useGuideFallback, useGuideFeature, useGuideRiskSignal } from '../guide';
import { CapabilitiesCard } from '../components/CapabilitiesCard';
import { SupportOptions } from '../components/SupportOptions';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api } from '../api/client';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation, useMe, useRoutine, useSleep, useTimeline } from '../api/hooks';
import { RecentNights, SourceBadge, type NightEntry } from '../components/SleepNights';
import { useTH } from '../i18n/th';
import { useCn } from '../i18n/connectT';
import { addRoutineStep, removeRoutineStep, setRoutineDone, type RoutineStepOffer, type RoutineStepV2, type RoutineV2 } from '../api/connect';
import { LineChart, ScalePicker, ScoreRing, Stepper } from '../components/nv';
import { AppText, Button, Card, Check, Field, Hero, IconCircle, ProgressBar, QueryBoundary, Row, Screen, SectionTitle, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { Nav } from '../navigation/types';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { speak, stopSpeaking } from '../utils/speech';
// Phase 1: new sleep components
import { SleepHeroCard } from '../components/sleep/SleepHeroCard';
// Phase 2: action cards
import { AnimatedActionCard, type ActionCardItem } from '../components/sleep/AnimatedActionCard';
// Phase 3: AI companions + modern animations
import { DreamDecoderCard } from '../components/sleep/DreamDecoderCard';
import { MoonBreathCoach } from '../components/sleep/MoonBreathCoach';
import { NightWhispererSheet } from '../components/sleep/NightWhispererSheet';
import { SleepOracleCard } from '../components/sleep/SleepOracleCard';
import { LullabyComposerSheet } from '../components/sleep/LullabyComposerSheet';
import { ConstellationWeek } from '../components/sleep/ConstellationWeek';
import { LunarPhaseBar } from '../components/sleep/LunarPhaseBar';

/** A calm, glassy row for one of the AI companions: emoji, title, optional subtitle, chevron. */
function CompanionRow({ emoji, title, sub, tint, onPress }: { emoji: string; title: string; sub?: string; tint: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: tint, borderWidth: 1, borderColor: c.border }}
    >
      <Row style={{ alignItems: 'center', gap: 12, padding: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card }}>
          <AppText size={20}>{emoji}</AppText>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <AppText weight="700">{title}</AppText>
          {sub ? <AppText size={12} muted numberOfLines={1}>{sub}</AppText> : null}
        </View>
        <AppText size={18} muted>›</AppText>
      </Row>
    </Pressable>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const shift = (hhmm: string, delta: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const x = (((h! * 60 + m! + delta) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};

/** Sleepify home: score, last night, the three ways in (diary, routine, stories) and the AI Sleep Coach. */
export function SleepScreen() {
  useGuideFeature('sleep');
  const t = useT();
  const th = useTH();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const sleep = useSleep();
  const tl = useTimeline(7);
  const cn = useCn();
  const me = useMe();
  const [coach, setCoach] = useState<string | null>(null);
  const [coachAi, setCoachAi] = useState<boolean | undefined>(undefined);
  const [coachRisk, setCoachRisk] = useState(false);
  useGuideRiskSignal('sleepCoach', coachRisk);
  useGuideFallback('sleepCoach', coachAi);
  const [offer, setOffer] = useState<RoutineStepOffer | null>(null);
  const [offerState, setOfferState] = useState<'idle' | 'busy' | 'added' | 'there' | 'failed'>('idle');
  const ask = useInvalidatingMutation(() => api<{ text: string; routineStep?: RoutineStepOffer | null }>('/sleep/coach', { method: 'POST' }), []);
  const addOffer = async () => {
    if (!offer) return;
    setOfferState('busy');
    try { const r = await addRoutineStep(offer.stepId); setOfferState(r.added === false ? 'there' : 'added'); void qc.invalidateQueries({ queryKey: ['routine'] }); } catch { setOfferState('failed'); }
  };

  // ── Phase 3: AI Companion modals ──────────────────────────────────────────
  const [showBreath, setShowBreath] = useState(false);
  const [breathMood, setBreathMood] = useState(3);
  const [showWhisper, setShowWhisper] = useState(false);
  const [showLullaby, setShowLullaby] = useState(false);

  const entries = (sleep.data?.entries ?? []) as unknown as NightEntry[];
  const last = entries[0];
  const parts: [StringKey, 'duration' | 'consistency' | 'awakenings' | 'quality' | 'routine'][] = [
    ['scoreDuration', 'duration'], ['scoreConsistency', 'consistency'], ['scoreAwakenings', 'awakenings'], ['scoreQuality', 'quality'], ['scoreRoutine', 'routine'],
  ];
  const b = sleep.data?.breakdown;
  const userName = me.data?.displayName ?? undefined;

  // Oracle entries (cast from NightEntry — shares the same fields we need)
  const oracleEntries = entries.slice(0, 7).map((e) => ({
    date: (e as unknown as { date: string }).date ?? '',
    score: (e as unknown as { score: number }).score ?? 0,
    bedtime: (e as unknown as { bedtime: string }).bedtime ?? '22:00',
    durationMin: (e as unknown as { durationMin: number }).durationMin ?? 0,
    awakenings: (e as unknown as { awakenings: number }).awakenings ?? 0,
  }));

  const actionItems: ActionCardItem[] = [
    { icon: 'create-outline', label: t('sleepLog'), tone: 0, onPress: () => nav.navigate('SleepDiary') },
    { icon: 'moon-outline', label: t('sleepRoutine'), tone: 1, onPress: () => nav.navigate('Routine') },
    { icon: 'musical-notes-outline', label: t('sleepStories'), tone: 2, onPress: () => nav.navigate('AudioLibrary') },
    { icon: 'rainy-outline', label: t('tileSounds'), tone: 3, onPress: () => nav.navigate('Sounds') },
  ];

  return (
    <Screen>
      <CapabilitiesCard section="SLEEP" />
      {/* ── Phase 1: Animated hero card with Luna avatar ── */}
      <SleepHeroCard last={last} score={last?.score ?? null} userName={userName} />

      {/* ── Phase 2: Staggered animated action tiles in a modern 2×2 grid ── */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {actionItems.map((item, idx) => (
          <View key={item.label} style={{ width: '48%', flexGrow: 1 }}>
            <AnimatedActionCard item={item} index={idx} />
          </View>
        ))}
      </View>

      {/* ── Phase 3: AI Companions — a calm, stylish stack ── */}
      <View style={{ gap: 10 }}>
        <CompanionRow
          emoji="🌬️"
          title={t('slBreathTitle')}
          sub={t('slBreathSub') as string | undefined}
          tint="rgba(147, 166, 245, 0.16)"
          onPress={() => { setBreathMood(3); setShowBreath(true); }}
        />
        <CompanionRow
          emoji="🌙"
          title={t('slWhisperTitle')}
          sub={t('slWhisperSub') as string | undefined}
          tint="rgba(196, 181, 253, 0.16)"
          onPress={() => setShowWhisper(true)}
        />
        <CompanionRow
          emoji="✨"
          title={t('slLullabyTitle')}
          sub={t('slLullabySub') as string | undefined}
          tint="rgba(253, 230, 138, 0.16)"
          onPress={() => setShowLullaby(true)}
        />
      </View>

      <QueryBoundary q={sleep}>{() => null}</QueryBoundary>

      {/* ── Dream Decoder: poetic metaphor for last night ── */}
      {last && last.score != null ? (
        <DreamDecoderCard
          durationMin={(last as unknown as { durationMin: number }).durationMin ?? 0}
          awakenings={(last as unknown as { awakenings: number }).awakenings ?? 0}
          rested={(last as unknown as { rested: number }).rested ?? 6}
          score={last.score}
        />
      ) : null}

      {/* ── Sleep Score breakdown with Lunar Phase bars ── */}
      {b ? (
        <Card style={{ gap: 12 }}>
          <AppText weight="800">{t('sleepScore')}</AppText>
          {parts.map(([label, key], idx) => (
            <LunarPhaseBar key={key} value={b.parts[key]} max={b.max[key]} label={t(label)} index={idx} />
          ))}
          <AppText size={12} muted>{t('sleepScoreNote')}</AppText>
        </Card>
      ) : null}

      {/* ── Your Week: Constellation view + Oracle ── */}
      {entries.length > 1 && tl.data ? (
        <>
          <SectionTitle>{t('yourWeek')}</SectionTitle>
          <Card>
            <ConstellationWeek entries={tl.data.map((d) => ({ date: d.date, score: d.sleepScore ?? null }))} />
          </Card>
          {oracleEntries.length >= 3 ? (
            <SleepOracleCard entries={oracleEntries} />
          ) : null}
        </>
      ) : null}

      <SectionTitle>{th('thRecentNights')}</SectionTitle>
      {/* ── Phase 2: Recent nights with Luna empty state & 7-day chart ── */}
      <RecentNights entries={entries} onLogPress={() => nav.navigate('SleepDiary')} />
      <Card onPress={() => nav.navigate('HealthSync' as never)} accessibilityRole="button" accessibilityLabel={th('thHealthEntry')} style={{ gap: 4 }}>
        <AppText weight="700">{th('thHealthEntry')}</AppText>
        <AppText size={13} muted>{th('thHealthEntrySub')}</AppText>
      </Card>

      <SectionTitle>{t('sleepCoach')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Row style={{ gap: 12 }}><IconCircle icon="sparkles-outline" tone={0} size={44} /><AppText style={{ flex: 1 }} size={14} muted>{coachRisk ? t('sleepScoreNote') : coach ?? t('sleepScoreNote')}</AppText></Row>
        {coachRisk ? <SupportOptions /> : null}
        {ask.isError ? <AppText style={{ color: c.danger }}>{t(errorMessageKey(ask.error))}</AppText> : null}
        <Button title={ask.isPending ? t('sleepCoachThinking') : t('sleepCoachAsk')} variant="secondary" icon="sparkles-outline" loading={ask.isPending}
          onPress={() => ask.mutate(undefined, { onSuccess: (r) => { const x = r as { text: string; routineStep?: RoutineStepOffer | null; riskMode?: boolean }; const risk = !!x.riskMode; setCoachRisk(risk); setCoach(risk ? null : x.text); setCoachAi(risk ? undefined : (r as { ai?: boolean }).ai); setOffer(risk ? null : x.routineStep ?? null); setOfferState('idle'); } })} />
        {offer ? (
          <View style={{ gap: 6 }}>
            <AppText size={13} muted>{offer.label}{offer.minutes ? ' · ' + t('minutesShort', { n: offer.minutes }) : ''}</AppText>
            {offerState === 'added' || offerState === 'there' ? <AppText weight="700" accessibilityLiveRegion="polite">{offerState === 'there' ? cn('cnRoutineThere') : cn('cnRoutineAdded')}</AppText>
              : <Button title={cn('cnRoutineAdd')} variant="secondary" icon="moon-outline" loading={offerState === 'busy'} onPress={addOffer} />}
            {offerState === 'failed' ? <AppText size={13} accessibilityRole="alert">{cn('cnRoutineFailed')}</AppText> : null}
          </View>
        ) : null}
      </Card>

      {/* ── Phase 3: AI Modals ── */}
      <MoonBreathCoach visible={showBreath} moodLevel={breathMood} onClose={() => setShowBreath(false)} />
      <NightWhispererSheet visible={showWhisper} onClose={() => setShowWhisper(false)} />
      <LullabyComposerSheet visible={showLullaby} userName={userName} onClose={() => setShowLullaby(false)} />
    </Screen>
  );
}

/** Sleep diary entry with steppers (no typing times), then the resulting score. */
export function SleepDiaryScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const [bed, setBed] = useState('23:00'), [wake, setWake] = useState('07:00'), [latency, setLatency] = useState(15), [awake, setAwake] = useState(0);
  const [rested, setRested] = useState(6), [note, setNote] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [noteSkipped, setNoteSkipped] = useState(false);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const save = useInvalidatingMutation(() => api<{ score: number }>('/sleep', { method: 'POST', body: { bedtime: bed, wakeTime: wake, latencyMin: latency, awakenings: awake, rested, ...(note.trim() ? { note: note.trim() } : {}) } }), NIVORA_KEYS);

  if (score !== null) {
    return (
      <Screen>
        <Hero style={{ alignItems: 'center' }}>
          <View style={{ backgroundColor: c.card, borderRadius: 100, padding: 6 }}><ScoreRing score={score} size={150} label={t('sleepScore')} /></View>
          <AppText size={18} weight="800" style={{ color: c.onHero, textAlign: 'center' }}>{t('diarySaved')}</AppText>
        </Hero>
        {noteSkipped ? <AppText size={13} muted accessibilityLiveRegion="polite">{t('kzTextSkipped')}</AppText> : null}
        <AppText size={12} muted>{t('sleepScoreNote')}</AppText>
        <Button title={t('done')} onPress={() => nav.goBack()} />
      </Screen>
    );
  }
  return (
    <Screen>
      <AppText size={22} weight="800" accessibilityRole="header">{t('diaryTitle')}</AppText>
      <Stepper label={t('diaryBedtime')} value={bed} onMinus={() => setBed(shift(bed, -15))} onPlus={() => setBed(shift(bed, 15))} />
      <Stepper label={t('diaryWake')} value={wake} onMinus={() => setWake(shift(wake, -15))} onPlus={() => setWake(shift(wake, 15))} />
      <Stepper label={t('diaryLatency')} value={String(latency)} onMinus={() => setLatency(Math.max(0, latency - 5))} onPlus={() => setLatency(Math.min(240, latency + 5))} />
      <Stepper label={t('diaryAwakenings')} value={String(awake)} onMinus={() => setAwake(Math.max(0, awake - 1))} onPlus={() => setAwake(Math.min(15, awake + 1))} />
      <Card><ScalePicker label={t('diaryRested')} value={rested} onChange={setRested} /></Card>
      <Field label={t('diaryNote')} value={note} onChangeText={setNote} multiline maxLength={2000} />
      {save.isError ? <AppText style={{ color: c.danger }} accessibilityRole="alert">{t(errorMessageKey(save.error))}</AppText> : null}
      {crisis ? <CrisisNotice crisis={crisis} dismissLabel="notNow" onDismiss={() => setCrisis(null)} /> : null}
      <Button title={t('diarySave')} icon="checkmark" loading={save.isPending} onPress={() => { setCrisis(null); save.mutate(undefined, { onSuccess: (r) => {
        // High-risk note: nothing was stored; keep the note in the box and show support instead of "saved".
        const found = noteCrisis(r);
        if (found) { setCrisis(found); return; }
        const sc = (r as { score?: unknown } | null)?.score;
        setNoteSkipped(!!(r as { textSkipped?: boolean } | null)?.textSkipped);
        setScore(typeof sc === 'number' ? sc : 0);
      } }); }} />
    </Screen>
  );
}

const STEP_META: Record<string, { icon: IconName; title: StringKey; desc: StringKey }> = {
  breathing: { icon: 'flower-outline', title: 'stepBreathing', desc: 'stepBreathingDesc' },
  reflection: { icon: 'book-outline', title: 'stepReflection', desc: 'stepReflectionDesc' },
  audio: { icon: 'musical-notes-outline', title: 'stepAudio', desc: 'stepAudioDesc' },
  sleep: { icon: 'moon-outline', title: 'stepSleep', desc: 'stepSleepDesc' },
};

/** Tonight's wind-down: steps counted back from a gradually shifting bedtime. */
export function RoutineScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = useRoutine();
  const me = useMe();
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => { if (q.data) setDone(Object.fromEntries(q.data.steps.filter((s) => s.kind !== 'sleep').slice(0, q.data.stepsDone).map((s) => [s.id, true]))); }, [q.data]);
  const log = useInvalidatingMutation((v: { stepsDone: number; stepsTotal: number }) => api('/sleep/routine/log', { method: 'POST', body: v }), NIVORA_KEYS);
  const setGoal = useInvalidatingMutation((bt: string) => api('/me', { method: 'PATCH', body: { preferences: { ...(me.data?.preferences ?? {}), desiredBedtime: bt } } }), [['me'], ...NIVORA_KEYS]);

  // ── Moon Breath Coach integration ────────────────────────────────────────
  const [showBreath, setShowBreath] = useState(false);
  const [breathMood, setBreathMood] = useState(3);

  const cn = useCn();
  const qc = useQueryClient();
  const [routineErr, setRoutineErr] = useState(false);
  const putRoutine = (r: RoutineV2) => { qc.setQueryData(['routine'], r); void qc.invalidateQueries({ queryKey: ['kaizen'] }); };
  // Old shape (no per-step done): count-based log. New shape: per-step done with PUT /sleep/routine/done/:id.
  const toggle = (id: string, steps: number, r: RoutineV2, nowDone: boolean) => {
    if (r.doneIds || r.steps.some((x) => x.done !== undefined)) {
      setRoutineErr(false);
      setRoutineDone(id, !nowDone).then(putRoutine).catch(() => setRoutineErr(true));
      return;
    }
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    log.mutate({ stepsDone: Object.values(next).filter(Boolean).length, stepsTotal: steps });
  };
  const remove = (id: string) => { setRoutineErr(false); removeRoutineStep(id).then(putRoutine).catch(() => setRoutineErr(true)); };
  return (
    <Screen>
      <QueryBoundary q={q}>
        {(r0) => {
          const r = r0 as unknown as RoutineV2 & typeof r0;
          const total = r.steps.filter((s) => s.kind !== 'sleep').length;
          const isDone = (s: RoutineStepV2) => (s.done !== undefined ? s.done : r.doneIds ? r.doneIds.includes(s.id) : !!done[s.id]);
          return (
            <>
              <Hero branch>
                <AppText size={14} style={{ color: c.onHeroMuted }}>{t('routineBedtime')}</AppText>
                <AppText size={42} weight="800" style={{ color: c.onHero }}>{r.tonightBedtime}</AppText>
                <AppText size={13} style={{ color: c.onHeroMuted }}>{t('routineShift')}</AppText>
              </Hero>
              {r.steps.map((s) => {
                const m = STEP_META[s.kind] ?? { icon: 'moon-outline' as IconName, title: 'stepSleep' as StringKey, desc: 'stepSleepDesc' as StringKey };
                const isSleep = s.kind === 'sleep';
                const extra = !!(s as RoutineStepV2).extra;
                const label = (s as RoutineStepV2).label;
                return (
                  <Card key={s.id} style={{ gap: 8 }}>
                    <Row style={{ gap: 12 }}>
                      <IconCircle icon={m.icon} tone={isSleep ? 2 : 0} size={44} />
                      <View style={{ flex: 1 }}>
                        <AppText weight="800">{s.at} · {extra && label ? label : t(m.title)}{s.minutes ? ` · ${t('minutesShort', { n: s.minutes })}` : ''}</AppText>
                        {extra ? <AppText size={13} muted>{cn('cnRoutineMine')}</AppText> : <AppText size={13} muted>{t(m.desc)}</AppText>}
                      </View>
                    </Row>
                    {!isSleep ? <Check checked={isDone(s)} onToggle={() => toggle(s.id, total, r, isDone(s))} label={t('done')} /> : null}
                    {extra ? <Button title={cn('cnRoutineRemove')} variant="ghost" icon="trash-outline" onPress={() => remove(s.id)} /> : null}
                    {s.kind === 'breathing' ? (
                      <Button
                        title={`🌬️ ${t('slBreathTitle')}`}
                        variant="secondary"
                        icon="flower-outline"
                        onPress={() => { setBreathMood(3); setShowBreath(true); }}
                      />
                    ) : null}
                    {s.kind === 'audio' ? <Button title={t('openStories')} variant="secondary" icon="musical-notes-outline" onPress={() => nav.navigate('AudioLibrary')} /> : null}
                  </Card>
                );
              })}
              {routineErr ? <AppText size={13} accessibilityRole="alert">{cn('cnRoutineFailed')}</AppText> : null}
              <SectionTitle>{t('routineDesired')}</SectionTitle>
              <Stepper label={t('routineDesired')} value={r.desiredBedtime} onMinus={() => setGoal.mutate(shift(r.desiredBedtime, -15))} onPlus={() => setGoal.mutate(shift(r.desiredBedtime, 15))} />
            </>
          );
        }}
      </QueryBoundary>

      {/* ── Moon Breath Coach Modal ── */}
      <MoonBreathCoach visible={showBreath} moodLevel={breathMood} onClose={() => setShowBreath(false)} />
    </Screen>
  );
}

const STORIES = [
  { id: 'lake', icon: 'water-outline' as IconName, en: { title: 'The Quiet Lake', body: 'Imagine a small lake at dusk. The water is perfectly still. With every breath out, a soft ripple fades away. The air is cool and gentle. Nothing needs to be done. Your shoulders are heavy, your jaw is soft. The sky slowly turns a deeper blue, and the first stars appear, one by one. You are safe, and you are resting.' },
    bn: { title: 'শান্ত হ্রদ', body: 'সন্ধ্যার আলোয় একটি ছোট হ্রদের কথা ভাবুন। জল একদম স্থির। প্রতিবার শ্বাস ছাড়ার সঙ্গে একটি নরম ঢেউ মিলিয়ে যায়। বাতাস ঠান্ডা আর কোমল। এখন কিছু করার নেই। আপনার কাঁধ ভারী, চোয়াল শিথিল। আকাশ ধীরে গাঢ় নীল হয়, একটি একটি করে তারা ফোটে। আপনি নিরাপদ, আপনি বিশ্রাম নিচ্ছেন।' } },
  { id: 'rain', icon: 'rainy-outline' as IconName, en: { title: 'Rain on the Roof', body: 'It is raining softly outside, and you are warm and dry. Each drop taps the roof in a slow, steady rhythm. You do not need to count them. Let each sound carry away one small worry from today. The blanket is warm. The room is dark and calm. Breathe in slowly, and let the rain sing you to sleep.' },
    bn: { title: 'টিনের চালে বৃষ্টি', body: 'বাইরে আস্তে আস্তে বৃষ্টি পড়ছে, আর আপনি উষ্ণ ও শুকনো। প্রতিটি ফোঁটা ধীর, সমান তালে চালে টোকা দিচ্ছে। গুনতে হবে না। প্রতিটি শব্দ আজকের একটি ছোট চিন্তা নিয়ে যাক। কম্বলটি গরম। ঘরটি অন্ধকার আর শান্ত। ধীরে শ্বাস নিন, বৃষ্টির শব্দে ঘুমিয়ে পড়ুন।' } },
  { id: 'body', icon: 'body-outline' as IconName, en: { title: 'Body Scan to Sleep', body: 'Close your eyes. Feel your feet and let them become heavy. Now your legs, heavy and warm. Your belly rises and falls on its own. Your hands are loose. Your face softens, your forehead smooth. Whatever is left of today can wait until tomorrow. You are sinking gently into the bed.' },
    bn: { title: 'ঘুমের জন্য বডি স্ক্যান', body: 'চোখ বন্ধ করুন। পায়ের পাতা অনুভব করুন, তাদের ভারী হতে দিন। এবার পা, ভারী ও উষ্ণ। আপনার পেট নিজে নিজেই ওঠানামা করছে। হাত আলগা। মুখ নরম, কপাল মসৃণ। আজকের যা বাকি, তা কালকের জন্য থাক। আপনি আলতো করে বিছানায় ডুবে যাচ্ছেন।' } },
];

/** Sleep stories read aloud by the same natural voice as the calls. Nature sounds need audio files and are not included yet. */
export function AudioLibraryScreen() {
  const t = useT();
  const lang = useSettings((s) => s.uiLang);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => stopSpeaking(), []);
  const toggle = (id: string, body: string) => {
    if (playing === id) { stopSpeaking(); setPlaying(null); return; }
    setPlaying(id);
    speak(body, lang, { onDone: () => setPlaying((p) => (p === id ? null : p)), onError: () => setPlaying(null) });
  };
  return (
    <Screen>
      <AppText size={22} weight="800" accessibilityRole="header">{t('audioTitle')}</AppText>
      <AppText muted>{t('audioIntro')}</AppText>
      {STORIES.map((s) => (
        <Card key={s.id} style={{ gap: 10 }}>
          <Row style={{ gap: 12 }}>
            <IconCircle icon={s.icon} tone={2} size={46} />
            <AppText size={17} weight="800" style={{ flex: 1 }}>{s[lang === 'bn' ? 'bn' : 'en'].title}</AppText>
          </Row>
          <AppText size={14} muted numberOfLines={3}>{s[lang === 'bn' ? 'bn' : 'en'].body}</AppText>
          <Button title={playing === s.id ? t('audioStop') : t('audioPlay')} icon={playing === s.id ? 'stop' : 'play'} variant={playing === s.id ? 'secondary' : 'primary'} onPress={() => toggle(s.id, s[lang === 'bn' ? 'bn' : 'en'].body)} />
        </Card>
      ))}
      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('audioNature')}</AppText>
    </Screen>
  );
}
