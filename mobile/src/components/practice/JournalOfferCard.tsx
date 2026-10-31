import React, { useState } from 'react';
import { saveJournalOffer, type JournalOffer } from '../../api/practice';
import { useCn } from '../../i18n/connectT';
import { AppText, Button, Card, Row } from '../ui';

/** After a thought record: offers a short note for the journal (fixed text over the person's own words). Optional, with Not now. */
export function JournalOfferCard({ offer }: { offer: JournalOffer }) {
  const cn = useCn();
  const [phase, setPhase] = useState<'ask' | 'busy' | 'saved' | 'hidden'>('ask');
  const [failed, setFailed] = useState(false);
  if (phase === 'hidden') return null;
  const save = async () => {
    setPhase('busy'); setFailed(false);
    try { await saveJournalOffer(offer); setPhase('saved'); } catch { setPhase('ask'); setFailed(true); }
  };
  return (
    <Card tone="lavender">
      <AppText size={15} weight="800">{cn('cnJournalOffer')}</AppText>
      {phase === 'saved' ? <AppText weight="700" accessibilityLiveRegion="polite">{cn('cnJournalSaved')}</AppText> : (
        <>
          <AppText size={13} muted>{cn('cnJournalOfferHint')}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={cn('cnJournalSave')} icon="checkmark" onPress={save} loading={phase === 'busy'} />
            <Button title={cn('cnNotNow')} variant="ghost" onPress={() => setPhase('hidden')} />
          </Row>
        </>
      )}
      {failed ? <AppText size={13} accessibilityRole="alert">{cn('cnJournalFailed')}</AppText> : null}
    </Card>
  );
}
