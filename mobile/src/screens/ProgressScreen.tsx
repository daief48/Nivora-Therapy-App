import React, { useState } from 'react';
import { AppText, Screen, Segmented } from '../components/ui';
import { useT } from '../i18n';
import { GoalsPanel } from './GoalsScreen';
import { MoodPanel } from './MoodScreen';

/** Progress tab: user-reported mood/stress over time, and personal goals. */
export function ProgressScreen() {
  const t = useT();
  const [tab, setTab] = useState<'mood' | 'goals'>('mood');
  return (
    <Screen>
      <AppText size={28} weight="800" accessibilityRole="header">{t('progressTitle')}</AppText>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'mood', label: t('segMood') }, { value: 'goals', label: t('segGoals') }]} />
      {tab === 'mood' ? <MoodPanel /> : <GoalsPanel />}
    </Screen>
  );
}
