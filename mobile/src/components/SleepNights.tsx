import React, { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { NIVORA_KEYS, useInvalidatingMutation } from '../api/hooks';
import type { SleepEntry } from '../api/types';
import { useTH } from '../i18n/th';
import { useT } from '../i18n';
import { useTheme } from '../theme';
import { ScalePicker, Stepper } from './nv';
import { AppText, Button, Card, Row } from './ui';
import { SleepEmptyState } from './sleep/SleepEmptyState';
import { NightsChart } from './sleep/NightsChart';

/** `rested` is null for nights imported from a phone; `source` is 'manual' | 'healthconnect' | 'healthkit' (absent on old servers = manual). */
export type NightEntry = Omit<SleepEntry, 'rested'> & { rested: number | null; source?: string };
export const isImported = (e: { source?: string | null }) => !!e.source && e.source !== 'manual';

const pad = (n: number) => String(n).padStart(2, '0');
const shift = (hhmm: string, delta: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const x = (((h! * 60 + m! + delta) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};

/** Small "from your phone" marker. */
export function SourceBadge({ source }: { source?: string | null }) {
  const th = useTH();
  const { c } = useTheme();
  if (!isImported({ source })) return null;
  return (
    <View accessible accessibilityLabel={th('thFromPhoneA11y')} style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: c.lavender }}>
      <AppText size={11} weight="700" style={{ color: c.primary }}>{th('thFromPhone')}</AppText>
    </View>
  );
}

/** Edits one night via PATCH /sleep/:id. Saving turns an imported night into a manual one. `rested` may be unknown (null). */
export function NightEditor({ entry, onClose }: { entry: NightEntry; onClose: () => void }) {
  const th = useTH();
  const { c } = useTheme();
  const [bed, setBed] = useState(entry.bedtime), [wake, setWake] = useState(entry.wakeTime);
  const [latency, setLatency] = useState(entry.latencyMin ?? 0), [awake, setAwake] = useState(entry.awakenings ?? 0);
  const [rested, setRested] = useState<number | null>(entry.rested ?? null);
  const save = useInvalidatingMutation(
    () => api(`/sleep/${entry.id}`, { method: 'PATCH', body: { bedtime: bed, wakeTime: wake, latencyMin: latency, awakenings: awake, ...(rested != null ? { rested } : {}) } }),
    NIVORA_KEYS,
  );
  return (
    <Card style={{ gap: 8 }}>
      <AppText weight="800" accessibilityRole="header">{th('thEditTitle')} · {entry.date}</AppText>
      <Stepper label="Bedtime" value={bed} onMinus={() => setBed(shift(bed, -15))} onPlus={() => setBed(shift(bed, 15))} />
      <Stepper label="Wake" value={wake} onMinus={() => setWake(shift(wake, -15))} onPlus={() => setWake(shift(wake, 15))} />
      <Stepper label="Latency" value={String(latency)} onMinus={() => setLatency(Math.max(0, latency - 5))} onPlus={() => setLatency(Math.min(240, latency + 5))} />
      <Stepper label="Awakenings" value={String(awake)} onMinus={() => setAwake(Math.max(0, awake - 1))} onPlus={() => setAwake(Math.min(15, awake + 1))} />
      {rested == null ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText size={13} muted style={{ flex: 1 }}>{th('thRestedUnknown')}</AppText>
          <Button title={th('thRestedSet')} variant="ghost" onPress={() => setRested(6)} />
        </Row>
      ) : <ScalePicker label={th('thRestedSet')} value={rested} onChange={setRested} />}
      {isImported(entry) ? <AppText size={12} muted>{th('thEditManualNote')}</AppText> : null}
      {save.isError ? <AppText size={13} style={{ color: c.danger }} accessibilityRole="alert">{th('thEditFailed')}</AppText> : null}
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title={th('thSaveEdit')} icon="checkmark" loading={save.isPending} onPress={() => save.mutate(undefined, { onSuccess: onClose })} />
        <Button title={th('thCancelEdit')} variant="ghost" onPress={onClose} />
      </Row>
    </Card>
  );
}

/** Recent nights with their source marker, 7-day bar chart, and an Edit action. */
export function RecentNights({
  entries,
  onLogPress,
}: {
  entries: NightEntry[];
  onLogPress?: () => void;
}) {
  const th = useTH();
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);

  if (!entries.length) {
    if (onLogPress) {
      return <SleepEmptyState onLogPress={onLogPress} />;
    }
    return <AppText size={13} muted>{th('thRecentEmpty')}</AppText>;
  }

  return (
    <View style={{ gap: 12 }}>
      {/* 7-day bar chart with grow-in animation & moon-phase streak */}
      <NightsChart entries={entries} />

      {/* Night cards with source marker and edit */}
      <View style={{ gap: 10 }}>
        {entries.slice(0, 7).map((e) => editing === e.id ? <NightEditor key={e.id} entry={e} onClose={() => setEditing(null)} /> : (
          <Card key={e.id} style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="700">{e.date} · {t('sleepHours', { h: (e.durationMin / 60).toFixed(1) })}</AppText>
                <AppText size={13} muted>{e.bedtime} → {e.wakeTime}{e.rested == null ? '' : ` · ${e.rested}/10`}</AppText>
              </View>
              <Button title={th('thEditNight')} variant="ghost" accessibilityLabel={`${th('thEditNight')} ${e.date}`} onPress={() => setEditing(e.id)} />
            </Row>
            <SourceBadge source={e.source} />
          </Card>
        ))}
      </View>
    </View>
  );
}
