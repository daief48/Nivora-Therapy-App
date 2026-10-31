import { useGuideConsent } from '../guide';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { addJournalStep, type JournalStep } from '../api/connect';
import { useCn } from '../i18n/connectT';
import { FadeInUp } from '../motion';
import { ConsentRequiredPrompt, consentTypeOf, isConsentRequired } from './ConsentRequired';
import { AppText, Button, Card, Row } from './ui';

type Phase = 'ask' | 'busy' | 'added' | 'already' | 'hidden';

/**
 * The 2-minute step from an Emotion Reading, offered as an optional small step for today. Rendered only when the server sent a step and
 * saved it with the entry (so `entryId` is real). Under risk (`skipped: 'RISK'`) it simply disappears: nothing is proposed.
 */
export function JournalStepCard({ entryId, step, onDone }: { entryId: string; step: JournalStep; onDone?: () => void }) {
  const cn = useCn();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('ask');
  const [consentErr, setConsentErr] = useState<unknown>(null);
  useGuideConsent(consentTypeOf(consentErr), !!consentErr);
  const [failed, setFailed] = useState(false);

  const add = async () => {
    setPhase('busy'); setFailed(false); setConsentErr(null);
    try {
      const r = await addJournalStep(entryId);
      if (r.skipped === 'RISK') { setPhase('hidden'); onDone?.(); return; }
      setPhase(r.alreadyDone ? 'already' : 'added');
      void qc.invalidateQueries({ queryKey: ['kaizen'] }); void qc.invalidateQueries({ queryKey: ['today'] });
    } catch (e) {
      setPhase('ask');
      if (isConsentRequired(e)) setConsentErr(e); else setFailed(true);
    }
  };

  if (phase === 'hidden') return null;
  return (
    <FadeInUp>
      <Card tone="lavender">
        <AppText size={15} weight="800" accessibilityRole="header">{cn('cnStepHeading')}</AppText>
        <AppText>{step.title}</AppText>
        <AppText size={12} muted>{cn('cnStepMin', { n: step.minutes })}</AppText>
        {step.reason ? <AppText size={12} muted>{step.reason}</AppText> : step.why ? <AppText size={12} muted>{step.why}</AppText> : null}
        {phase === 'added' || phase === 'already' ? (
          <AppText weight="700" accessibilityLiveRegion="polite">{phase === 'already' ? cn('cnStepDone') : cn('cnStepAdded')}</AppText>
        ) : (
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={cn('cnStepAdd')} icon="checkmark" onPress={add} loading={phase === 'busy'} />
            <Button title={cn('cnNotNow')} variant="ghost" onPress={() => { setPhase('hidden'); onDone?.(); }} />
          </Row>
        )}
        {failed ? <AppText size={13} accessibilityRole="alert">{cn('cnStepFailed')}</AppText> : null}
        {consentErr ? <ConsentRequiredPrompt error={consentErr} onGranted={add} onDismiss={() => setConsentErr(null)} /> : null}
      </Card>
    </FadeInUp>
  );
}
