import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Card, Icon, IconCircle, Row, Screen, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { ExerciseKind, Nav } from '../navigation/types';

const ITEMS: { kind: ExerciseKind; title: StringKey; desc: StringKey; icon: IconName }[] = [
  { kind: 'thought', title: 'actThought', desc: 'actThoughtDesc', icon: 'bulb-outline' },
  { kind: 'balanced', title: 'actBalanced', desc: 'actBalancedDesc', icon: 'scale-outline' },
  { kind: 'grounding', title: 'actGrounding', desc: 'actGroundingDesc', icon: 'hand-left-outline' },
  { kind: 'breathing', title: 'actBreathing', desc: 'actBreathingDesc', icon: 'leaf-outline' },
  { kind: 'gratitude', title: 'actGratitude', desc: 'actGratitudeDesc', icon: 'heart-outline' },
  { kind: 'daily', title: 'actDaily', desc: 'actDailyDesc', icon: 'document-text-outline' },
  { kind: 'sleep', title: 'actSleep', desc: 'actSleepDesc', icon: 'moon-outline' },
  { kind: 'goal', title: 'actGoal', desc: 'actGoalDesc', icon: 'flag-outline' },
  { kind: 'next', title: 'actNext', desc: 'actNextDesc', icon: 'footsteps-outline' },
];

export function ActivitiesScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  return (
    <Screen>
      <AppText size={28} weight="800">{t('wellnessTitle')}</AppText>
      <AppText muted>{t('wellnessIntro')}</AppText>
      {ITEMS.map((i, idx) => (
        <Pressable key={i.kind} accessibilityRole="button" accessibilityLabel={`${t(i.title)}. ${t(i.desc)}`} onPress={() => nav.navigate('Exercise', { kind: i.kind })}>
          <Card>
            <Row style={{ gap: 14 }}>
              <IconCircle icon={i.icon} tone={(idx % 4) as 0 | 1 | 2 | 3} size={52} />
              <View style={{ flex: 1 }}>
                <AppText size={17} weight="800">{t(i.title)}</AppText>
                <AppText muted size={14}>{t(i.desc)}</AppText>
              </View>
              <Icon name="chevron-forward" size={20} />
            </Row>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
