import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { api } from '../api/client';
import {
  completeHomework, setSessionMood, SUMMARY_MAX_POLLS, SUMMARY_POLL_MS, useTherapyMutation, type TherapySessionDetail,
} from '../api/sessions';
import { ScalePicker } from '../components/nv';
import { AppText, Button, Card, Check, ErrorState, Hero, Icon, Loading, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { radius, useTheme } from '../theme';
import { track } from '../utils/analytics';

/** Post-session recap: summary, takeaways, themes, homework, mood after, feedback. Polls softly while the note is prepared. */
export function SessionSummaryScreen() {
  const t = useT();
  const route = useRoute<RouteProp<RootParams, 'SessionSummary'>>();
  const id = route.params.sessionId;
  const polls = React.useRef(0);
  const [n, setN] = useState(0); // re-render after each poll so the "not ready" state can appear
  const q = useQuery({
    queryKey: ['therapy', 'session', id],
    queryFn: async () => { const d = await api<TherapySessionDetail>(`/therapy/sessions/${id}`); polls.current += 1; setN(polls.current); return d; },
    refetchInterval: (query) => {
      const d = query.state.data;
      const remembered = d && (d.rememberThis === false || d.remembered === false);
      return !d || d.note || remembered || polls.current >= SUMMARY_MAX_POLLS ? false : SUMMARY_POLL_MS;
    },
  });
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !q.data) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const again = () => { polls.current = 0; setN(0); void q.refetch(); };
  return <Body d={q.data} polling={n < SUMMARY_MAX_POLLS} again={again} t={t} />;
}

function Body({ d, polling, again, t }: { d: TherapySessionDetail; polling: boolean; again: () => void; t: ReturnType<typeof useT> }) {
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const [mood, setMood] = useState(d.moodAfter ?? 6);
  const [moodDone, setMoodDone] = useState(d.moodAfter != null);
  const [fb, setFb] = useState<null | 1 | -1>(null);
  const [hw, setHw] = useState<Record<string, 'DONE' | 'SKIPPED'>>({});
  const notRemembered = d.rememberThis === false || d.remembered === false;
  const note = d.note;

  const saveMood = useTherapyMutation(async () => { await setSessionMood(d.sessionId, { moodAfter: mood }); });
  const doHw = useTherapyMutation(async (v: { id: string; status: 'DONE' | 'SKIPPED' }) => { await completeHomework(v.id, v.status); });
  const markHw = (hid: string, status: 'DONE' | 'SKIPPED') => {
    setHw((h) => ({ ...h, [hid]: status }));
    doHw.mutate({ id: hid, status }, { onError: () => setHw((h) => { const n = { ...h }; delete n[hid]; return n; }) });
  };
  const submitMood = () => saveMood.mutate(undefined, { onSuccess: () => setMoodDone(true), onError: () => Alert.alert(t('errorTitle')) });
  const thumbs = (v: 1 | -1) => { setFb(v); track('session_feedback', { ok: v === 1 }); };
  const next = note?.unresolved?.[0];
  const themes = note?.themes?.length ? note.themes : d.themes ?? [];

  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('sessSumTitle')}</AppText>
        <AppText size={14} style={{ color: c.onHeroMuted }}>{t('sessSumIntro')}</AppText>
      </Hero>

      {notRemembered ? (
        <Card tone="lavender"><AppText>{t('sessSumNotRemembered')}</AppText></Card>
      ) : !note ? (
        <Card tone="lavender">
          <AppText accessibilityLiveRegion="polite">{polling ? t('sessSumPreparing') : t('sessSumNotReady')}</AppText>
          {!polling ? <Button title={t('sessSumCheckAgain')} variant="secondary" icon="refresh-outline" onPress={again} /> : null}
        </Card>
      ) : (
        <>
          <Card>
            <AppText>{note.summary ?? d.summary}</AppText>
            {note.progressNote ? <AppText size={14} muted>{note.progressNote}</AppText> : null}
          </Card>

          {note.keyInsights?.length ? (
            <>
              <SectionTitle>{t('sessSumTakeaways')}</SectionTitle>
              <Card>
                {note.keyInsights.map((k, i) => (
                  <Row key={i} style={{ alignItems: 'flex-start' }}><Icon name="sparkles-outline" size={18} color={c.accent} /><AppText style={{ flex: 1 }}>{k}</AppText></Row>
                ))}
              </Card>
            </>
          ) : null}

          {themes.length ? (
            <>
              <SectionTitle>{t('sessSumThemes')}</SectionTitle>
              <Row style={{ flexWrap: 'wrap' }}>
                {themes.map((x) => (
                  <View key={x} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.lavender }}><AppText size={14} weight="600">{x}</AppText></View>
                ))}
              </Row>
            </>
          ) : null}

          <SectionTitle>{t('sessSumHomework')}</SectionTitle>
          <Card>
            {d.homework?.length ? d.homework.map((h) => {
              const st = hw[h.id] ?? (h.status !== 'ASSIGNED' ? h.status : undefined);
              return (
                <View key={h.id} style={{ gap: 4 }}>
                  <Check checked={st === 'DONE'} label={h.title} onToggle={() => { if (!st) markHw(h.id, 'DONE'); }} />
                  {st === 'SKIPPED' ? <AppText size={13} muted style={{ marginLeft: 38 }}>{t('sessSumSkipped')}</AppText> : null}
                  {!st ? <Pressable accessibilityRole="button" onPress={() => markHw(h.id, 'SKIPPED')} style={{ marginLeft: 38, minHeight: 44, justifyContent: 'center' }}><AppText size={13} weight="700" style={{ color: c.primary }}>{t('sessSumSkip')}</AppText></Pressable> : null}
                </View>
              );
            }) : <AppText muted>{t('sessSumHomeworkNone')}</AppText>}
          </Card>
        </>
      )}

      {!notRemembered ? (
        <Card>
          <ScalePicker value={mood} onChange={(n) => { setMood(n); setMoodDone(false); }} label={t('sessSumMoodAfter')} lowLabel={t('sessMoodLow')} highLabel={t('sessMoodHigh')} />
          {moodDone ? <AppText size={13} muted accessibilityLiveRegion="polite">{t('sessSumMoodSaved')}</AppText>
            : <Button title={t('sessSumMoodSave')} variant="secondary" onPress={submitMood} loading={saveMood.isPending} />}
        </Card>
      ) : null}

      <Card>
        <AppText weight="700">{t('sessSumHelpful')}</AppText>
        {fb ? <AppText muted accessibilityLiveRegion="polite">{t('sessSumThanks')}</AppText> : (
          <Row>
            <Button title={t('sessSumYes')} icon="thumbs-up-outline" variant="secondary" onPress={() => thumbs(1)} style={{ flex: 1 }} />
            <Button title={t('sessSumNo')} icon="thumbs-down-outline" variant="secondary" onPress={() => thumbs(-1)} style={{ flex: 1 }} />
          </Row>
        )}
      </Card>

      {!notRemembered && note ? (
        <Card tone="alt">
          <AppText weight="700">{t('sessSumNext')}</AppText>
          <AppText muted>{next ? t('sessSumNextBody', { x: next }) : t('sessSumNextNone')}</AppText>
          <Button title={t('sessSumPlanNext')} variant="ghost" icon="calendar-outline" onPress={() => nav.navigate('Schedule')} />
        </Card>
      ) : null}

      <AppText size={12} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
      <Button title={t('sessSumData')} variant="ghost" icon="lock-closed-outline" onPress={() => nav.navigate('SessionData')} />
      <Button title={t('sessSumDone')} onPress={() => nav.navigate('Sessions')} />
    </Screen>
  );
}
