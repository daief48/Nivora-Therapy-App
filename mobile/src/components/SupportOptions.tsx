import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { View } from 'react-native';
import { useFeedT } from '../i18n/feedT';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { AppText, Button, Card } from './ui';

/**
 * Shown in place of any task, step or suggestion when the server reports riskMode: calm words, Emergency help and the Safety plan
 * (where trusted people live). Never a task, never dismissible away from Emergency.
 */
export function SupportOptions() {
  const t = useT();
  const f = useFeedT();
  const nav = useNavigation<Nav>();
  return (
    <View testID="support-options"><Card tone="lavender" style={{ gap: 10 }}>
      <AppText size={14}>{f('fdSupportIntro')}</AppText>
      <Button title={t('emergency')} icon="medkit-outline" variant="danger" onPress={() => nav.navigate('Emergency')} style={{ minHeight: 44 }} />
      <Button title={t('asItem9Plan')} variant="secondary" onPress={() => nav.navigate('SafetyPlan')} style={{ minHeight: 44 }} />
    </Card></View>
  );
}
