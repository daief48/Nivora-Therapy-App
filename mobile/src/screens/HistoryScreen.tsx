import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React from 'react';
import { Alert } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation, useSession, useSessions } from '../api/hooks';
import { MessageBubble } from '../components/MessageBubble';
import { AppText, Button, Card, EmptyState, ErrorState, Loading, QueryBoundary, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useQuery } from '@tanstack/react-query';

export function HistoryScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const q = useSessions(100);
  return (
    <Screen>
      <AppText size={13} muted>{t('retention')}</AppText>
      <QueryBoundary q={q}>
        {(rows) => rows.length === 0 ? <EmptyState body={t('noSessions')} /> : (
          <>
            {rows.map((s) => (
              <Card key={s.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <AppText weight="700">{new Date(s.startedAt).toLocaleString()}</AppText>
                  <AppText size={13} muted>{s.status === 'ACTIVE' ? t('active') : t('ended')}</AppText>
                </Row>
                <AppText size={13} muted>{t('messagesCount', { n: s.messageCount ?? 0 })}{s.hasSummary ? ` · ${t('summary')}` : ''}</AppText>
                <Button title={t('viewAll')} variant="secondary" onPress={() => nav.navigate('SessionDetail', { id: s.id })} />
              </Card>
            ))}
          </>
        )}
      </QueryBoundary>
    </Screen>
  );
}

export function SessionDetailScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const { id } = useRoute<RouteProp<RootParams, 'SessionDetail'>>().params;
  const q = useSession(id);
  const summary = useQuery({ queryKey: ['summary', id], retry: false, queryFn: () => api<{ summary: string }>(`/sessions/${id}/summary`) });
  const del = useInvalidatingMutation(() => api(`/sessions/${id}`, { method: 'DELETE' }), [['sessions']]);
  const confirmDelete = () => Alert.alert(t('deleteSession'), t('clearConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete'), style: 'destructive', onPress: () => { del.mutateAsync(undefined as never).then(() => nav.goBack()).catch(() => Alert.alert(t('errorTitle'))); } },
  ]);
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !q.data) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const s = q.data;
  return (
    <Screen>
      <Card tone="lavender">
        <AppText weight="700">{t('summary')} · {t('aiGeneratedLabel')}</AppText>
        {summary.isLoading ? <Loading /> : summary.data ? <AppText selectable>{summary.data.summary}</AppText> : <AppText muted>{t('noSummary')}</AppText>}
      </Card>
      {s.messages.map((m) => <MessageBubble key={m.id} m={m} />)}
      {s.status === 'ACTIVE' ? <Button title={t('resume')} onPress={() => s.sessionType === 'VOICE' ? nav.navigate('Call', { mode: 'voice', sessionId: s.id }) : nav.navigate('Chat', { sessionId: s.id })} /> : null}
      <Button title={t('deleteSession')} variant="danger" onPress={confirmDelete} loading={del.isPending} />
    </Screen>
  );
}
