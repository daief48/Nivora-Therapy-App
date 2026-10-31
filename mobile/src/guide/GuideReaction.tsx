import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { AvatarMini } from '../components/Avatar';
import { useG, type GKey } from '../i18n/guideT';
import { FadeInUp } from '../motion';
import { radius, useTheme } from '../theme';

/** A quiet one-line reaction chip after a completed action. Hides itself; never takes focus and never blocks touches. */
export function GuideReaction({ textKey, onDone, ms = 4200 }: { textKey: GKey; onDone?: () => void; ms?: number }) {
  const { c, text } = useTheme();
  const g = useG();
  useEffect(() => { const id = setTimeout(() => onDone?.(), ms); return () => clearTimeout(id); }, [textKey, onDone, ms]);
  return (
    <FadeInUp distance={10}>
      <View pointerEvents="none" style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 8, paddingRight: 14, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
        <View accessible={false} importantForAccessibility="no-hide-descendants"><AvatarMini size={28} /></View>
        <Text accessibilityLiveRegion="polite" style={text(13, '600')}>{g(textKey)}</Text>
      </View>
    </FadeInUp>
  );
}
