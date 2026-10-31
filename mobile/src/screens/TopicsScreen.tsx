import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { topicName, useTopics, type Topic } from '../api/topics';
import { kindKey, TopicPicker } from '../components/TopicPicker';
import { AppText, Button, Card, EmptyState, Hero, Icon, IconCircle, QueryBoundary, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useTheme } from '../theme';

/** One card per topic with its session count; tapping opens that topic's sessions. */
export function TopicsScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = useTopics();
  const [adding, setAdding] = useState(false);

  const count = (n: number) => (n === 1 ? t('topicSessionCountOne') : t('topicSessionCount', { n }));
  const card = (tp: Topic) => (
    <Pressable key={tp.id} accessibilityRole="button" accessibilityLabel={`${topicName(tp, (k) => t(kindKey(k)))}. ${count(tp.sessionCount)}`}
      onPress={() => nav.navigate('TopicSessions', { topicId: tp.id })}>
      <Card>
        <Row style={{ gap: 12 }}>
          <IconCircle icon="library-outline" tone={(tp.kind.length % 4) as 0 | 1 | 2 | 3} size={44} />
          <View style={{ flex: 1 }}>
            <AppText weight="700">{topicName(tp, (k) => t(kindKey(k)))}</AppText>
            <AppText size={13} muted>{count(tp.sessionCount)}{tp.lastSessionAt ? ` · ${new Date(tp.lastSessionAt).toLocaleDateString()}` : ''}</AppText>
          </View>
          <Icon name="chevron-forward" size={18} color={c.textMuted} />
        </Row>
      </Card>
    </Pressable>
  );

  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('topicsTitle')}</AppText>
        <AppText size={14} style={{ color: c.onHeroMuted }}>{t('topicsIntro')}</AppText>
      </Hero>
      <QueryBoundary q={q}>
        {(list) => (
          <>
            {list.length === 0 ? <EmptyState icon="library-outline" title={t('topicsEmptyTitle')} body={t('topicsEmptyBody')} /> : list.map(card)}
            {adding ? (
              <Card>
                <TopicPicker value={null} allowNone={false} onChange={(id) => { setAdding(false); if (id) nav.navigate('TopicSessions', { topicId: id }); }} />
              </Card>
            ) : <Button title={t('topicsNew')} icon="add" variant="secondary" onPress={() => setAdding(true)} />}
          </>
        )}
      </QueryBoundary>
    </Screen>
  );
}
