/**
 * KaizenProgramsSection — Guided Programs tab content inside Kaizen.
 * Features:
 *  - Companion Avatar hero with animated TypeWriter speech bubble
 *  - Safety disclaimer
 *  - Staggered animated list of 3 CBT guided programmes
 */
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useInvalidatingMutation } from '../../api/hooks';
import { useT } from '../../i18n';
import { FadeInUp } from '../../motion/FadeInUp';
import { TypeWriter } from '../../motion/TypeWriter';
import type { Nav } from '../../navigation/types';
import { usePrograms, type ProgramSummary } from '../../screens/ProgramsScreen';
import { radius, space, useTheme } from '../../theme';
import { AvatarMini } from '../Avatar';
import { AppText, Card, Hero, Row, Skeleton } from '../ui';
import { ProgramCard } from './ProgramCard';

export function KaizenProgramsSection() {
  const { c, isDark } = useTheme();
  const t = useT();
  const nav = useNavigation<Nav>();
  const q = usePrograms();
  const enroll = useInvalidatingMutation(
    (id: string) => api<ProgramSummary>(`/programs/${id}/enroll`, { method: 'POST' }),
    [['programs']],
  );

  const openProgram = async (p: ProgramSummary) => {
    try {
      if (!p.enrolled || p.status === 'PAUSED') {
        await enroll.mutateAsync(p.id);
      }
      nav.navigate('ProgramDay', {
        programId: p.id,
        day: p.status === 'COMPLETED' ? 1 : Math.min(p.nextDay ?? 1, Math.max(1, p.unlockedDay)),
      });
    } catch {
      // Quiet fallback: navigation attempt on error
      nav.navigate('ProgramDay', { programId: p.id, day: 1 });
    }
  };

  return (
    <View style={styles.container}>
      {/* Hero with Nivora Avatar & TypeWriter bubble */}
      <FadeInUp delay={0}>
        <Hero style={styles.heroCard}>
          <Row style={styles.avatarRow}>
            <View style={styles.avatarContainer}>
              <AvatarMini size={54} />
            </View>
            <View style={[styles.bubble, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }]}>
              <TypeWriter
                text={t('kzAvatarQuote')}
                speed={35}
                slow
                style={[styles.quoteText, { color: c.onHero }]}
              />
            </View>
          </Row>

          <View style={styles.heroTextCol}>
            <AppText size={22} weight="800" style={{ color: c.onHero }}>
              {t('progTitle')}
            </AppText>
            <AppText size={13} style={{ color: c.onHeroMuted, lineHeight: 19 }}>
              {t('progIntro')}
            </AppText>
          </View>
        </Hero>
      </FadeInUp>

      {/* Safety disclaimer */}
      <FadeInUp delay={80}>
        <Card tone="lavender" style={styles.disclaimerCard}>
          <AppText size={12} style={styles.disclaimerText}>
            {t('progDisclaimer')}
          </AppText>
        </Card>
      </FadeInUp>

      {/* Loading Skeletons */}
      {q.isLoading ? (
        <View style={styles.skeletonCol}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </View>
      ) : null}

      {/* Programs List */}
      {q.data?.map((p, idx) => (
        <FadeInUp key={p.id} delay={120 + idx * 60}>
          <ProgramCard
            program={p}
            onOpen={() => openProgram(p)}
            loading={enroll.isPending && enroll.variables === p.id}
          />
        </FadeInUp>
      ))}
    </View>
  );
}

// Needed for the api call inside enroll mutation
import { api } from '../../api/client';

const styles = StyleSheet.create({
  container: {
    gap: space.md,
  },
  heroCard: {
    padding: 18,
    gap: 14,
  },
  avatarRow: {
    gap: 12,
    alignItems: 'center',
  },
  avatarContainer: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    overflow: 'hidden',
  },
  bubble: {
    flex: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quoteText: {
    fontSize: 13,
    lineHeight: 18,
  },
  heroTextCol: {
    gap: 4,
  },
  disclaimerCard: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  disclaimerText: {
    lineHeight: 17,
  },
  skeletonCol: {
    gap: space.md,
  },
});

