import React, { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation, useMe, useMemories } from '../api/hooks';
import { AppText, Button, Card, Check, EmptyState, Field, Icon, QueryBoundary, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import { useTheme } from '../theme';

/** What Nivora remembers: only what the user added, switchable and deletable at any time. */
export function MemoryScreen() {
  const t = useT();
  const { c } = useTheme();
  const me = useMe();
  const q = useMemories();
  const [text, setText] = useState('');
  const add = useInvalidatingMutation((v: string) => api('/memories', { method: 'POST', body: { text: v } }), [['memories']]);
  const del = useInvalidatingMutation((id: string) => api(`/memories/${id}`, { method: 'DELETE' }), [['memories']]);
  const delAll = useInvalidatingMutation(() => api('/memories', { method: 'DELETE' }), [['memories']]);
  const toggle = useInvalidatingMutation((on: boolean) => api('/me', { method: 'PATCH', body: { preferences: { ...(me.data?.preferences ?? {}), memoryEnabled: on } } }), [['me']]);
  const enabled = me.data?.preferences?.memoryEnabled !== false;

  return (
    <Screen>
      <AppText muted>{t('memIntro')}</AppText>
      <Card><Check checked={enabled} onToggle={() => toggle.mutate(!enabled)} label={t('memEnabled')} /></Card>
      <Field value={text} onChangeText={setText} placeholder={t('memPlaceholder')} maxLength={300} accessibilityLabel={t('memAdd')} />
      <Button title={t('memAdd')} icon="bookmark-outline" disabled={!text.trim()} loading={add.isPending} onPress={() => add.mutate(text.trim(), { onSuccess: () => setText('') })} />
      <QueryBoundary q={q}>
        {(list) => (list.length === 0 ? <EmptyState icon="bookmark-outline" body={t('memEmpty')} /> : (
          <>
            {list.map((m) => (
              <Card key={m.id}>
                <Row style={{ gap: 12 }}>
                  <AppText style={{ flex: 1 }}>{m.text}</AppText>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('delete')} hitSlop={10} onPress={() => del.mutate(m.id)}><Icon name="trash-outline" size={20} color={c.danger} /></Pressable>
                </Row>
              </Card>
            ))}
            <Button title={t('memDeleteAll')} variant="ghost" icon="trash-outline"
              onPress={() => Alert.alert(t('memDeleteAll'), undefined, [{ text: t('cancel'), style: 'cancel' }, { text: t('delete'), style: 'destructive', onPress: () => delAll.mutate(undefined) }])} />
          </>
        ))}
      </QueryBoundary>
    </Screen>
  );
}
