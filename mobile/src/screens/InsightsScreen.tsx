import { useGuideConsent, useGuideFallback, useGuideFeature, useGuideRiskSignal } from '../guide';
import { SupportOptions } from '../components/SupportOptions';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { errorMessageKey, useInvalidatingMutation, useSummary, useTimeline } from '../api/hooks';
import { useMonthlyStory } from '../api/monthly';
import { ConsentRequiredPrompt, consentTypeOf } from '../components/ConsentRequired';
import { MonthStory, PracticeCard } from '../components/MonthStory';
import { WeeklyReportCard } from '../components/WeeklyReportCard';
import { LineChart, StatBlock } from '../components/nv';
import { AppText, Button, Card, EmptyState, ErrorState, QueryBoundary, Row, Screen, Segmented, SectionTitle, Skeleton } from '../components/ui';
import { useStoryT } from '../i18n/storyT';
import { useT, type StringKey } from '../i18n';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';

const fmt = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 10) / 10));

type TagInsights = { overall: { mood: number | null; stress: number | null; energy: number | null }; tags: { tag: string; n: number; mood: number | null; stress: number | null; energy: number | null }[] };

/** Insights: the user's own trends, timeline and an AI observation. Never a diagnosis or a comparison with others. */
export function InsightsScreen() {
  useGuideFeature('insights');
  const t = useT();
  const st = useStoryT();
  const story = useMonthlyStory(30);
  const [consentHidden, setConsentHidden] = useState(false);
  useGuideConsent(consentTypeOf(story.consentError), !!story.consentError && !consentHidden);
  const { c } = useTheme();
  const lang = useSettings((s) => s.uiLang);
  const [days, setDays] = useState<'7' | '14' | '30'>('7');
  const tl = useTimeline(Number(days));
  const sum = useSummary();
  const tagQ = useQuery({ queryKey: ['insightTags', days], queryFn: () => api<TagInsights>(`/insights/tags?days=${Math.max(Number(days), 30)}`) });
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisAi, setAnalysisAi] = useState<boolean | undefined>(undefined);
  useGuideFallback('analysis', analysisAi);
  const [analysisRisk, setAnalysisRisk] = useState(false);
  useGuideRiskSignal('analysis', analysisRisk);
  const ask = useInvalidatingMutation(() => api<{ text: string }>('/insights/analysis', { method: 'POST' }), []);
  const label = (d: string) => d.slice(5);
  const icon = (s: string | null) => (s === 'DONE' || s === 'PARTIAL' ? '✓' : s === 'SKIPPED' ? '·' : '–');

  return (
    <Screen>
      <AppText size={26} weight="800" accessibilityRole="header">{t('inTitle')}</AppText>
      <AppText size={13} muted>{t('inOwn')}</AppText>

      <WeeklyReportCard />

      <SectionTitle>{st('stTitle')}</SectionTitle>
      <AppText size={13} muted>{st('stSub')}</AppText>
      {story.isLoading ? <Skeleton height={260} /> : story.isError ? <ErrorState error={story.error} onRetry={() => story.refetch()} /> : story.data ? (
        story.data.enough ? (
          <>
            {story.consentError && !consentHidden ? (
              <>
                <AppText size={13} muted>{st('stConsentNote')}</AppText>
                <ConsentRequiredPrompt error={story.consentError} onGranted={() => story.refetchAi()} onDismiss={() => setConsentHidden(true)} />
              </>
            ) : null}
            <MonthStory data={story.data} />
          </>
        ) : (
          <>
            <EmptyState icon="flower-outline" title={st('stNoDataTitle')} body={st('stNoDataBody', { logged: story.data.daysLogged, need: story.data.minDaysRequired })} />
            {story.data.practice && story.data.practice.total > 0 ? <Card><PracticeCard practice={story.data.practice} /></Card> : null}
          </>
        )
      ) : null}

      <QueryBoundary q={sum}>
        {(s) => (
          <>
            <Row style={{ gap: 10, alignItems: 'stretch' }}>
              <StatBlock label={t('mood')} value={fmt(s.mood.avg)} change={s.mood.change} good="up" icon="happy-outline" />
              <StatBlock label={t('stress')} value={fmt(s.stress.avg)} change={s.stress.change} good="down" icon="pulse-outline" />
              <StatBlock label={t('energy')} value={fmt(s.energy.avg)} change={s.energy.change} good="up" icon="flash-outline" />
            </Row>
            <Row style={{ gap: 10, alignItems: 'stretch' }}>
              <StatBlock label={t('sleepScore')} value={fmt(s.sleep.avgScore)} change={s.sleep.change} good="up" icon="bed-outline" />
              <StatBlock label={t('inCheckIns')} value={String(s.checkInsLast7)} icon="checkmark-circle-outline" />
              <StatBlock label={t('inKaizenDone')} value={`${s.kaizen.doneLast7}/7`} change={s.kaizen.doneLast7 - s.kaizen.donePrev7} good="up" icon="leaf-outline" />
            </Row>
            <AppText size={11} muted>{t('inBetter')} · {t('inLowerBetter')}</AppText>
          </>
        )}
      </QueryBoundary>

      <Segmented value={days} onChange={setDays} options={(['7', '14', '30'] as const).map((d) => ({ value: d, label: t('inRange', { n: d }) }))} />

      <QueryBoundary q={tl}>
        {(rows) => {
          const has = rows.some((r) => r.mood != null || r.sleepScore != null);
          if (!has) return <EmptyState icon="analytics-outline" body={t('inNoData')} />;
          const series = (k: 'mood' | 'stress' | 'energy' | 'sleepScore') => rows.map((r) => ({ label: label(r.date), value: r[k] }));
          const sm = (k: 'mood' | 'stress' | 'energy' | 'sleepScore') => rows.map((r) => `${r.date}: ${r[k] ?? '-'}`).join(', ');
          return (
            <>
              <SectionTitle>{t('inTrends')}</SectionTitle>
              <Card style={{ gap: 6 }}>
                <AppText weight="700" style={{ color: c.primary }}>{t('mood')}</AppText>
                <LineChart points={series('mood')} color={c.primary} summary={sm('mood')} />
                <AppText weight="700" style={{ color: c.tintFg[3] }}>{t('stress')}</AppText>
                <LineChart points={series('stress')} color={c.tintFg[3]} summary={sm('stress')} />
                <AppText weight="700" style={{ color: c.accent }}>{t('sleepScore')}</AppText>
                <LineChart points={series('sleepScore')} max={100} color={c.accent} summary={sm('sleepScore')} />
              </Card>

              <SectionTitle>{t('inTimeline')}</SectionTitle>
              <Card style={{ gap: 10 }}>
                {[...rows].reverse().slice(0, 14).map((r) => (
                  <Row key={r.date} style={{ justifyContent: 'space-between' }}>
                    <AppText size={13} weight="700" style={{ width: 64 }}>{new Date(`${r.date}T12:00:00`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : lang === 'hi' ? 'hi-IN' : lang === 'ne' ? 'ne-NP' : undefined, { weekday: 'short', day: 'numeric' })}</AppText>
                    <AppText size={13} muted style={{ flex: 1 }}>
                      {t('mood')} {r.mood ?? '–'} · {t('stress')} {r.stress ?? '–'} · {t('lastSleep')} {r.sleepScore ?? '–'}
                    </AppText>
                    <AppText size={15} weight="800" style={{ color: r.kaizen === 'DONE' || r.kaizen === 'PARTIAL' ? c.success : c.textMuted }}>{icon(r.kaizen)}</AppText>
                  </Row>
                ))}
              </Card>
            </>
          );
        }}
      </QueryBoundary>

      <SectionTitle>{t('insTagsTitle')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        <AppText size={12} muted>{t('insTagsSub')}</AppText>
        {!tagQ.data ? (tagQ.isLoading ? null : <AppText size={13} muted>{t('insTagsEmpty')}</AppText>) : tagQ.data.tags.length === 0 ? (
          <AppText size={13} muted>{t('insTagsEmpty')}</AppText>
        ) : tagQ.data.tags.map((x) => (
          <View key={x.tag} style={{ gap: 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText weight="700">{t(`insTag_${x.tag}` as StringKey)}</AppText>
              <AppText size={12} muted>{t('insTagN', { n: x.n })}</AppText>
            </Row>
            <AppText size={13} muted>
              {t('mood')} {fmt(x.mood)} ({t('insTagVsAll', { v: fmt(tagQ.data!.overall.mood) })}) · {t('stress')} {fmt(x.stress)} ({fmt(tagQ.data!.overall.stress)}) · {t('energy')} {fmt(x.energy)} ({fmt(tagQ.data!.overall.energy)})
            </AppText>
          </View>
        ))}
      </Card>

      <SectionTitle>{t('inAnalysis')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        {analysis && !analysisRisk ? <AppText>{analysis}</AppText> : null}
        {analysisRisk ? <SupportOptions /> : null}
        {ask.isError ? <AppText style={{ color: c.danger }}>{t(errorMessageKey(ask.error))}</AppText> : null}
        <Button title={t('inAnalysisAsk')} variant="secondary" icon="sparkles-outline" loading={ask.isPending}
          onPress={() => ask.mutate(undefined, { onSuccess: (r) => { const risk = !!(r as { riskMode?: boolean }).riskMode; setAnalysisRisk(risk); setAnalysis(risk ? null : (r as { text: string }).text); setAnalysisAi(risk ? undefined : (r as { ai?: boolean }).ai); } })} />
        <View><AppText size={11} muted>{t('aiGeneratedLabel')}</AppText></View>
      </Card>
    </Screen>
  );
}
