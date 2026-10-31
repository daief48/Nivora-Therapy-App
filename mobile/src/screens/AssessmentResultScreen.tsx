import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React from 'react';
import { useInstruments, pick } from '../api/assessments';
import { AppText, Button, Card, Screen } from '../components/ui';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useSettings } from '../store/settings';
import { SupportCard } from './AssessmentTakeScreen';
import { cap } from './AssessmentsScreen';

const LOW = ['minimal', 'low_risk'];
const HIGH = ['moderately_severe', 'severe', 'harmful', 'possible_dependence'];

/** Plain, supportive result. Never a diagnosis; always points to people and resources, and shows the support card when item 9 was flagged. */
export function AssessmentResultScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const { instrument, total, severity, item9Flag } = useRoute<RouteProp<RootParams, 'AssessmentResult'>>().params;
  const lang = useSettings((s) => s.uiLang);
  const def = useInstruments().data?.find((d) => d.id === instrument);
  const msg = LOW.includes(severity) ? 'asMsgLow' : HIGH.includes(severity) ? 'asMsgHigh' : 'asMsgMid';

  return (
    <Screen>
      <AppText size={26} weight="700" accessibilityRole="header">{t('asResultTitle')}</AppText>
      {item9Flag ? <SupportCard onHelp={() => nav.navigate('Emergency')} onPlan={() => nav.navigate('SafetyPlan')} /> : null}
      <Card tone="lavender">
        {def ? <AppText weight="700">{pick(def.title, lang)}</AppText> : null}
        <AppText size={22} weight="700">{t('asScoreLine', { score: total, max: def?.maxScore ?? '' })}</AppText>
        <AppText>{t('asBandLead')} <AppText weight="700">{t(`asBand${cap(severity)}` as never)}</AppText></AppText>
        <AppText>{t(msg)}</AppText>
      </Card>
      <Card>
        <AppText weight="700" accessibilityRole="header">{t('asSuggestTitle')}</AppText>
        <AppText>{t('asSuggestTalk')}</AppText>
        <AppText>{t('asSuggestNivora')}</AppText>
        <AppText>{t(instrument === 'AUDIT' ? 'asSuggestAlcohol' : 'asSuggestSelfcare')}</AppText>
        <Button title={t('asSuggestResources')} variant="secondary" onPress={() => nav.navigate('Emergency')} />
      </Card>
      <AppText size={13} muted>{t('asRetakeMonthly')}</AppText>
      <AppText size={13} weight="600">{t('asNotDiagnosis')}</AppText>
      <AppText size={12} muted>{t('asReviewNote')}</AppText>
      <Button title={t('asDone')} onPress={() => nav.navigate('Assessments')} />
    </Screen>
  );
}
