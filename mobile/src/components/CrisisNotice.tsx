import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { View } from 'react-native';
import type { CrisisPayload } from '../api/practice';
import { useCs } from '../i18n/csT';
import type { Nav } from '../navigation/types';
import { AppText, Button, Card } from './ui';

/**
 * Shown when a text save came back in the crisis shape: nothing was saved, the person's draft stays in the box, Emergency is one tap away.
 * `dismissLabel` is "Keep writing" for free text, "Not now" elsewhere. Calm, never pushy.
 */
export function CrisisNotice({ crisis, onDismiss, dismissLabel = 'keep' }: { crisis: CrisisPayload; onDismiss: () => void; dismissLabel?: 'keep' | 'notNow' }) {
  const cs = useCs();
  const nav = useNavigation<Nav>();
  const resources = crisis.safety.resources ?? [];
  return (
    <View testID="crisis-notice">
      <Card tone="danger" accessibilityRole="alert">
        <AppText size={20} weight="700">{cs('csTitle')}</AppText>
        {crisis.safety.message ? <AppText>{crisis.safety.message}</AppText> : null}
        {resources.map((r, i) => (
          <View key={`${r.name ?? ''}-${i}`}>
            {r.name ? <AppText weight="700">{r.name}</AppText> : null}
            {r.contactDetails ? <AppText size={20} weight="700">{r.contactDetails}</AppText> : null}
          </View>
        ))}
        <AppText muted size={13}>{cs('csKept')}</AppText>
        <Button title={cs('csEmergency')} variant="danger" onPress={() => nav.navigate('Emergency')} style={{ minHeight: 44 }} />
        <Button title={cs(dismissLabel === 'keep' ? 'csKeepWriting' : 'csNotNow')} variant="ghost" onPress={onDismiss} style={{ minHeight: 44 }} />
      </Card>
    </View>
  );
}
