import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { hintKey, useSessionState } from '../api/sessions';
import { useT } from '../i18n';
import { radius, useTheme } from '../theme';
import { AppText, Icon } from './ui';

export const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * Seconds left in a time-boxed sitting, ticking once a second. Anchored on the server's remainingSec (immune to a wrong phone clock),
 * falling back to endsAt. Null for open-ended sessions or while the state is not loaded.
 */
export function useSittingClock(sessionId?: string) {
  const q = useSessionState(sessionId);
  const d = q.data;
  const timed = !!d && (d.remainingSec != null || !!d.endsAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timed, q.dataUpdatedAt]);
  let remainingSec: number | null = null;
  if (d?.remainingSec != null) remainingSec = Math.max(0, d.remainingSec - Math.floor(Math.max(0, now - q.dataUpdatedAt) / 1000));
  else if (d?.endsAt) remainingSec = Math.max(0, Math.ceil((Date.parse(d.endsAt) - now) / 1000));
  return { state: d, remainingSec, query: q };
}

// Slim, calm bar showing elapsed/remaining time and a gentle phase hint. Hidden without a session or when the state request fails.
export interface SessionBarProps {
  sessionId?: string;
  /** 'light' for dark call screens, 'default' for normal screens */
  tone?: 'default' | 'light';
}
export function SessionBar({ sessionId, tone = 'default' }: SessionBarProps) {
  const t = useT();
  const { c } = useTheme();
  const { state: s, remainingSec, query: q } = useSittingClock(sessionId);
  if (!sessionId || q.isError || !s) return null;
  const light = tone === 'light';
  const fg = light ? '#F4EFE8' : c.text;
  const left = remainingSec != null
    ? t('spBarLeft', { time: fmtClock(remainingSec) })
    : s.remainingMin != null ? t('sessBarLeft', { n: Math.max(0, Math.round(s.remainingMin)) }) : null;
  const time = [t('sessBarSoFar', { n: Math.max(0, Math.round(s.elapsedMin ?? 0)) }), left].filter(Boolean).join(' · ');
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
