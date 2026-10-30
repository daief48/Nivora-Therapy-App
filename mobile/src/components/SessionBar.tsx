import React from 'react';
import { View } from 'react-native';
import { hintKey, useSessionState } from '../api/sessions';
import { useT } from '../i18n';
import { radius, useTheme } from '../theme';
import { AppText, Icon } from './ui';

// Slim, calm bar showing elapsed/remaining time and a gentle phase hint. Hidden without a session or when the state request fails.
export interface SessionBarProps {
  sessionId?: string;
  /** 'light' for dark call screens, 'default' for normal screens */
  tone?: 'default' | 'light';
}
export function SessionBar({ sessionId, tone = 'default' }: SessionBarProps) {
  const t = useT();
  const { c } = useTheme();
  const q = useSessionState(sessionId);
  if (!sessionId || q.isError || !q.data) return null;
  const s = q.data;
  const light = tone === 'light';
  const fg = light ? '#F4EFE8' : c.text;
  const time = [
    t('sessBarSoFar', { n: Math.max(0, Math.round(s.elapsedMin ?? 0)) }),
    s.remainingMin != null ? t('sessBarLeft', { n: Math.max(0, Math.round(s.remainingMin)) }) : null,
  ].filter(Boolean).join(' · ');
  const hint = t(hintKey(s.phaseHint));
  return (
    <View
      accessible accessibilityRole="text" accessibilityLabel={t('sessBarLabel', { time, hint })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, alignSelf: 'center', backgroundColor: light ? 'rgba(255,255,255,0.14)' : c.lavender, maxWidth: '96%' }}
    >
      <Icon name="leaf-outline" size={14} color={fg} />
      <AppText size={12} weight="600" style={{ color: fg, flexShrink: 1 }} numberOfLines={2}>{time} · {hint}</AppText>
    </View>
  );
}
