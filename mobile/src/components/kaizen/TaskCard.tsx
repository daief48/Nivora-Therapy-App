/**
 * TaskCard — Feature A: the ONE small task a therapy session may have suggested.
 * No duration, no deadline: just the task, why it fits, and two gentle actions
 * (Done / Can't today). An empty state is normal and healthy.
 */
import React from 'react';
import { View } from 'react-native';
import { api } from '../../api/client';
import { NIVORA_KEYS, useInvalidatingMutation, useKaizenTask } from '../../api/hooks';
import { AppText, Button, Card, Row } from '../ui';
import { useT } from '../../i18n';
import { SupportOptions } from '../SupportOptions';

export function TaskCard() {
  const t = useT();
  const q = useKaizenTask();

  if (q.isLoading) return null;
  const data = q.data;
  if (!data || data.riskMode) return data?.riskMode ? <SupportOptions /> : null;

  const task = data.task;
  if (!task) {
    return (
      <Card style={{ gap: 6 }} accessibilityLabel={t('kzTaskEmptyA11y')}>
        <AppText weight="700">{t('kzTaskEmptyTitle')}</AppText>
        <AppText size={13} muted>{t('kzTaskEmptyBody')}</AppText>
      </Card>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Card style={{ gap: 8 }} accessibilityLabel={t('kzTaskA11y', { content: task.content ?? '' })}>
        {task.standingStill ? <AppText size={12} muted>{t('kzTaskStandingNote')}</AppText> : null}
        <AppText size={17} weight="800">{task.content}</AppText>
        {task.reason ? <AppText size={13} muted>{task.reason}</AppText> : null}
        {task.stateNote ? <AppText size={12} muted>{t('kzTaskLastCheck', { note: task.stateNote })}</AppText> : null}
        <TaskActions taskId={task.id} />
      </Card>
      {data.history.length ? (
        <AppText size={12} muted>{t('kzTaskHistory', { n: data.history.length })}</AppText>
      ) : null}
    </View>
  );
}

function TaskActions({ taskId }: { taskId: string }) {
  const t = useT();
  const done = useInvalidatingMutation((note?: string) => api(`/kaizen/task/${taskId}/complete`, { method: 'POST', body: { note } }), NIVORA_KEYS);
  const react = useInvalidatingMutation(() => api(`/kaizen/task/${taskId}/react`, { method: 'POST', body: {} }), NIVORA_KEYS);
  return (
    <Row style={{ gap: 10 }}>
      <Button title={t('kzTaskDone')} icon="checkmark" style={{ flex: 1 }} loading={done.isPending}
        onPress={() => done.mutate(undefined)} accessibilityLabel={t('kzTaskDoneA11y')} />
      <Button title={t('kzTaskNotToday')} variant="ghost" style={{ flex: 1 }} loading={react.isPending}
        onPress={() => react.mutate(undefined)} accessibilityLabel={t('kzTaskNotTodayA11y')} />
    </Row>
  );
}
