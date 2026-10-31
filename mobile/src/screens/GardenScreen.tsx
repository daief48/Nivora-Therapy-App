import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { useGarden } from '../api/monthly';
import { useStoryT, type StoryKey } from '../i18n/storyT';
import { FadeInUp } from '../motion';
import { asSeason } from '../utils/shareCard';
import { DayDots, Garden } from '../components/Garden';
import { AppText, Button, Card, EmptyState, QueryBoundary, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useTheme } from '../theme';

const SEEN_KEY = 'nivora.garden.seenTotal';

/** Last total the person saw, stored locally. Only ever moves up, so flowers never "decrease". */
async function readSeen(): Promise<number | null> {
  try { const v = await AsyncStorage.getItem(SEEN_KEY); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null; } catch { return null; }
}
async function writeSeen(n: number) { try { await AsyncStorage.setItem(SEEN_KEY, String(n)); } catch { /* optional */ } }

/** How many flowers opened since the last visit (0 on the very first visit, and never negative). */
export function useNewBlooms(total: number | undefined): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (total == null) return;
    let live = true;
    (async () => {
      const seen = await readSeen();
      if (live && seen != null && total > seen) setN(total - seen);
      await writeSeen(Math.max(seen ?? 0, total));
    })();
    return () => { live = false; };
  }, [total]);
  return n;
}

export function GardenScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const st = useStoryT();
  const q = useGarden();
  const fresh = useNewBlooms(q.data?.total);
  return (
    <Screen>
      <AppText size={28} weight="800" accessibilityRole="header">{t('jaiGardenTitle')}</AppText>
      <AppText muted>{t('jaiGardenSub')}</AppText>
      <QueryBoundary q={q}>
        {(g) => {
          const buds = g.flowers.filter((f) => f.kind === 'BUD').length;
          const full = g.flowers.filter((f) => f.kind === 'FULL_BLOOM').length;
          const season = asSeason(g.season);
          const seasonName = st(`stSeason_${season}` as StoryKey);
          const active = g.days.filter((d) => d.count > 0).length;
          return (
            <>
              {fresh > 0 ? <FadeInUp><AppText size={15} weight="700" style={{ color: c.primary }} accessibilityLiveRegion="polite">{fresh === 1 ? st('stGardenNew1') : st('stGardenNewN', { n: fresh })}</AppText></FadeInUp> : null}
              <Garden flowers={g.flowers} total={g.total} season={season} newCount={fresh} label={st('stGardenA11y', { season: seasonName, n: g.total })} />
              <AppText size={12} muted>{st('stGardenSeason', { s: g.seasonLabel || seasonName })} · {st('stGardenSeasonNote')}</AppText>
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
