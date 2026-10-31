import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { postSessionClose } from '../api/actions';
import { useAT } from '../i18n/actionsT';
import { ActionCard } from './ActionCard';
import { AppText, Button, Row, SectionTitle } from './ui';

/**
 * "What are you taking with you?" after a session: ONE tiny action (accepting saves it as a small Kaizen step), or support options only
 * when the session was flagged / risk is present. Nothing at all when the server has no card. Fully skippable; any failure shows nothing.
 */
export function SessionCloseCard({ sessionId }: { sessionId: string }) {
  const t = useAT();
  const [skipped, setSkipped] = useState(false);
  const [saved, setSaved] = useState(false);
  const q = useQuery({ queryKey: ['actions', 'session-close', sessionId], queryFn: () => postSessionClose(sessionId), retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false });
  const d = q.data;
  if (skipped || !d) return null;
  const support = d.riskMode || !d.action;
  const cards = support ? d.support ?? [] : [d.action!];
  if (!cards.length) return null;
  return (
    <>
      <SectionTitle>{d.prompt}</SectionTitle>
      {!saved ? cards.map((card) => (
        <ActionCard key={card.id} card={card} surface="SESSION_CLOSE"
          saveToKaizen={!card.crisis}
          onTry={card.crisis ? undefined : () => setSaved(true)} />
      )) : null}
      {saved ? <AppText size={14} accessibilityLiveRegion="polite">{t('acSaved')}</AppText> : null}
      {!saved ? <Row><Button title={t('acSkip')} variant="ghost" onPress={() => setSkipped(true)} style={{ minHeight: 44 }} /></Row> : null}
    </>
  );
}
