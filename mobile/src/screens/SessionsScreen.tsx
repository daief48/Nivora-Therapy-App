import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useHomework, useTherapySessions, useThemes, type TherapySessionItem } from '../api/sessions';
import { LineChart, type SeriesPoint } from '../components/nv';
import {
  AppText, Button, Card, EmptyState, ErrorState, Hero, Icon, IconCircle, ListRow, Loading, Row, Screen, SectionTitle,
} from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { kindKey } from '../components/TopicPicker';
import { topicName } from '../api/topics';
import { radius, useTheme } from '../theme';

const MAX_POINTS = 14;

/** Gentle history of guided sessions: timeline, mood before/after trend, recurring themes, open homework. No streaks, no scores. */
export function SessionsScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = useTherapySessions();
  const themes = useThemes();
  const hw = useHomework();

  const list = [...(q.data ?? [])].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  const recent = list.slice(0, MAX_POINTS).reverse();
  const series = (pick: (s: TherapySessionItem) => number | null): SeriesPoint[] =>
    recent.map((s) => ({ label: new Date(s.startedAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' }), value: pick(s) }));
  const before = series((s) => s.moodBefore), after = series((s) => s.moodAfter);
  const enough = (p: SeriesPoint[]) => p.filter((x) => x.value != null).length >= 2;
  const describe = (label: string, p: SeriesPoint[]) => t('sessListChartSummary', { label, values: p.filter((x) => x.value != null).map((x) => `${x.label} ${x.value}`).join(', ') });

  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('sessListTitle')}</AppText>
        <AppText size={14} style={{ color: c.onHeroMuted }}>{t('sessListIntro')}</AppText>
        <Button title={t('sessListStart')} icon="play" onPress={() => nav.navigate('SessionLobby')} />
      </Hero>

      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <EmptyState icon="chatbubbles-outline" title={t('sessListEmptyTitle')} body={t('sessListEmptyBody')}
          action={<Button title={t('sessListStart')} onPress={() => nav.navigate('SessionLobby')} />} />
      ) : (
        <>
          <SectionTitle>{t('sessListTrend')}</SectionTitle>
          <Card>
            {enough(before) || enough(after) ? (
              <>
                {enough(before) ? (<><AppText size={13} weight="700" muted>{t('sessListBefore')}</AppText><LineChart points={before} color={c.sky} summary={describe(t('sessListBefore'), before)} /></>) : null}
                {enough(after) ? (<><AppText size={13} weight="700" muted>{t('sessListAfter')}</AppText><LineChart points={after} summary={describe(t('sessListAfter'), after)} /></>) : null}
              </>
            ) : <AppText muted>{t('sessListTrendNeed')}</AppText>}
          </Card>

          {themes.data?.length ? (
            <>
              <SectionTitle>{t('sessListThemes')}</SectionTitle>
              <Row style={{ flexWrap: 'wrap' }}>
                {themes.data.map((x) => (
                  <View key={x.id} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.lavender }}>
                    <AppText size={14} weight="600">{x.label}</AppText>
                  </View>
                ))}
              </Row>
            </>
          ) : null}

          {hw.data?.length ? (
            <>
              <SectionTitle>{t('sessListHomework')}</SectionTitle>
              <Card>
                {hw.data.map((h) => (
                  <Row key={h.id} style={{ alignItems: 'flex-start' }}>
                    <Icon name="checkmark-circle-outline" size={20} color={c.primary} />
                    <View style={{ flex: 1 }}>
                      <AppText weight="600">{h.title}</AppText>
                      {h.dueDate ? <AppText size={12} muted>{t('sessListDue', { d: new Date(h.dueDate).toLocaleDateString() })}</AppText> : null}
                    </View>
                  </Row>
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle>{t('sessListHistory')}</SectionTitle>
          {list.map((s) => (
            <Pressable key={s.sessionId} accessibilityRole="button" onPress={() => nav.navigate('SessionSummary', { sessionId: s.sessionId })}
              accessibilityLabel={`${new Date(s.startedAt).toLocaleDateString()}. ${s.summary ?? t('sessListNoSummary')}`}>
              <Card>
                <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                  <IconCircle icon={s.sessionType === 'VOICE' ? 'mic-outline' : 'chatbubble-ellipses-outline'} tone={s.isIntake ? 0 : 2} size={40} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <AppText weight="700">{new Date(s.startedAt).toLocaleDateString()} · {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{s.lengthMin ? ` · ${t('sessMin', { n: s.lengthMin })}` : ''}</AppText>
                    <AppText size={14} muted numberOfLines={2}>{s.summary ?? t('sessListNoSummary')}</AppText>
                    {s.moodBefore != null || s.moodAfter != null ? (
                      <AppText size={12} muted>
                        {s.moodBefore != null && s.moodAfter != null ? t('sessListMoodRange', { a: s.moodBefore, b: s.moodAfter }) : s.moodBefore != null ? t('sessListMoodBefore', { a: s.moodBefore }) : t('sessListMoodAfter', { a: s.moodAfter! })}
                      </AppText>
                    ) : null}
                    {s.topic ? (
                      <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.lavender }}>
                        <AppText size={12} weight="600" accessibilityLabel={t('topicChipLabel', { name: topicName(s.topic, (k) => t(kindKey(k))) })}>{topicName(s.topic, (k) => t(kindKey(k)))}</AppText>
                      </View>
                    ) : null}
                    {s.themes?.length ? <AppText size={12} style={{ color: c.tintFg[2] }}>{s.themes.join(' · ')}</AppText> : null}
                  </View>
                  <Icon name="chevron-forward" size={18} color={c.textMuted} />
                </Row>
              </Card>
            </Pressable>
          ))}
        </>
      )}

      <Card>
        <ListRow icon="library-outline" label={t('topicsEntry')} tone={3} onPress={() => nav.navigate('Topics')} />
        <ListRow icon="flag-outline" label={t('sessListPlan')} onPress={() => nav.navigate('Plan')} />
        <ListRow icon="calendar-outline" label={t('sessListSchedule')} tone={1} onPress={() => nav.navigate('Schedule')} />
        <ListRow icon="lock-closed-outline" label={t('sessListData')} tone={2} onPress={() => nav.navigate('SessionData')} />
      </Card>
      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
    </Screen>
  );
}
