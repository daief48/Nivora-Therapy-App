import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useMe } from '../api/hooks';
import { callModeOf, errorDetail, minutesLeft, modesOf, patchProgram, sittingErrorKey, startSitting, switchSittingMode, useProgramMutation, type ProgramSummary, type SittingMode } from '../api/sessionPrograms';
import { topicName, type TopicRef } from '../api/topics';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { useSettings } from '../store/settings';
import { radius, useTheme } from '../theme';
import { kindKey } from './TopicPicker';
import { AppText, Button, Icon, ProgressBar, type IconName } from './ui';

export const whenLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const DAY_MS = 86_400_000;
/** True when someone has been away a couple of days: the card then offers a gentle welcome instead of any pressure. */
export const awayAWhile = (p: Pick<ProgramSummary, 'lastSittingAt' | 'todayState'>) =>
  p.todayState === 'READY' && !!p.lastSittingAt && Date.now() - Date.parse(p.lastSittingAt) > 2 * DAY_MS;

const MODE_ICON: Record<SittingMode, IconName> = { TEXT: 'chatbubble-ellipses-outline', VOICE: 'mic-outline', VIDEO: 'videocam-outline' };
export const MODE_LABEL = { TEXT: 'spModeText', VOICE: 'spModeVoice', VIDEO: 'spModeVideo' } as const;
const MODE_HINT = { TEXT: 'spModeTextHint', VOICE: 'spModeVoiceHint', VIDEO: 'spModeVideoHint' } as const;

/** Bottom sheet that asks how today's sitting should be held. Only ever lists the modes the program allows. */
export function ModePicker({ modes, last, onPick, onClose }: { modes: SittingMode[]; last: SittingMode; onPick: (m: SittingMode) => void; onClose: () => void }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable accessible={false} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Pressable accessible={false} onPress={() => {}} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 10 }}>
          <AppText size={18} weight="800" accessibilityRole="header">{t('spModeTitle')}</AppText>
          {modes.map((m) => (
            <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: m === last }} accessibilityLabel={t('spModeA11y', { mode: t(MODE_LABEL[m]), hint: t(MODE_HINT[m]) })} onPress={() => onPick(m)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: m === last ? c.primary : c.border, backgroundColor: m === last ? c.lavender : c.card, opacity: pressed ? 0.8 : 1 })}>
              <Icon name={MODE_ICON[m]} size={24} color={c.primary} />
              <View style={{ flex: 1 }}>
                <AppText weight="800">{t(MODE_LABEL[m])}</AppText>
                <AppText size={13} muted>{t(MODE_HINT[m])}</AppText>
              </View>
            </Pressable>
          ))}
          <Button title={t('cancel')} variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Starts (or resumes) today's sitting in the chosen mode and opens it: Chat for TEXT, Call for VOICE/VIDEO (a call only ever exists inside a sitting).
 * When the program allows more than text the person is asked first (last choice highlighted); text-only programs skip the question.
 * Friendly alerts for the 409/400 cases; a mode the server refuses falls back to text. The lists refresh afterwards.
 */
export function useStartSitting() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const me = useMe();
  const sittingModes = useSettings((s) => s.sittingModes);
  const setSettings = useSettings((s) => s.set);
  const [asking, setAsking] = React.useState<ProgramSummary | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const m = useProgramMutation((v: { p: ProgramSummary; mode: SittingMode }) => startSitting(v.p.id, { language: me.data?.locale ?? 'en', mode: v.mode }));
  const warn = (e: unknown) => {
    void qc.invalidateQueries({ queryKey: ['therapy'] });
    const when = errorDetail(e, 'nextAvailableAt');
    Alert.alert(t(sittingErrorKey(e) ?? 'errorTitle') + (when ? ` ${t('spNextAt', { when: whenLabel(when) })}` : ''));
  };
  // `resumed` tells the sitting screens to show the earlier messages with a "Welcome back" line; the mood question is never asked again.
  const openText = (programId: string, sittingId: string, resumed?: boolean) => nav.navigate('Chat', { sittingId, programId, ...(resumed ? { resumed } : {}) });
  /** Opens a sitting that already exists. `switchFirst` tells the server the mode changed (resuming); a refused or failed switch never strands the person. */
  const openSitting = async (p: ProgramSummary, sittingId: string, mode: SittingMode, switchFirst: boolean, resumed = false) => {
    if (mode === 'TEXT') {
      if (switchFirst) void switchSittingMode(p.id, sittingId, 'TEXT').catch(() => {});
      openText(p.id, sittingId, resumed);
      return;
    }
    if (switchFirst) {
      setSwitching(true);
      try { await switchSittingMode(p.id, sittingId, mode); } catch (e) {
        setSwitching(false);
        warn(e);
        if ((e as { code?: string })?.code === 'MODE_DISABLED') { setSettings({ sittingModes: { ...sittingModes, [p.id]: 'TEXT' } }); openText(p.id, sittingId, resumed); }
        return;
      }
      setSwitching(false);
    }
    nav.navigate('Call', { mode: callModeOf(mode), sittingId, programId: p.id, ...(resumed ? { resumed } : {}) });
  };
  const begin = (p: ProgramSummary, mode: SittingMode) => {
    setAsking(null);
    setSettings({ sittingModes: { ...sittingModes, [p.id]: mode } });
    if (p.todayState === 'IN_PROGRESS' && p.activeSittingId) { void openSitting(p, p.activeSittingId, mode, mode !== 'TEXT' || modesOf(p).length > 1, true); return; }
    m.mutate({ p, mode }, {
      // resumed:true = an unfinished sitting was picked up; the person may have chosen another mode than it was held in, so honour the pick.
      onSuccess: (r) => { if (r.resumed) void openSitting(p, r.sittingId, mode, r.mode ? r.mode !== mode : mode !== 'TEXT' || modesOf(p).length > 1, true); else void openSitting(p, r.sittingId, r.mode ?? mode, false); },
      onError: (e) => {
        const code = (e as { code?: string })?.code;
        const sid = errorDetail(e, 'sittingId');
        if (code === 'SITTING_ALREADY_ACTIVE' && sid) { void openSitting(p, sid, mode, mode !== 'TEXT' || modesOf(p).length > 1, true); return; } // older servers: 409 means "resume this one"
        warn(e);
        if (code === 'MODE_DISABLED' && mode !== 'TEXT') begin(p, 'TEXT'); // the mode was switched off: tell them, then carry on in text
      },
    });
  };
  const start = (p: ProgramSummary) => {
    if (modesOf(p).length < 2) { begin(p, 'TEXT'); return; }
    setAsking(p);
  };
  const choices = asking ? modesOf(asking) : [];
  const stored = asking ? sittingModes[asking.id] : undefined;
  const picker = asking ? <ModePicker modes={choices} last={stored && choices.includes(stored) ? stored : 'TEXT'} onPick={(mode) => begin(asking, mode)} onClose={() => setAsking(null)} /> : null;
  return { start, busy: m.isPending || switching, picker };
}

/** The one action a program offers right now, by todayState. DONE_TODAY is disabled and says when the next sitting opens. */
export function TodayButton({ p }: { p: ProgramSummary }) {
  const t = useT();
  const { start, busy, picker } = useStartSitting();
  const resume = useProgramMutation(() => patchProgram(p.id, { status: 'ACTIVE' }));
  switch (p.todayState) {
    case 'READY':
    case 'IN_PROGRESS': {
      const left = p.todayState === 'IN_PROGRESS' && p.remainingSec != null && p.remainingSec > 0 ? minutesLeft(p.remainingSec) : null;
      const label = p.todayState === 'READY' ? t('spStart') : left != null ? t('spContinueLeft', { n: left }) : t('spContinue');
      const used = p.todayState === 'IN_PROGRESS' && p.usedMinutes != null ? p.usedMinutes : null;
      return (
        <>
          {used != null ? <ProgressBar value={used} max={p.dailyMinutes} label={t('spUsedOf', { a: used, b: p.dailyMinutes })} /> : null}
          {used != null ? <AppText size={12} muted>{t('spUsedOf', { a: used, b: p.dailyMinutes })}</AppText> : null}
          <Button title={label} icon="play" loading={busy} onPress={() => start(p)} accessibilityLabel={t('spStartA11y', { title: p.title, action: label })} />
          {picker}
        </>
      );
    }
    case 'DONE_TODAY':
      return (
        <View style={{ gap: 4 }}>
          <Button title={t('spDoneToday')} variant="secondary" disabled onPress={() => {}} />
          {p.nextAvailableAt ? <AppText size={13} muted style={{ textAlign: 'center' }}>{t('spNextAt', { when: whenLabel(p.nextAvailableAt) })}</AppText> : null}
        </View>
      );
    case 'PAUSED':
      return <Button title={t('spResume')} variant="secondary" icon="play" loading={resume.isPending} onPress={() => resume.mutate(undefined)} />;
    default:
      return <AppText size={14} muted>{t('spCompletedNote')}</AppText>;
  }
}

/** Small pill naming the topic. Never shows more than the kind or the person's own label. */
export function TopicChip({ topic }: { topic: TopicRef | null }) {
  const t = useT();
  const { c } = useTheme();
  if (!topic) return null;
  const name = topicName(topic, (k) => t(kindKey(k)));
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.lavender }}>
      <AppText size={12} weight="600" accessibilityLabel={t('topicChipLabel', { name })}>{name}</AppText>
    </View>
  );
}
