import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSessions } from '../api/hooks';
import { Avatar } from '../components/Avatar';
import {
  AppText, Button, Card, EmptyState, ErrorState, Hero, Icon, IconCircle, ListRow, Loading, Row, Screen, SectionTitle, type IconName,
} from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { Nav } from '../navigation/types';
import { useTheme } from '../theme';

/** Chat tab: pick how to talk (text / voice call / avatar call) and revisit earlier conversations. */
export function ChatHubScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = useSessions(10);

  const options: { icon: IconName; title: StringKey; desc: StringKey; tone: 0 | 1 | 2; go: () => void }[] = [
    { icon: 'chatbubble-ellipses-outline', title: 'hubText', desc: 'hubTextDesc', tone: 0, go: () => nav.navigate('Chat') },
    { icon: 'mic-outline', title: 'hubVoice', desc: 'hubVoiceDesc', tone: 1, go: () => nav.navigate('Call', { mode: 'voice' }) },
    { icon: 'videocam-outline', title: 'hubAvatar', desc: 'hubAvatarDesc', tone: 2, go: () => nav.navigate('Call', { mode: 'video' }) },
  ];

  return (
    <Screen>
      <Hero>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 4, paddingRight: 8 }}>
            <AppText size={24} weight="800" style={{ color: c.onHero }}>{t('hubTitle')}</AppText>
            <AppText size={14} style={{ color: c.onHeroMuted }}>{t('hubIntro')}</AppText>
          </View>
          <Avatar state="idle" size={84} />
        </Row>
        <AppText size={12} style={{ color: c.onHeroMuted }}>{t('chatDisclosure')}</AppText>
      </Hero>

      <Card tone="lavender">
        <Row style={{ gap: 14, alignItems: 'flex-start' }}>
          <IconCircle icon="leaf-outline" tone={1} size={54} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText size={18} weight="800" accessibilityRole="header">{t('sessHubStart')}</AppText>
            <AppText size={14} muted>{t('sessHubStartDesc')}</AppText>
          </View>
        </Row>
        <Button title={t('sessHubStartBtn')} icon="play" onPress={() => nav.navigate('SessionLobby')} />
        <Row style={{ gap: 4, flexWrap: 'wrap' }}>
          <Button title={t('sessText')} variant="ghost" onPress={() => nav.navigate('SessionLobby', { mode: 'text' })} style={{ flex: 1, minWidth: 90 }} />
          <Button title={t('sessVoice')} variant="ghost" onPress={() => nav.navigate('SessionLobby', { mode: 'voice' })} style={{ flex: 1, minWidth: 90 }} />
          <Button title={t('sessVideo')} variant="ghost" onPress={() => nav.navigate('SessionLobby', { mode: 'video' })} style={{ flex: 1, minWidth: 90 }} />
        </Row>
        <ListRow icon="calendar-outline" label={t('sessHubMySessions')} tone={2} onPress={() => nav.navigate('Sessions')} />
      </Card>

      <SectionTitle>{t('sessHubJustTalk')}</SectionTitle>
      <AppText size={14} muted>{t('sessHubJustTalkDesc')}</AppText>
      {options.map((o) => (
        <Pressable key={o.title} accessibilityRole="button" accessibilityLabel={`${t(o.title)}. ${t(o.desc)}`} onPress={o.go}>
          <Card>
            <Row style={{ gap: 14 }}>
              <IconCircle icon={o.icon} tone={o.tone} size={54} />
              <View style={{ flex: 1 }}>
                <AppText size={17} weight="800">{t(o.title)}</AppText>
                <AppText size={14} muted>{t(o.desc)}</AppText>
              </View>
              <Icon name="chevron-forward" size={20} color={c.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ))}

      <SectionTitle>{t('hubRecent')}</SectionTitle>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
        (q.data ?? []).length === 0 ? <EmptyState icon="chatbubbles-outline" body={t('hubNone')} /> :
        q.data!.map((s) => (
          <Pressable key={s.id} accessibilityRole="button" onPress={() => nav.navigate('SessionDetail', { id: s.id })}>
            <Card>
              <Row style={{ gap: 12 }}>
                <IconCircle icon={s.sessionType === 'VOICE' ? 'mic-outline' : 'chatbubble-ellipses-outline'} tone={s.status === 'ACTIVE' ? 0 : 2} size={40} />
                <View style={{ flex: 1 }}>
                  <AppText weight="700">{new Date(s.startedAt).toLocaleDateString()} · {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</AppText>
                  <AppText size={13} muted>{t('messagesCount', { n: s.messageCount ?? 0 })}{s.hasSummary ? ` · ${t('summary')}` : ''} · {s.status === 'ACTIVE' ? t('active') : t('ended')}</AppText>
                </View>
                <Icon name="chevron-forward" size={18} color={c.textMuted} />
              </Row>
            </Card>
          </Pressable>
        ))}
    </Screen>
  );
}
