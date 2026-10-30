import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { api } from '../api/client';
import { DayDots, Garden, type GardenDay, type GardenFlower } from '../components/Garden';
import { AppText, Button, Card, EmptyState, QueryBoundary, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useTheme } from '../theme';

interface GardenData { total: number; days: GardenDay[]; flowers: GardenFlower[] }

export function GardenScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = useQuery({ queryKey: ['kaizen', 'garden'], queryFn: () => api<GardenData>('/kaizen/garden') });
  return (
    <Screen>
      <AppText size={28} weight="800" accessibilityRole="header">{t('jaiGardenTitle')}</AppText>
      <AppText muted>{t('jaiGardenSub')}</AppText>
      <QueryBoundary q={q}>
        {(g) => {
          const buds = g.flowers.filter((f) => f.kind === 'BUD').length;
          const full = g.flowers.filter((f) => f.kind === 'FULL_BLOOM').length;
          const active = g.days.filter((d) => d.count > 0).length;
          return (
            <>
              <Garden flowers={g.flowers} total={g.total} label={t('jaiGardenA11y', { n: g.total })} />
              {g.total === 0 ? (
                <EmptyState icon="flower-outline" title={t('jaiGardenEmptyTitle')} body={t('jaiGardenEmptyBody')}
                  action={<Button title={t('jaiGardenCta')} icon="leaf-outline" onPress={() => nav.navigate('Tabs', { screen: 'KaizenTab' } as never)} />} />
              ) : (
                <Card>
                  <AppText size={18} weight="800" style={{ color: c.primary }}>{g.total === 1 ? t('jaiGardenTotal1') : t('jaiGardenTotal', { n: g.total })}</AppText>
                  <Row style={{ flexWrap: 'wrap', gap: 14 }}>
                    <AppText size={13} muted>{t('jaiGardenBud')}: {buds}</AppText>
                    <AppText size={13} muted>{t('jaiGardenBloom')}: {g.flowers.length - buds - full}</AppText>
                    <AppText size={13} muted>{t('jaiGardenFull')}: {full}</AppText>
                  </Row>
                  <AppText size={13} muted>{t('jaiGardenLegend')}</AppText>
                </Card>
              )}
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <AppText size={14} weight="800">{t('jaiGardenLast90')}</AppText>
                  <AppText size={12} muted>{t('jaiGardenActiveDays', { n: active })}</AppText>
                </Row>
                <DayDots days={g.days} />
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}
