import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { completeBreathing } from '../../api/practice';
import { BreathingOrb, FadeInUp, successHaptic, tapHaptic, useReducedMotion, type BreathPhase } from '../../motion';
import { AppText, Button, Card, Chip, ProgressBar, Row } from '../ui';
import { PracticeDone, type Recorded } from './parts';
import { usePT } from './pt';

const LENGTHS = [1, 2, 5] as const;

/** Timed breathing with the orb. Haptics follow the phases (soft tap on in/out breath); the practice is recorded only when the full time is completed. */
export function BreathingPacer({ onExit }: { onExit?: () => void }) {
  const t = usePT();
  const reduced = useReducedMotion();
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState<number>(2);
  const [stage, setStage] = useState<'pick' | 'run' | 'stopped' | 'done'>('pick');
  const [left, setLeft] = useState(0);
  const [recorded, setRecorded] = useState<Recorded>(null);

  const onPhase = useCallback((p: BreathPhase) => { if (p === 'inhale' || p === 'exhale') tapHaptic(); }, []);

  useEffect(() => {
    if (stage !== 'run') return;
    const id = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'run' || left > 0) return;
    successHaptic();
    setStage('done');
    completeBreathing(minutes)
      .then((r) => { setRecorded(r.kaizen); qc.invalidateQueries({ queryKey: ['kaizen'] }); qc.invalidateQueries({ queryKey: ['garden'] }); })
      .catch(() => setRecorded('failed'));
  }, [stage, left, minutes, qc]);

  const start = () => { setRecorded(null); setLeft(minutes * 60); setStage('run'); };

  if (stage === 'done') return <PracticeDone title={t('prBrDone')} recorded={recorded} onAgain={() => setStage('pick')} onExit={onExit} />;
  const mm = Math.floor(Math.max(left, 0) / 60), ss = String(Math.max(left, 0) % 60).padStart(2, '0');
  return (
    <Card>
      {stage === 'run' ? (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <BreathingOrb inhale={4000} hold={2000} exhale={6000} running onPhase={onPhase} />
            {reduced ? <AppText muted size={13} style={{ textAlign: 'center' }}>{t('prBrStill')}</AppText> : null}
          </View>
          <AppText weight="700" style={{ textAlign: 'center' }} accessibilityLabel={t('prBrLeft', { m: mm, s: ss })}>{t('prBrLeft', { m: mm, s: ss })}</AppText>
          <ProgressBar value={minutes * 60 - left} max={minutes * 60} label={t('prBrLeft', { m: mm, s: ss })} />
          <Button title={t('prBrStop')} variant="secondary" icon="stop" onPress={() => setStage('stopped')} />
          <AppText size={13} muted>{t('breathNote')}</AppText>
        </>
      ) : (
        <FadeInUp>
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <BreathingOrb running={false} showLabel={false} size={140} />
          </View>
          {stage === 'stopped' ? <AppText muted style={{ textAlign: 'center' }}>{t('prBrStopped')}</AppText> : null}
          <AppText weight="700" size={14}>{t('prBrLong')}</AppText>
          <Row>
            {LENGTHS.map((m) => <Chip key={m} label={t('prBrMin', { n: m })} selected={minutes === m} onPress={() => setMinutes(m)} />)}
          </Row>
          <Button title={t('prBrStart')} icon="play" onPress={start} />
          <AppText size={13} muted>{t('breathNote')}</AppText>
        </FadeInUp>
      )}
    </Card>
  );
}
