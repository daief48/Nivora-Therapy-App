import { useGuideConsent, useGuideFallback, useGuideFeature, useGuideSuppress, useGuideRiskSignal } from '../guide';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useCreateWeeklyReport, useStoredWeeklyReport, type WeeklyReport } from '../api/weeklyReport';
import { useFeedT } from '../i18n/feedT';
import { ActionCard } from './ActionCard';
import { AiBadge } from './AiBadge';
import { ConsentRequiredPrompt, consentTypeOf, isConsentRequired } from './ConsentRequired';
import { AppText, Button, Card, Skeleton } from './ui';

function StatsRow({ report }: { report: WeeklyReport }) {
  const f = useFeedT();
  const s = report.stats;
  if (!s) return null;
  const lines = [
    s.kaizenTotal > 0 ? f('fdWeekStatKaizen', { done: s.kaizenDone, total: s.kaizenTotal }) : null,
    s.sleepNights > 0 ? f('fdWeekStatSleep', { n: s.sleepNights }) : null,
    s.moodDays > 0 ? f('fdWeekStatMood', { n: s.moodDays }) : null,
  ].filter(Boolean) as string[];
  if (!lines.length) return null;
  return (
    <View style={{ gap: 2 }} testID="week-stats">
      {lines.map((l) => <AppText key={l} size={13} muted>{l}</AppText>)}
      <AppText size={11} muted>{f('fdWeekOwn')}</AppText>
    </View>
  );
}

/**
 * "Your week": one combined, gently worded summary (Kaizen, sleep, mood) with an AI badge when the model phrased it.
 * Reads the stored report without the model; creating or refreshing needs WELLNESS_AI_SHARING and asks for it kindly.
 * With risk signals it shows only support options: no refresh, no next step.
 */
export function WeeklyReportCard() {
  useGuideFeature('week');
  const f = useFeedT();
  const stored = useStoredWeeklyReport();
  const create = useCreateWeeklyReport();
  const [declined, setDeclined] = useState(false);
  const report = create.data ?? stored.data ?? null;
  const consentErr = create.isError && isConsentRequired(create.error) ? create.error : null;
  useGuideConsent(consentTypeOf(consentErr), !!consentErr);
  useGuideFallback('weeklyReport', report?.ai);
  useGuideSuppress('risk', !!report?.riskMode);
  useGuideRiskSignal('weekly', !!report?.riskMode);
  const otherErr = create.isError && !consentErr;
  const risk = !!report?.riskMode;

  const run = (force?: boolean) => { setDeclined(false); create.mutate(force); };

  return (
    <Card style={{ gap: 10 }}>
      <AppText size={20} weight="800" accessibilityRole="header">{f('fdWeekTitle')}</AppText>

      {stored.isLoading && !report ? <Skeleton height={90} /> : null}

      {report ? (
        <>
          {report.headline ? <AppText size={17} weight="800" testID="week-headline">{report.headline}</AppText> : null}
          {report.text ? <AppText>{report.text}</AppText> : null}
          <AiBadge ai={report.ai} />
          {report.cached && !risk ? <AppText size={12} muted>{f('fdWeekSaved')}</AppText> : null}
          {!risk ? <StatsRow report={report} /> : null}
          {risk ? <AppText size={13} muted>{f('fdWeekSupportIntro')}</AppText> : null}
          {!risk && report.nextStep ? <ActionCard card={report.nextStep} compact /> : null}
          {report.support.map((s) => <ActionCard key={s.id} card={s} />)}
        </>
      ) : !stored.isLoading && !consentErr && !declined ? (
        <AppText size={14} muted>{stored.isError ? f('fdWeekError') : f('fdWeekEmpty')}</AppText>
      ) : null}

      {consentErr && !declined ? (
        <ConsentRequiredPrompt error={consentErr} onGranted={() => run(!!report)} onDismiss={() => { setDeclined(true); create.reset(); }} />
      ) : null}
      {declined ? <AppText size={13} muted accessibilityRole="alert">{f('fdWeekDeclined')}</AppText> : null}
      {otherErr ? <AppText size={13} accessibilityRole="alert">{f('fdWeekError')}</AppText> : null}

      {!risk && !consentErr ? (
        <Button
          title={create.isPending ? f('fdWeekCreating') : report ? f('fdWeekRefresh') : f('fdWeekCreate')}
          variant="secondary" icon={report ? 'refresh-outline' : 'sparkles-outline'} loading={create.isPending}
          onPress={() => run(!!report)} />
      ) : null}
    </Card>
  );
}
