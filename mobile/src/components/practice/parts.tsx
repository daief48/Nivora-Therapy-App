import React from 'react';
import { View } from 'react-native';
import type { CrisisPayload, Kaizen } from '../../api/practice';
import type { RoutineMark } from '../../api/connect';
import { Celebrate } from '../Celebrate';
import { RoutineTicked } from '../RoutineTicked';
import { AppText, Button, Card, IconCircle, Row } from '../ui';
import { usePT } from './pt';

/** Outcome of recording a practice: a kaizen result, `'failed'` (could not record; never negative), or null (not recorded). */
export type Recorded = Kaizen | 'failed' | null;

/** Calm completion card. A flower and a petal burst only when the day's practice was newly counted. */
export function PracticeDone({ title, recorded, note, routine, children, onAgain, onExit }: { title: string; recorded: Recorded; note?: string; routine?: RoutineMark | null; children?: React.ReactNode; onAgain?: () => void; onExit?: () => void }) {
  const t = usePT();
  const counted = recorded !== null && recorded !== 'failed' && recorded.counted;
  return (
    <Card>
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 150, justifyContent: 'center' }}>
        <IconCircle icon="checkmark" tone={0} size={56} />
        <AppText size={18} weight="800" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{title}</AppText>
        <Celebrate play={counted ? 1 : 0} variant="petals" haptic />
      </View>
      {counted ? (
        <>
          <AppText weight="700" style={{ textAlign: 'center' }}>{t('prFlowerAdded')}</AppText>
          <AppText muted size={13} style={{ textAlign: 'center' }}>{t('prFlowersTotal', { n: (recorded as Kaizen).flowers })}</AppText>
        </>
      ) : recorded === 'failed' ? <AppText muted style={{ textAlign: 'center' }}>{t('prNoRecord')}</AppText>
        : recorded ? <AppText muted style={{ textAlign: 'center' }}>{t('prAlready')}</AppText> : null}
      {note ? <AppText muted size={13} style={{ textAlign: 'center' }}>{note}</AppText> : null}
      <RoutineTicked routine={routine} />
      {children}
      <Row style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        {onAgain ? <Button title={t('prAgain')} variant="secondary" onPress={onAgain} /> : null}
        {onExit ? <Button title={t('prAllDone')} variant="ghost" onPress={onExit} /> : null}
      </Row>
    </Card>
  );
}

/** Shown when the server flags high-risk text. Nothing is stored; the exercise stops gently and points to real help. */
export function CrisisSupport({ crisis, onEmergency, onExit }: { crisis: CrisisPayload; onEmergency?: () => void; onExit?: () => void }) {
  const t = usePT();
  const resources = crisis.safety.resources ?? [];
  return (
    <Card tone="danger" accessibilityRole="alert">
      <AppText size={20} weight="700">{t('prCrisisTitle')}</AppText>
      {crisis.safety.message ? <AppText>{crisis.safety.message}</AppText> : null}
      {resources.map((r, i) => (
        <View key={`${r.name ?? ''}-${i}`}>
          {r.name ? <AppText weight="700">{r.name}</AppText> : null}
          {r.contactDetails ? <AppText size={20} weight="700">{r.contactDetails}</AppText> : null}
        </View>
      ))}
      <AppText muted size={13}>{t('prCrisisStopped')}</AppText>
      <Row style={{ flexWrap: 'wrap' }}>
        {onEmergency ? <Button title={t('prCrisisOpen')} variant="danger" onPress={onEmergency} /> : null}
        {onExit ? <Button title={t('prCrisisLeave')} variant="ghost" onPress={onExit} /> : null}
      </Row>
    </Card>
  );
}
