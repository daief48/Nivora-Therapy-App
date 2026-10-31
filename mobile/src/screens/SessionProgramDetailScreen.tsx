import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  completeHomework, deleteProgram, patchProgram, useProgram, useProgramMutation, type ProgramDetail, type TimelineDay,
} from '../api/sessionPrograms';
import { LineChart, type SeriesPoint } from '../components/nv';
import { TodayButton, TopicChip, awayAWhile } from '../components/ProgramParts';
import {
  AppText, Button, Card, Chip, ErrorState, Hero, Icon, Loading, ProgressBar, Row, Screen, SectionTitle, type IconName,
} from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { radius, useTheme } from '../theme';

/** One session program: today's action, the day-by-day timeline, mood trend, themes, small tasks, goals, and gentle controls. */
export function SessionProgramDetailScreen() {
  const route = useRoute<RouteProp<RootParams, 'ProgramDetail'>>();
  const q = useProgram(route.params.programId);
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !q.data) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  return <Body d={q.data} />;
}

function Body({ d }: { d: ProgramDetail }) {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const [hw, setHw] = useState<Record<string, 'DONE' | 'SKIPPED'>>({});
  const markHw = useProgramMutation(async (v: { id: string; status: 'DONE' | 'SKIPPED' }) => { await completeHomework(v.id, v.status); });
  const mark = (id: string, status: 'DONE' | 'SKIPPED') => {
    setHw((h) => ({ ...h, [id]: status }));
    markHw.mutate({ id, status }, { onError: () => setHw((h) => { const n = { ...h }; delete n[id]; return n; }) });
  };
  const patch = useProgramMutation((status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => patchProgram(d.id, { status }));
  const remove = useProgramMutation(() => deleteProgram(d.id));
  const confirmDelete = () => Alert.alert(t('spDeleteTitle'), t('spDeleteBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('spDelete'), style: 'destructive', onPress: () => remove.mutate(undefined, { onSuccess: () => nav.goBack(), onError: () => Alert.alert(t('errorTitle')) }) },
  ]);
  const fail = () => Alert.alert(t('errorTitle'));

  const trend = d.moodTrend ?? [];
  const series = (pick: (m: (typeof trend)[number]) => number | null): SeriesPoint[] => trend.map((m) => ({ label: String(m.day), value: pick(m) }));
  const before = series((m) => m.moodBefore), after = series((m) => m.moodAfter);
  const enough = (p: SeriesPoint[]) => p.filter((x) => x.value != null).length >= 2;
  const describe = (label: string, p: SeriesPoint[]) => t('sessListChartSummary', { label, values: p.filter((x) => x.value != null).map((x) => `${t('spDayShort', { n: x.label })} ${x.value}`).join(', ') });
  const openHw = d.openHomework.filter((h) => !hw[h.id]);

  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{d.title}</AppText>
        <TopicChip topic={d.topic} />
        {d.goal ? <AppText size={14} style={{ color: c.onHeroMuted }}>{d.goal}</AppText> : null}
        <AppText size={14} weight="700" style={{ color: c.onHero }}>{t('spDayOf', { n: d.currentDay, m: d.plannedDays })} · {t('spMinutesADay', { n: d.dailyMinutes })}</AppText>
        <ProgressBar value={d.progressPct} label={t('spProgressA11y', { n: d.completedSittings, m: d.plannedDays })} />
      </Hero>

      <Card style={{ gap: 10 }}>
        {awayAWhile(d) ? <AppText size={14} muted>{t('spWelcomeBack')}</AppText> : null}
        {d.todayState === 'PAUSED' ? <AppText size={14} muted>{t('spPausedNote')}</AppText> : null}
        <TodayButton p={d} />
        <AppText size={12} muted>{t('sessAiNote')}</AppText>
      </Card>

      <SectionTitle>{t('spTimeline')}</SectionTitle>
      <Card style={{ gap: 4 }}>
        {d.timeline.map((day) => <TimelineRow key={day.dayNumber} day={day} programId={d.id} />)}
      </Card>

      <SectionTitle>{t('spMoodTrend')}</SectionTitle>
      <Card>
        {enough(before) || enough(after) ? (
          <>
            {enough(before) ? (<><AppText size={13} weight="700" muted>{t('sessListBefore')}</AppText><LineChart points={before} color={c.sky} summary={describe(t('sessListBefore'), before)} /></>) : null}
            {enough(after) ? (<><AppText size={13} weight="700" muted>{t('sessListAfter')}</AppText><LineChart points={after} summary={describe(t('sessListAfter'), after)} /></>) : null}
          </>
        ) : <AppText muted>{t('sessListTrendNeed')}</AppText>}
      </Card>

      {d.themes.length ? (
        <>
          <SectionTitle>{t('spThemes')}</SectionTitle>
          <Row style={{ flexWrap: 'wrap' }}>
            {d.themes.map((x) => (
              <View key={x} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.lavender }}><AppText size={14} weight="600">{x}</AppText></View>
            ))}
          </Row>
        </>
      ) : null}

      {d.openHomework.length ? (
        <>
          <SectionTitle>{t('spHomework')}</SectionTitle>
          <Card>
            {d.openHomework.map((h) => (
              <View key={h.id} style={{ gap: 6 }}>
                <AppText weight="600">{h.title}</AppText>
                {hw[h.id] ? <AppText size={13} muted>{t('sessLobbyHwMarked')}</AppText> : (
                  <Row style={{ flexWrap: 'wrap' }}>
                    <Chip label={t('sessLobbyHwDone')} onPress={() => mark(h.id, 'DONE')} />
                    <Chip label={t('sessLobbyHwSkip')} onPress={() => mark(h.id, 'SKIPPED')} />
                  </Row>
                )}
              </View>
            ))}
            {openHw.length === 0 ? <AppText size={13} muted>{t('sessSumHomeworkNone')}</AppText> : null}
          </Card>
        </>
      ) : null}

      {d.planGoals.length ? (
        <>
          <SectionTitle>{t('spGoals')}</SectionTitle>
          <Card>
            {d.planGoals.map((g) => (
              <Row key={g.id} style={{ alignItems: 'flex-start' }}><Icon name="flag-outline" size={18} color={c.primary} /><AppText style={{ flex: 1 }}>{g.title}</AppText></Row>
            ))}
          </Card>
        </>
      ) : null}

      <Card style={{ gap: 6 }}>
        {d.status === 'ACTIVE' ? <Button title={t('spPause')} variant="secondary" icon="pause" onPress={() => patch.mutate('PAUSED', { onError: fail })} /> : null}
        {d.status === 'PAUSED' ? <Button title={t('spResume')} variant="secondary" icon="play" onPress={() => patch.mutate('ACTIVE', { onError: fail })} /> : null}
        {d.status !== 'ARCHIVED' ? <Button title={t('spArchive')} variant="ghost" icon="archive" onPress={() => patch.mutate('ARCHIVED', { onSuccess: () => nav.goBack(), onError: fail })} /> : null}
        <Button title={t('spDelete')} variant="ghost" icon="trash-outline" onPress={confirmDelete} />
      </Card>
    </Screen>
  );
}

function TimelineRow({ day, programId }: { day: TimelineDay; programId: string }) {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const icon: IconName = day.status === 'DONE' ? 'checkmark-circle' : day.status === 'TODAY' ? 'play' : 'ellipse-outline';
  const label = day.status === 'DONE' ? t('spDayDone', { n: day.dayNumber }) : day.status === 'TODAY' ? t('spDayToday', { n: day.dayNumber })
    : t('spDayUpcoming', { n: day.dayNumber });
  const detail = day.status === 'DONE'
    ? [day.date ? new Date(day.date).toLocaleDateString() : null, day.durationMin ? t('sessMin', { n: day.durationMin }) : null,
      day.moodBefore != null && day.moodAfter != null ? t('sessListMoodRange', { a: day.moodBefore, b: day.moodAfter }) : null].filter(Boolean).join(' · '): '';
  const openIt = day.status === 'DONE' && day.sittingId ? () => nav.navigate('SessionSummary', { sessionId: day.sittingId!, programId })
    : day.status === 'TODAY' && day.sittingId ? () => nav.navigate('Chat', { sittingId: day.sittingId!, programId }) : null;
  const body = (
    <Row style={{ gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
      <Icon name={icon} size={22} color={day.status === 'DONE' ? c.success : day.status === 'TODAY' ? c.primary : c.textMuted} />
      <View style={{ flex: 1 }}>
        <AppText weight={day.status === 'TODAY' ? '800' : '600'}>{label}</AppText>
        {detail ? <AppText size={12} muted>{detail}</AppText> : null}
        {day.shortSummary ? <AppText size={13} muted numberOfLines={2}>{day.shortSummary}</AppText> : null}
      </View>
      {openIt ? <Icon name="chevron-forward" size={18} color={c.textMuted} /> : null}
    </Row>
  );
  return openIt ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${day.shortSummary ?? ''}`} onPress={openIt}>{body}</Pressable> : <View accessible accessibilityLabel={label}>{body}</View>;
}
