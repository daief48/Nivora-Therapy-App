import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { View } from 'react-native';
import { completeGrounding } from '../../api/practice';
import { FadeInUp, PressScale, successHaptic, tapHaptic } from '../../motion';
import { useTheme, radius } from '../../theme';
import { AppText, Button, Card, IconCircle, ProgressBar, Row, type IconName } from '../ui';
import { PracticeDone, type Recorded } from './parts';
import { usePT } from './pt';
import type { StringKey } from '../../i18n';

const SENSES: { label: StringKey; icon: IconName; count: number }[] = [
  { label: 'groundSee', icon: 'eye-outline', count: 5 }, { label: 'groundFeel', icon: 'hand-left-outline', count: 4 },
  { label: 'groundHear', icon: 'ear-outline', count: 3 }, { label: 'groundSmell', icon: 'flower-outline', count: 2 },
  { label: 'groundTaste', icon: 'nutrition-outline', count: 1 },
];

/** 5-4-3-2-1 grounding: one sense per step, a gentle tap for each thing noticed. Only the completion is recorded, never what was noticed. */
export function GroundingFlow({ onExit }: { onExit?: () => void }) {
  const t = usePT();
  const { c } = useTheme();
  const qc = useQueryClient();
  const [i, setI] = useState(-1);
  const [taps, setTaps] = useState(0);
  const [recorded, setRecorded] = useState<Recorded>(null);
  const [done, setDone] = useState(false);

  const finish = async () => {
    successHaptic();
    setDone(true);
    try {
      const r = await completeGrounding(2);
      setRecorded(r.kaizen);
      qc.invalidateQueries({ queryKey: ['kaizen'] }); qc.invalidateQueries({ queryKey: ['garden'] });
    } catch { setRecorded('failed'); }
  };
  const go = (n: number) => { setI(n); setTaps(0); };

  if (done) return <PracticeDone title={t('prGrDone')} recorded={recorded} onAgain={() => { setDone(false); setRecorded(null); go(0); }} onExit={onExit} />;
  if (i === -1) {
    return (
      <Card>
        <FadeInUp><AppText>{t('prGrIntro')}</AppText></FadeInUp>
        <AppText muted size={13}>{t('prNotTherapy')}</AppText>
        <Button title={t('prBegin')} onPress={() => go(0)} />
      </Card>
    );
  }
  const s = SENSES[i]!;
  const full = taps >= s.count;
  const last = i === SENSES.length - 1;
  return (
    <Card>
      <AppText size={13} weight="700" muted>{t('stepOf', { n: i + 1, total: SENSES.length })}</AppText>
      <ProgressBar value={i + 1} max={SENSES.length} label={t('stepOf', { n: i + 1, total: SENSES.length })} />
      <FadeInUp key={i}>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
          <IconCircle icon={s.icon} tone={(i % 4) as 0 | 1 | 2 | 3} size={80} />
          <AppText size={22} weight="800" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{t(s.label)}</AppText>
          <Row style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {Array.from({ length: s.count }).map((_, d) => (
              <View key={d} style={{ width: 16, height: 16, borderRadius: radius.pill, backgroundColor: d < taps ? c.primary : c.cardAlt, borderWidth: 1, borderColor: c.primary }} />
            ))}
          </Row>
          <AppText muted size={14} accessibilityLiveRegion="polite">{t('prGrCount', { n: Math.min(taps, s.count), total: s.count })}</AppText>
          <PressScale accessibilityRole="button" accessibilityLabel={t('prGrTap')} haptic={false} disabled={full}
            onPress={() => { tapHaptic(); setTaps((n) => n + 1); }}
            style={{ minHeight: 56, paddingHorizontal: 28, borderRadius: radius.pill, backgroundColor: full ? c.cardAlt : c.petal, alignItems: 'center', justifyContent: 'center' }}>
            <AppText weight="700">{t('prGrTap')}</AppText>
          </PressScale>
        </View>
      </FadeInUp>
      <Row>
        <Button title={t('back')} variant="ghost" disabled={i === 0} onPress={() => go(i - 1)} style={{ flex: 1 }} />
        <Button title={last ? t('finish') : t('prGrNext')} variant={full ? 'primary' : 'secondary'} onPress={() => (last ? finish() : go(i + 1))} style={{ flex: 2 }} />
      </Row>
      {onExit ? <Button title={t('close')} variant="ghost" onPress={onExit} /> : null}
    </Card>
  );
}
