import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { isDue, pick, useAssessments, useInstruments, type AssessmentRow, type Instrument } from '../api/assessments';
import { LineChart } from '../components/nv';
import { AppText, Button, Card, ErrorState, Loading, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useSettings } from '../store/settings';

/** Screening check-ins: three questionnaires, last result per instrument, a trend of past totals and a monthly retake nudge. */
export function AssessmentsScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const lang = useSettings((s) => s.uiLang);
  const defs = useInstruments();
  const hist = useAssessments();
  if (defs.isLoading || hist.isLoading) return <Screen><Loading /></Screen>;
  if (defs.isError || !defs.data) return <Screen><ErrorState error={defs.error} onRetry={() => { void defs.refetch(); }} /></Screen>;
  const rows = hist.data ?? [];

  return (
    <Screen>
      <AppText size={26} weight="700" accessibilityRole="header">{t('asTitle')}</AppText>
      <AppText muted>{t('asLead')}</AppText>
      {defs.data.map((d) => {
        const mine: AssessmentRow[] = rows.filter((r) => r.instrument === d.id); // newest first
        const last = mine[0];
        const due = isDue(last?.createdAt);
        const name = pick(d.title, lang);
        const points = [...mine].reverse().slice(-12).map((r) => ({ label: new Date(r.createdAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' }), value: r.total }));
        return (
          <Card key={d.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText weight="700" style={{ flex: 1 }} accessibilityRole="header">{name}</AppText>
              {last && due ? <AppText size={13} weight="700" accessibilityLiveRegion="polite">{t('asDue')}</AppText> : null}
            </Row>
            <AppText size={13} muted>{pick(d.timeframe, lang)}</AppText>
            <AppText>
              {last ? t('asLast', { score: last.total, band: t(`asBand${cap(last.severity)}` as never), date: new Date(last.createdAt).toLocaleDateString() }) : t('asNever')}
            </AppText>
            {last && !due ? <AppText size={13} muted>{t('asUpToDate')}</AppText> : null}
            {mine.length >= 2 ? (
              <>
                <AppText size={13} muted>{t('asTrend')}</AppText>
                <LineChart points={points} max={d.maxScore} summary={t('asTrendSummary', { name })} />
              </>
            ) : null}
            <Button title={last ? t('asRetake') : t('asTake')} variant={due ? 'primary' : 'secondary'} onPress={() => nav.navigate('AssessmentTake', { instrument: d.id as Instrument })} />
          </Card>
        );
      })}
      <AppText size={13} muted>{t('asNotDiagnosis')}</AppText>
    </Screen>
  );
}

/** Band keys are snake_case ('moderately_severe'); string keys use a capitalised first letter ('asBandModerately_severe'). */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
