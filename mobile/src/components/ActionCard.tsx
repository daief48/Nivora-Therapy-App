import { useGuideFeature } from '../guide';
import { useNavigation } from '@react-navigation/native';
import React, { useRef, useState } from 'react';
import { useOptionalQueryClient } from '../api/optionalClient';
import { Pressable, View } from 'react-native';
import { outcomeIdOf, postActionOutcome, type ActionCardData, type ActionOutcome } from '../api/actions';
import { useAT } from '../i18n/actionsT';
import { FadeInUp } from '../motion';
import { useTheme } from '../theme';
import { resolveActionLink } from '../utils/actionLink';
import { AppText, Button, Card, Icon, Row } from './ui';

/**
 * One gentle, optional suggestion from the Action Menu. Everything shown is ready text from the server.
 * "Try it" posts ACCEPTED and then opens the target (or calls `onTry` instead, which the caller uses when it must not navigate, e.g. during a call).
 * "Not now" posts DISMISSED and hides the card. Crisis cards show the support action prominently, with no thumbs and no dismissal.
 */
export function ActionCard({ card, compact = false, showFeedback = false, onOutcome, onTry, disabled = false, surface, saveToKaizen = false }: {
  card: ActionCardData; compact?: boolean; showFeedback?: boolean; onOutcome?: (o: ActionOutcome) => void; onTry?: () => void; disabled?: boolean;
  /** Sent with the outcome (defaults to the card's own surface). */
  surface?: string;
  /** Session close only: accepting also saves the action as a small Kaizen step. */
  saveToKaizen?: boolean;
}) {
  const t = useAT();
  const { c } = useTheme();
  const nav = useNavigation();
  const [hidden, setHidden] = useState(false);
  const [rated, setRated] = useState<null | 1 | -1>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const acceptedRef = useRef(false);
  const qc = useOptionalQueryClient(); // optional: the card also works outside a QueryClientProvider
  useGuideFeature('actionCards');
  if (hidden) return null;
  const sfc = surface ?? card.surface;
  const post = async (outcome: ActionOutcome, extra?: { saveToKaizen?: boolean }) => {
    try {
      await postActionOutcome(outcomeIdOf(card), { outcome, ...(sfc ? { surface: sfc } : {}), ...(extra?.saveToKaizen ? { saveToKaizen: true } : {}) });
      if (outcome === 'ACCEPTED') { void qc?.invalidateQueries({ queryKey: ['kaizen'] }); void qc?.invalidateQueries({ queryKey: ['today'] }); }
    } catch { /* a missed record must never block the person */ }
  };
  const tryIt = async () => {
    if (busy || disabled || acceptedRef.current) return;
    // Locked after the first tap (a double tap must not post or navigate twice). Support (crisis) cards stay usable: help is never locked.
    if (!card.crisis) { acceptedRef.current = true; setAccepted(true); }
    setBusy(true);
    await post('ACCEPTED', { saveToKaizen });
    setBusy(false);
    onOutcome?.('ACCEPTED');
    if (onTry) onTry(); else resolveActionLink(nav as never, card.deepLink);
  };
  const notNow = async () => {
    if (busy) return;
    setHidden(true);
    onOutcome?.('DISMISSED');
    await post('DISMISSED');
  };
  const rate = async (v: 1 | -1) => {
    if (rated) return;
    setRated(v);
    onOutcome?.(v === 1 ? 'THUMBS_UP' : 'THUMBS_DOWN');
    await post(v === 1 ? 'THUMBS_UP' : 'THUMBS_DOWN');
  };
  const crisis = card.crisis;
  return (
    <FadeInUp>
      <Card tone={crisis ? 'danger' : 'alt'}>
        <View testID="action-card" style={{ gap: compact ? 4 : 8 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <AppText weight="700" size={compact ? 15 : 17} accessibilityRole="header" style={{ flex: 1 }}>{card.title}</AppText>
            {card.minutes > 0 ? <AppText size={12} muted>{t('acMinutes', { n: card.minutes })}</AppText> : null}
          </Row>
          {card.why ? <AppText size={compact ? 13 : 14}>{card.why}</AppText> : null}
          {card.reason ? <AppText size={12} muted>{card.reason}</AppText> : null}
          <Row style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Button title={card.cta} variant={crisis ? 'danger' : 'primary'} onPress={() => { void tryIt(); }} disabled={disabled || accepted} loading={busy} style={{ minHeight: 44 }} />
            {!crisis ? <Button title={card.notNow} variant="ghost" onPress={() => { void notNow(); }} style={{ minHeight: 44 }} /> : null}
          </Row>
          {showFeedback && !crisis ? (
            rated ? <AppText size={12} muted accessibilityLiveRegion="polite">{t('acThanks')}</AppText> : (
              <Row style={{ gap: 2 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('acHelpful')} onPress={() => { void rate(1); }} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="thumbs-up-outline" size={19} color={c.textMuted} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('acNotHelpful')} onPress={() => { void rate(-1); }} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="thumbs-down-outline" size={19} color={c.textMuted} />
                </Pressable>
              </Row>
            )
          ) : null}
        </View>
      </Card>
    </FadeInUp>
  );
}
