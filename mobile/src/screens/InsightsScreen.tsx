import React, { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { errorMessageKey, useInvalidatingMutation, useSummary, useTimeline } from '../api/hooks';
import { LineChart, StatBlock } from '../components/nv';
import { AppText, Button, Card, EmptyState, QueryBoundary, Row, Screen, Segmented, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';

const fmt = (n: number | null | undefined) => (n == null ? '–' : String(Math.round(n * 10) / 10));

/** Insights: the user's own trends, timeline and an AI observation. Never a diagnosis or a comparison with others. */
export function InsightsScreen() {
  const t = useT();
  const { c } = useTheme();
  const lang = useSettings((s) => s.uiLang);
  const [days, setDays] = useState<'7' | '14' | '30'>('7');
  const tl = useTimeline(Number(days));
  const sum = useSummary();
  const [analysis, setAnalysis] = useState<string | null>(null);
  const ask = useInvalidatingMutation(() => api<{ text: string }>('/insights/analysis', { method: 'POST' }), []);
  const label = (d: string) => d.slice(5);
  const icon = (s: string | null) => (s === 'DONE' || s === 'PARTIAL' ? '✓' : s === 'SKIPPED' ? '·' : '–');

  return (
    <Screen>
      <AppText size={26} weight="800" accessibilityRole="header">{t('inTitle')}</AppText>
      <AppText size={13} muted>{t('inOwn')}</AppText>

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
                    <AppText size={13} weight="700" style={{ width: 64 }}>{new Date(`${r.date}T12:00:00`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : undefined, { weekday: 'short', day: 'numeric' })}</AppText>
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

      <SectionTitle>{t('inAnalysis')}</SectionTitle>
      <Card style={{ gap: 10 }}>
        {analysis ? <AppText>{analysis}</AppText> : null}
        {ask.isError ? <AppText style={{ color: c.danger }}>{t(errorMessageKey(ask.error))}</AppText> : null}
        <Button title={t('inAnalysisAsk')} variant="secondary" icon="sparkles-outline" loading={ask.isPending}
          onPress={() => ask.mutate(undefined, { onSuccess: (r) => setAnalysis((r as { text: string }).text) })} />
        <View><AppText size={11} muted>{t('aiGeneratedLabel')}</AppText></View>
      </Card>
    </Screen>
  );
}
