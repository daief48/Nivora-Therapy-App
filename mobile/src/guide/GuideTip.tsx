import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { AvatarMini } from '../components/Avatar';
import { useG } from '../i18n/guideT';
import { PressScale } from '../motion';
import { radius, useTheme } from '../theme';
import { getFeature } from './guideContent';
import { useGuide } from './guideEngine';

/**
 * Small inline avatar chip ("What is this?") for a feature header or first card. Tapping replays that feature's guide.
 * A tap is always honoured, even at level Off or "suggest: Never"; only a safety/busy suppression blocks it.
 */
export function GuideTip({ featureId, style }: { featureId: string; style?: StyleProp<ViewStyle> }) {
  const { c, text } = useTheme();
  const g = useG();
  const f = getFeature(featureId);
  if (!f) return null;
  return (
    <PressScale
      accessibilityRole="button" accessibilityLabel={g('gWhatIsFor', { name: g(f.featureKey) })} hitSlop={6}
      onPress={() => { useGuide.getState().replay(featureId); }}
      style={[{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingLeft: 4, paddingRight: 10, borderRadius: radius.pill, backgroundColor: c.lavender, minHeight: 32 }, style]}
    >
      <View accessible={false} importantForAccessibility="no-hide-descendants"><AvatarMini size={24} /></View>
      <Text style={[text(12, '700'), { color: c.tintFg[2] }]}>{g('gWhatIs')}</Text>
    </PressScale>
  );
}
