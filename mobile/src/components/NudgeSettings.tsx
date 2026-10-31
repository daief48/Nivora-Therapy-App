import React, { useState } from 'react';
import { minutesUntilMorning, NUDGE_TYPES, useNudgeSettings, useSaveNudgeSettings, useSnoozeNudges, type NudgeSettings as Settings, type NudgeType } from '../api/today';
import { useCn } from '../i18n/connectT';
import { useTH, type THKey } from '../i18n/th';
import { tapHaptic } from '../motion';
import { AppText, Button, Card, Check, Row, SectionTitle } from './ui';

const STEP = 15;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const toHHmm = (min: number) => { const x = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const SESSION_INVITE = 'SESSION_INVITE';
/** The per-type switches: the Today types plus the gentle invitation to talk (the server lists it in GET /nudges/settings types). */
const ALL_TYPES: string[] = Array.from(new Set<string>([...NUDGE_TYPES, SESSION_INVITE]));
const TYPE_KEY: Record<NudgeType, THKey> = { WIND_DOWN: 'thTypeWIND_DOWN', MOOD_CHECKIN: 'thTypeMOOD_CHECKIN', WEEKLY_REVIEW: 'thTypeWEEKLY_REVIEW', MORNING_PLAN: 'thTypeMORNING_PLAN' };

function TimeStep({ label, value, onChange, earlier, later }: { label: string; value: string; onChange: (v: string) => void; earlier: string; later: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <AppText size={14} muted>{label}</AppText>
      <Row style={{ gap: 6 }}>
        <Button title="−" variant="secondary" accessibilityLabel={earlier} onPress={() => onChange(toHHmm(toMin(value) - STEP))} />
        <AppText weight="800" size={18} accessibilityLiveRegion="polite" style={{ minWidth: 64, textAlign: 'center' }}>{value}</AppText>
        <Button title="+" variant="secondary" accessibilityLabel={later} onPress={() => onChange(toHHmm(toMin(value) + STEP))} />
      </Row>
    </Row>
  );
}

const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/**
 * Server-side nudge preferences: global switch, quiet hours, per-type toggles and snooze.
 * Nudges are pull-based (shown in the Today feed), so nothing here schedules a push.
 */
export function NudgeSettingsSection() {
  const th = useTH();
  const cn = useCn();
  const q = useNudgeSettings();
  const save = useSaveNudgeSettings();
  const snooze = useSnoozeNudges();
  const [failed, setFailed] = useState(false);
  const s: Settings | undefined = q.data;
  if (!s) return q.isError ? <AppText size={13} muted accessibilityRole="alert">{th('thSettingsFailed')}</AppText> : null;

  const put = (patch: Parameters<typeof save.mutate>[0]) => { setFailed(false); tapHaptic(); save.mutate(patch, { onError: () => setFailed(true) }); };
  const doSnooze = (minutes: number) => { setFailed(false); tapHaptic(); snooze.mutate(minutes, { onError: () => setFailed(true) }); };
  const snoozed = s.snoozedUntil && new Date(s.snoozedUntil).getTime() > Date.now();
  const busy = save.isPending || snooze.isPending;

  return (
    <>
      <SectionTitle>{th('thNudgeTitle')}</SectionTitle>
      <AppText size={13} muted>{th('thNudgeIntro')}</AppText>
      <Card>
        <Check checked={s.enabled} onToggle={() => put({ enabled: !s.enabled })} label={th('thNudgeOn')} />
        {s.enabled ? (
          <>
            <AppText size={14} weight="700">{th('thNudgeQuiet')}</AppText>
            <TimeStep label={th('thNudgeQuietFrom')} value={s.quietStart} onChange={(v) => put({ quietStart: v })} earlier={`${th('thNudgeQuietFrom')} −`} later={`${th('thNudgeQuietFrom')} +`} />
            <TimeStep label={th('thNudgeQuietTo')} value={s.quietEnd} onChange={(v) => put({ quietEnd: v })} earlier={`${th('thNudgeQuietTo')} −`} later={`${th('thNudgeQuietTo')} +`} />
            <AppText size={14} weight="700">{th('thNudgeTypes')}</AppText>
            {ALL_TYPES.map((type) => {
              const on = (s.types as Record<string, boolean> | undefined)?.[type] !== false;
              return <Check key={type} checked={on} onToggle={() => put({ types: { [type]: !on } as Partial<Record<NudgeType, boolean>> })} label={type === SESSION_INVITE ? cn('cnNudgeSESSION_INVITE') : th(TYPE_KEY[type as NudgeType])} />;
            })}
          </>
        ) : null}
      </Card>

      <Card>
        <AppText size={14} weight="700">{th('thSnoozeTitle')}</AppText>
        {snoozed ? <AppText size={13} muted accessibilityLiveRegion="polite">{th('thSnoozeActive', { time: fmtTime(s.snoozedUntil!) })}</AppText> : null}
        <Row style={{ flexWrap: 'wrap' }}>
          <Button title={th('thSnooze1h')} variant="secondary" disabled={busy} onPress={() => doSnooze(60)} />
          <Button title={th('thSnoozeTonight')} variant="secondary" disabled={busy} onPress={() => doSnooze(minutesUntilMorning())} />
          <Button title={th('thSnooze1d')} variant="secondary" disabled={busy} onPress={() => doSnooze(1440)} />
          {snoozed ? <Button title={th('thSnoozeOff')} variant="ghost" disabled={busy} onPress={() => doSnooze(0)} /> : null}
        </Row>
      </Card>
      {failed ? <AppText size={13} accessibilityRole="alert">{th('thSettingsFailed')}</AppText> : null}
    </>
  );
}
