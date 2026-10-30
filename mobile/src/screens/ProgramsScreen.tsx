import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation } from '../api/hooks';
import { AppText, Button, Card, IconCircle, ProgressBar, Row, Screen, Skeleton } from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';

export interface ProgramSummary {
  id: string; days: number; title: string; description: string; safety: string; enrolled: boolean; status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | null;
  completedDays: number[]; completedCount: number; unlockedDay: number; nextDay: number | null;
}
export const usePrograms = () => useQuery({ queryKey: ['programs'], queryFn: () => api<ProgramSummary[]>('/programs') });
const ICONS = { 'stress-7': 'leaf-outline', 'anxiety-14': 'flower-outline', 'cbti-21': 'moon-outline' } as const;

export function ProgramsScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const q = usePrograms();
  const enroll = useInvalidatingMutation((id: string) => api<ProgramSummary>(`/programs/${id}/enroll`, { method: 'POST' }), [['programs']]);

  const open = async (p: ProgramSummary) => {
    try {
      if (!p.enrolled || p.status === 'PAUSED') await enroll.mutateAsync(p.id);
      nav.navigate('ProgramDay', { programId: p.id, day: p.status === 'COMPLETED' ? 1 : Math.min(p.nextDay ?? 1, Math.max(1, p.unlockedDay)) });
    } catch { /* the load-error state below stays out of the way; the user can simply press again */ }
  };

  return (
    <Screen>
      <AppText size={26} weight="800" accessibilityRole="header">{t('progTitle')}</AppText>
      <AppText muted size={14}>{t('progIntro')}</AppText>
      <Card tone="lavender"><AppText size={13}>{t('progDisclaimer')}</AppText></Card>
      {q.isLoading ? <><Skeleton height={140} /><Skeleton height={140} /></> : null}
      {q.isError ? (
        <Card><AppText>{t('progLoadError')}</AppText><Button title={t('progRetry')} variant="secondary" onPress={() => q.refetch()} /></Card>
      ) : null}
      {q.data?.map((p) => {
        const done = p.status === 'COMPLETED';
        const label = !p.enrolled ? t('progStart') : done ? t('progReview') : p.status === 'PAUSED' ? t('progResume') : t('progContinue');
        return (
          <Card key={p.id}>
            <Row style={{ gap: 14, alignItems: 'flex-start' }}>
              <IconCircle icon={ICONS[p.id as keyof typeof ICONS] ?? 'leaf-outline'} tone={0} size={48} />
              <View style={{ flex: 1, gap: 4 }}>
                <AppText size={18} weight="800" accessibilityRole="header">{p.title}</AppText>
                <AppText muted size={13}>{t('progDaysCount', { n: p.days })}{p.status === 'PAUSED' ? ` · ${t('progPaused')}` : done ? ` · ${t('progDoneBadge')}` : ''}</AppText>
              </View>
            </Row>
            <AppText size={14}>{p.description}</AppText>
            {p.enrolled ? (
              <View style={{ gap: 6 }}>
                <ProgressBar value={p.completedCount} max={p.days} label={t('progProgress', { done: p.completedCount, total: p.days })} />
                <AppText muted size={12}>{t('progProgress', { done: p.completedCount, total: p.days })}</AppText>
              </View>
            ) : null}
            <Button title={label} onPress={() => open(p)} loading={enroll.isPending && enroll.variables === p.id} variant={p.enrolled ? 'secondary' : 'primary'} />
          </Card>
        );
      })}
    </Screen>
  );
}
