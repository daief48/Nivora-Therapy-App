import { StackActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { pick, useInstruments, useSubmitAssessment } from '../api/assessments';
import { AppText, Button, Card, Chip, ErrorState, Loading, ProgressBar, Row, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useSettings } from '../store/settings';
import { track } from '../utils/analytics';

/** Gentle card shown the moment PHQ-9 item 9 is answered above 0, before anything is submitted. */
export function SupportCard({ onPlan, onHelp }: { onPlan: () => void; onHelp: () => void }) {
  const t = useT();
  return (
    <Card tone="danger">
      <AppText size={18} weight="700" accessibilityRole="header">{t('asItem9Title')}</AppText>
      <AppText accessibilityLiveRegion="polite">{t('asItem9Body')}</AppText>
      <Button title={t('asItem9Help')} variant="danger" onPress={onHelp} />
      <Button title={t('asItem9Plan')} variant="secondary" onPress={onPlan} />
    </Card>
  );
}

/** One question per page with progress, back/forward. Scoring happens on the server. */
export function AssessmentTakeScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootParams, 'AssessmentTake'>>();
  const lang = useSettings((s) => s.uiLang);
  const defs = useInstruments();
  const submit = useSubmitAssessment();
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState(false);

  const def = defs.data?.find((d) => d.id === route.params.instrument);
  if (defs.isLoading) return <Screen><Loading /></Screen>;
  if (!def) return <Screen><ErrorState error={defs.error ?? new Error(t('asLoadFail'))} onRetry={() => { void defs.refetch(); }} /></Screen>;

  const n = def.items.length;
  const item = def.items[i];
  const cur = answers[i];
  const last = i === n - 1;
  const item9 = def.id === 'PHQ9' && i === 8 && (cur ?? 0) > 0;

  const finish = () => {
    setFailed(false);
    submit.mutate({ instrument: def.id, answers: answers as number[] }, {
      onSuccess: (r) => {
        track('assessment_completed', { kind: def.id.toLowerCase() });
        nav.dispatch(StackActions.replace('AssessmentResult', { instrument: def.id, total: r.total, severity: r.severity, item9Flag: r.item9Flag }));
      },
      onError: () => setFailed(true),
    });
  };

  return (
    <Screen>
      <AppText size={20} weight="700" accessibilityRole="header">{pick(def.title, lang)}</AppText>
      {i === 0 ? <AppText muted>{pick(def.intro, lang)}</AppText> : null}
      <ProgressBar value={i + 1} max={n} label={t('asQuestion', { n: i + 1, total: n })} />
      <AppText size={13} muted>{t('asQuestion', { n: i + 1, total: n })}</AppText>
      <AppText size={19} weight="600" accessibilityRole="header">{pick(item.text, lang)}</AppText>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        {item.options.map((o) => (
          <Chip key={o.value} label={pick(o.label, lang)} selected={cur === o.value} onPress={() => setAnswers((a) => { const b = [...a]; b[i] = o.value; return b; })} />
        ))}
      </Row>
      {item9 ? <SupportCard onHelp={() => nav.navigate('Emergency')} onPlan={() => nav.navigate('SafetyPlan')} /> : null}
      {failed ? <AppText accessibilityRole="alert">{t('asSaveFail')}</AppText> : null}
      {cur === undefined ? <AppText size={13} muted>{t('asPickOne')}</AppText> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title={t('asBack')} variant="ghost" disabled={i === 0 || submit.isPending} onPress={() => setI(i - 1)} />
        {last
          ? <Button title={submit.isPending ? t('asSaving') : t('asFinish')} disabled={cur === undefined || submit.isPending} onPress={finish} />
          : <Button title={t('asNext')} disabled={cur === undefined} onPress={() => setI(i + 1)} />}
      </Row>
      <AppText size={12} muted>{pick(def.attribution, lang)}</AppText>
    </Screen>
  );
}
