import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT } from '../i18n';
import { radius, useTheme } from '../theme';
import { Icon } from './ui';

/** Small "AI-generated" pill. Renders nothing unless `ai` is true, so callers can pass a message/content flag straight through. */
export function AiBadge({ ai, style }: { ai?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c, text } = useTheme();
  const t = useT();
  if (!ai) return null;
  return (
    <View accessible accessibilityLabel={t('aiTagA11y')} style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.lavender }, style]}>
      <Icon name="sparkles-outline" size={13} color={c.tintFg[2]} />
      <Text style={[text(12, '700'), { color: c.tintFg[2] }]}>{t('aiTag')}</Text>
    </View>
  );
}

/** Honest one-line reminder: "AI, not a person; not therapy". `more` adds the longer explanation underneath. */
export function AiDisclosure({ more = false, style }: { more?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c, text } = useTheme();
  const t = useT();
  return (
    <View accessibilityRole="text" style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, style]}>
      <Icon name="information-circle-outline" size={16} color={c.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={[text(13, '600'), { color: c.textMuted }]}>{t('aiNotice')}</Text>
        {more ? <Text style={[text(12), { color: c.textMuted }]}>{t('aiNoticeMore')}</Text> : null}
      </View>
    </View>
  );
}
