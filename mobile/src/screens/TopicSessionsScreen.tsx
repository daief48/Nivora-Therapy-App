import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { deleteTopic, topicName, useTopicMutation, useTopicSessions, type TopicSessions } from '../api/topics';
import { kindKey } from '../components/TopicPicker';
import { AppText, Button, Card, EmptyState, Hero, Icon, IconCircle, QueryBoundary, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useTheme } from '../theme';

/** Sessions grouped under one topic: date, duration, short summary and mood. Start a new session here or delete the topic. */
export function TopicSessionsScreen() {
  const route = useRoute<RouteProp<RootParams, 'TopicSessions'>>();
  const q = useTopicSessions(route.params.topicId);
  return <Screen><QueryBoundary q={q}>{(d) => <Body d={d} />}</QueryBoundary></Screen>;
}

function Body({ d }: { d: TopicSessions }) {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const del = useTopicMutation((v: boolean) => deleteTopic(d.topic.id, v));
  const name = topicName(d.topic, (k) => t(kindKey(k)));

  const remove = () => Alert.alert(t('topicDeleteTitle'), t('topicDeleteBody'), [
    { text: t('topicDeleteKeep'), onPress: () => run(false) },
    { text: t('topicDeleteAll'), style: 'destructive', onPress: () => run(true) },
    { text: t('topicCancel'), style: 'cancel' },
  ]);
  const run = (withSessions: boolean) => del.mutate(withSessions, {
    onSuccess: () => { if (nav.canGoBack()) nav.goBack(); else nav.navigate('Topics'); },
    onError: () => Alert.alert(t('topicDeleteError')),
  });

  return (
    <>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{name}</AppText>
        <AppText size={14} style={{ color: c.onHeroMuted }}>{d.sessions.length === 1 ? t('topicSessionCountOne') : t('topicSessionCount', { n: d.sessions.length })}</AppText>
        <Button title={t('topicNewSession')} icon="play" onPress={() => nav.navigate('SessionLobby', { topicId: d.topic.id })} />
      </Hero>

      {d.sessions.length === 0 ? <EmptyState icon="library-outline" title={t('topicNoSessions')} /> : d.sessions.map((s) => (
        <Pressable key={s.id} accessibilityRole="button" onPress={() => nav.navigate('SessionSummary', { sessionId: s.id })}
          accessibilityLabel={`${new Date(s.startedAt).toLocaleDateString()}. ${s.summary ?? t('topicSessionNoSummary')}`}>
          <Card>
            <Row style={{ gap: 12, alignItems: 'flex-start' }}>
              <IconCircle icon={s.sessionType === 'VOICE' ? 'mic-outline' : 'chatbubble-ellipses-outline'} tone={2} size={40} />
              <View style={{ flex: 1, gap: 4 }}>
                <AppText weight="700">{new Date(s.startedAt).toLocaleDateString()}{s.durationMin ? ` · ${t('topicMinutes', { n: s.durationMin })}` : ''}</AppText>
                <AppText size={14} muted numberOfLines={2}>{s.summary ?? t('topicSessionNoSummary')}</AppText>
                {s.moodBefore != null || s.moodAfter != null ? (
                  <AppText size={12} muted>{s.moodBefore != null && s.moodAfter != null ? t('sessListMoodRange', { a: s.moodBefore, b: s.moodAfter }) : s.moodBefore != null ? t('sessListMoodBefore', { a: s.moodBefore }) : t('sessListMoodAfter', { a: s.moodAfter! })}</AppText>
                ) : null}
              </View>
              <Icon name="chevron-forward" size={18} color={c.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ))}

      <Button title={t('topicDelete')} icon="trash-outline" variant="ghost" onPress={remove} loading={del.isPending} />
    </>
  );
}
