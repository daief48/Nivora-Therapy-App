import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { useMe } from '../api/hooks';
import { noteCrisis, isCrisisShape } from '../api/crisisShape';
import { sittingErrorKey } from '../api/sessionPrograms';
import { completeHomework, createSession, useLobby, useTherapyMutation, type Lobby } from '../api/sessions';
import { ScalePicker } from '../components/nv';
import { TopicPicker } from '../components/TopicPicker';
import { AppText, Button, Card, Chip, Field, Hero, Icon, IconCircle, QueryBoundary, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useTheme } from '../theme';
import { track } from '../utils/analytics';

type Len = 0 | 15 | 30 | 45;
const LENGTHS: Len[] = [15, 30, 45, 0];

/** The calm "before we begin" screen: today's focus, last recap, homework check, mood, length, mode and memory choice. */
export function SessionLobbyScreen() {
  const q = useLobby();
  return (
    <Screen>
      <QueryBoundary q={q}>{(d) => <LobbyBody d={d} />}</QueryBoundary>
    </Screen>
  );
}

function LobbyBody({ d }: { d: Lobby }) {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootParams, 'SessionLobby'>>();
  const me = useMe();
  const [length, setLength] = useState<Len>(() => (LENGTHS.includes(d.suggestedLengthMin as Len) ? (d.suggestedLengthMin as Len) : 30));
  const [mood, setMood] = useState(5);
  const [moodSet, setMoodSet] = useState(false);
  const [noMem, setNoMem] = useState(false);
  const [topicId, setTopicId] = useState<string | null>(route.params?.topicId ?? null); // preset when started from a topic
  const [hw, setHw] = useState<Record<string, 'DONE' | 'SKIPPED'>>({});
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState('');
  const [crisis, setCrisis] = useState<ReturnType<typeof noteCrisis>>(null);
  const redirected = useRef(false);

  // First guided session ever: show the short introduction once. Coming back without acknowledging just shows a note (no loop).
  useEffect(() => {
    if (d.guidedAck === false && !redirected.current) { redirected.current = true; nav.navigate('GuidedIntro', { next: 'lobby' }); }
  }, [d.guidedAck, nav]);

  const markHw = useTherapyMutation(async (v: { id: string; status: 'DONE' | 'SKIPPED' }) => { await completeHomework(v.id, v.status); });
  const mark = (id: string, status: 'DONE' | 'SKIPPED') => {
    setHw((h) => ({ ...h, [id]: status }));
    markHw.mutate({ id, status }, { onError: () => setHw((h) => { const n = { ...h }; delete n[id]; return n; }) });
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await createSession({
        sessionType: 'TEXT', language: me.data?.locale ?? 'en',
        lengthMin: length, isIntake: d.needsIntake, rememberThis: !noMem, ...(moodSet ? { moodBefore: mood } : {}),
        ...(topicId ? { topicId } : {}),
        ...(topicId && goal.trim() ? { goal: goal.trim().slice(0, 240) } : {}),
      });
      if (isCrisisShape(s)) { setGoal(''); setCrisis(noteCrisis(s)); return; } // risky goal: nothing stored, show support instead
      if (topicId) track('topic_selected');
      nav.navigate('Chat', { sessionId: (s as { id: string }).id });
    } catch (e) { Alert.alert(t(sittingErrorKey(e) ?? 'sessLobbyStartError')); }
    finally { setBusy(false); }
  };

  const openHw = d.openHomework.filter((h) => !hw[h.id]);
  const blocked = d.guidedAck === false;
  const lenLabel = (n: Len) => (n === 0 ? t('sessOpenEnded') : t('sessMin', { n }));

  return (
    <>
      <Hero>
        <Row style={{ gap: 14 }}>
          <View style={{ flex: 1, gap: 4 }}>
            {d.needsIntake ? <AppText size={12} weight="800" style={{ color: c.onHeroMuted }}>{t('sessLobbyIntakeBadge')}</AppText> : null}
            <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{d.needsIntake ? t('sessLobbyIntakeTitle') : t('sessLobbyTitle')}</AppText>
            <AppText size={13} style={{ color: c.onHeroMuted }}>{t('sessAiNote')}</AppText>
          </View>
        </Row>
      </Hero>

      {blocked ? (
        <Card tone="lavender">
          <AppText>{t('sessLobbyNeedIntro')}</AppText>
          <Button title={t('sessLobbyReadIntro')} variant="secondary" onPress={() => nav.navigate('GuidedIntro', { next: 'lobby' })} />
        </Card>
      ) : null}

      {d.needsIntake ? <Card tone="lavender"><AppText>{t('sessLobbyIntakeBody')}</AppText></Card> : null}

      <SectionTitle>{t('sessLobbyToday')}</SectionTitle>
      <Card>
        {d.planGoals.length === 0 && openHw.length === 0 ? <AppText muted>{t('sessLobbyTodayNone')}</AppText> : null}
        {d.planGoals.length > 0 ? <AppText size={13} weight="700" muted>{t('sessLobbyGoals')}</AppText> : null}
        {d.planGoals.map((g) => (
          <Row key={g.id} style={{ alignItems: 'flex-start' }}><Icon name="flag-outline" size={18} color={c.primary} /><AppText style={{ flex: 1 }}>{g.title}</AppText></Row>
        ))}
      </Card>

      {d.continuityOptIn && d.lastSessionRecap ? (
        <Card tone="alt">
          <AppText size={13} weight="700" muted>{t('sessLobbyRecap')}</AppText>
          <AppText>{d.lastSessionRecap}</AppText>
        </Card>
      ) : null}
      {!d.continuityOptIn ? (
        <Row style={{ alignItems: 'flex-start' }}>
          <Icon name="information-circle-outline" size={18} color={c.textMuted} />
          <AppText size={13} muted style={{ flex: 1 }}>{t('sessLobbyRecapOff')}</AppText>
        </Row>
      ) : null}

      {d.openHomework.length > 0 ? (
        <>
          <SectionTitle>{t('sessLobbyHomework')}</SectionTitle>
          <Card>
            {d.openHomework.map((h) => (
              <View key={h.id} style={{ gap: 8 }}>
                <Row style={{ alignItems: 'flex-start' }}><IconCircle icon="checkmark-circle-outline" tone={1} size={32} /><AppText weight="600" style={{ flex: 1 }}>{h.title}</AppText></Row>
                {hw[h.id] ? <AppText size={13} muted>{t('sessLobbyHwMarked')}</AppText> : (
                  <Row style={{ flexWrap: 'wrap' }}>
                    <Chip label={t('sessLobbyHwDone')} onPress={() => mark(h.id, 'DONE')} />
                    <Chip label={t('sessLobbyHwSkip')} onPress={() => mark(h.id, 'SKIPPED')} />
                  </Row>
                )}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Card>
        <ScalePicker value={mood} onChange={(n) => { setMood(n); setMoodSet(true); }} label={t('sessLobbyMood')} lowLabel={t('sessMoodLow')} highLabel={t('sessMoodHigh')} />
        <AppText size={12} muted>{t('sessLobbyMoodOpt')}</AppText>
      </Card>

      <SectionTitle>{t('topicPickTitle')}</SectionTitle>
      <AppText size={13} muted>{t('topicPickHint')}</AppText>
      <TopicPicker value={topicId} onChange={setTopicId} />

      {topicId ? (
        <Field value={goal} onChangeText={setGoal} maxLength={240} placeholder={t('scopeGoalPlaceholder')} accessibilityLabel={t('scopeGoalLabel')} />
      ) : null}
      {crisis ? (
        <Card tone="danger">
          <AppText size={18} weight="800">{t('crisisCardTitle')}</AppText>
          {crisis.safety.message ? <AppText>{crisis.safety.message}</AppText> : null}
          <Button title={t('crisisCardBtn')} variant="danger" icon="medkit-outline" onPress={() => nav.navigate('Emergency')} />
        </Card>
      ) : null}

      <SectionTitle>{t('sessLobbyLength')}</SectionTitle>
      <Row style={{ flexWrap: 'wrap' }}>
        {LENGTHS.map((n) => <Chip key={n} label={lenLabel(n)} selected={length === n} onPress={() => setLength(n)} />)}
      </Row>

      <Card tone="alt">
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText weight="700">{t('sessLobbyNoMem')}</AppText>
            <AppText size={13} muted>{noMem ? t('sessLobbyNoMemDesc') : t('sessLobbyMemOn')}</AppText>
          </View>
          <Switch value={noMem} onValueChange={setNoMem} accessibilityLabel={t('sessLobbyNoMem')} trackColor={{ true: c.primary, false: c.border }} />
        </Row>
      </Card>

      <Button title={d.needsIntake ? t('sessLobbyStartIntake') : t('sessLobbyStart')} icon="play" onPress={start} loading={busy} disabled={blocked} />
      <Button title={t('emergency')} icon="medkit-outline" variant="ghost" onPress={() => nav.navigate('Emergency')} />
    </>
  );
}
