import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { outcomeIdOf, postActionOutcome, type ActionCardData } from '../api/actions';
import { useAT } from '../i18n/actionsT';
import { ActionCard } from './ActionCard';
import { AppText, Icon } from './ui';

/**
 * A small, dismissible card shown inside a live call. It never navigates by itself and sits in the flow above the call controls,
 * so the Emergency and hang-up buttons are never covered.
 * "Try it" does not leave the call: the target is kept (`onKeep`) and opened after the call ends. Crisis (support) cards open straight away,
 * because the person tapped them on purpose.
 */
export function CallActionOverlay({ card, onKeep, onDismiss }: { card: ActionCardData; onKeep: (card: ActionCardData) => void; onDismiss: () => void }) {
  const t = useAT();
  const [kept, setKept] = useState(false);
  if (kept) {
    return <AppText size={13} accessibilityLiveRegion="polite" accessibilityLabel={t('acCallLaterA11y')} style={{ color: '#FFFFFF', textAlign: 'center' }}>{t('acCallLater')}</AppText>;
  }
  return (
    <View testID="call-action-overlay" accessibilityLabel={t('acOverlayLabel')} style={{ alignSelf: 'stretch', maxWidth: 520 }}>
      <ActionCard
        card={card} compact
        onTry={card.crisis ? undefined : () => { setKept(true); onKeep(card); }}
        onOutcome={(o) => { if (o === 'DISMISSED') onDismiss(); }}
      />
      {!card.crisis ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('acSkip')} onPress={() => { void postActionOutcome(outcomeIdOf(card), { outcome: 'DISMISSED', surface: 'CALL' }).catch(() => undefined); onDismiss(); }} hitSlop={8} style={{ position: 'absolute', right: 6, top: 2, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={16} color="#777" />
        </Pressable>
      ) : null}
    </View>
  );
}
