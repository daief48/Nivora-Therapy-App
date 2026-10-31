import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, View } from 'react-native';
import { usePrograms, type ProgramSummary } from '../api/sessionPrograms';
import { useTherapySessions } from '../api/sessions';
import { Avatar } from '../components/Avatar';
import { awayAWhile, TodayButton, TopicChip } from '../components/ProgramParts';
import {
  AppText, Button, Card, EmptyState, ErrorState, Hero, Icon, IconCircle, Loading, ProgressBar, Row, Screen, SectionTitle,
} from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useTheme } from '../theme';

const EARLIER_LIMIT = 3;

/** Sessions tab: each session is a short program (topic, goal, days) with one sitting a day. Earlier standalone sessions stay below. */
export function SessionProgramsListScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = usePrograms();
  const earlier = useTherapySessions();
  const legacy = [...(earlier.data ?? [])].filter((s) => !s.programId && s.dayNumber == null)
    .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  const programs = (q.data ?? []).filter((p) => p.status !== 'ARCHIVED');

  return (
    <Screen>
      <Hero>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 4, paddingRight: 8 }}>
            <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('spTitle')}</AppText>
            <AppText size={14} style={{ color: c.onHeroMuted }}>{t('spIntro')}</AppText>
          </View>
          <Avatar state="idle" size={84} />
        </Row>
        <AppText size={12} style={{ color: c.onHeroMuted }}>{t('chatDisclosure')}</AppText>
        <Button title={t('spNew')} icon="add-circle-outline" onPress={() => nav.navigate('NewProgram')} accessibilityLabel={t('spNewA11y')} />
      </Hero>

      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : programs.length === 0 ? (
        <EmptyState icon="leaf-outline" title={t('spEmptyTitle')} body={t('spEmptyBody')} action={<Button title={t('spNewShort')} onPress={() => nav.navigate('NewProgram')} />} />
      ) : programs.map((p) => <ProgramCard key={p.id} p={p} />)}

      {legacy.length > 0 ? (
        <>
          <SectionTitle>{t('spEarlier')}</SectionTitle>
          {legacy.slice(0, EARLIER_LIMIT).map((s) => (
            <Pressable key={s.sessionId} accessibilityRole="button" onPress={() => nav.navigate('SessionSummary', { sessionId: s.sessionId })}
              accessibilityLabel={`${new Date(s.startedAt).toLocaleDateString()}. ${s.summary ?? t('sessListNoSummary')}`}>
              <Card>
                <Row style={{ gap: 12 }}>
                  <IconCircle icon="chatbubble-ellipses-outline" tone={2} size={40} />
                  <View style={{ flex: 1 }}>
                    <AppText weight="700">{new Date(s.startedAt).toLocaleDateString()}</AppText>
                    <AppText size={14} muted numberOfLines={2}>{s.summary ?? t('sessListNoSummary')}</AppText>
                  </View>
                  <Icon name="chevron-forward" size={18} color={c.textMuted} />
                </Row>
              </Card>
            </Pressable>
          ))}
          <Button title={t('spEarlierAll')} variant="ghost" onPress={() => nav.navigate('Sessions')} />
        </>
      ) : null}
      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
    </Screen>
  );
}

function ProgramCard({ p }: { p: ProgramSummary }) {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  return (
    <Card style={{ gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('spOpenA11y', { title: p.title })} onPress={() => nav.navigate('ProgramDetail', { programId: p.id })} style={{ gap: 8 }}>
        <Row style={{ gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText size={18} weight="800">{p.title}</AppText>
            <TopicChip topic={p.topic} />
          </View>
          <Icon name="chevron-forward" size={20} color={c.textMuted} />
        </Row>
        <AppText size={14} weight="600">{t('spDayOf', { n: p.currentDay, m: p.plannedDays })}</AppText>
        <ProgressBar value={p.progressPct} label={t('spProgressA11y', { n: p.completedSittings, m: p.plannedDays })} />
        {p.todayState === 'PAUSED' ? <AppText size={13} muted>{t('spPausedNote')}</AppText> : null}
        {awayAWhile(p) ? <AppText size={13} muted>{t('spWelcomeBack')}</AppText> : null}
      </Pressable>
      <TodayButton p={p} />
    </Card>
  );
}
