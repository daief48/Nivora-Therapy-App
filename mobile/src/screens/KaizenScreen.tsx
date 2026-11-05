import { useGuideFeature, useGuideRiskSignal } from '../guide';
import React, { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Field, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useTheme } from '../theme';
import { TaskCard } from '../components/kaizen/TaskCard';
import { GoalCard } from '../components/kaizen/GoalCard';
import { api } from '../api/client';
import { errorMessageKey, NIVORA_KEYS, useInvalidatingMutation, useUserGoal } from '../api/hooks';

/**
 * Kaizen — one simple screen with two fully separate blocks:
 *  - "Your task" (Feature A): the single small task a therapy session may have suggested.
 *  - "Your goal" (Feature B): the user's own goal, split by the AI into small tasks, with a
 *    progress score. This block never touches therapy session data.
 */
export function KaizenScreen() {
  useGuideFeature('kaizen');
  const t = useT();
  const { c } = useTheme();
  useGuideRiskSignal('kaizen', false);

  return (
    <Screen>
      {/* ── Feature A: the one therapy-given task ── */}
      <SectionTitle>{t('kzTaskSection')}</SectionTitle>
      <TaskCard />

      {/* ── Feature B: the user's own goal (never session data) ── */}
      <UserGoalBlock />

      <AppText size={12} muted style={{ textAlign: 'center', color: c.textMuted }}>{t('kzArchivedNotice')}</AppText>
    </Screen>
  );
}

function UserGoalBlock() {
  const t = useT();
  const goal = useUserGoal();
  if (goal.isLoading) return null;
  return (
    <View style={{ gap: 8 }}>
      <SectionTitle>{t('kzGoalSection')}</SectionTitle>
      {goal.data ? <GoalCard goal={goal.data} /> : <GoalStart />}
    </View>
  );
}

/** The calm start field: one line about what to work toward; the AI splits it into small steps. */
function GoalStart() {
  const t = useT();
  const { c } = useTheme();
  const [title, setTitle] = useState('');
  const create = useInvalidatingMutation((v: { title: string }) => api('/kaizen/goal', { method: 'POST', body: v }), NIVORA_KEYS);
  return (
    <Card style={{ gap: 10 }}>
      <AppText weight="700">{t('kzGoalStartTitle')}</AppText>
      <AppText size={13} muted>{t('kzGoalStartBody')}</AppText>
      <Field
        label={t('kzGoalTitleLabel')}
        value={title}
        onChangeText={setTitle}
        placeholder={t('kzGoalTitlePlaceholder')}
        maxLength={120}
      />
      <Button
        title={create.isPending ? t('kzGoalSplitting') : t('kzGoalSplitBtn')}
        icon="leaf-outline"
        disabled={!title.trim() || create.isPending}
        loading={create.isPending}
        onPress={() => create.mutate({ title: title.trim() })}
      />
      {create.isError ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{t(errorMessageKey(create.error))}</AppText> : null}
      <AppText size={12} muted>{t('kzGoalStartHint')}</AppText>
    </Card>
  );
}
