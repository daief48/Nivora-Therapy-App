import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Alert, View } from 'react-native';
import { useMe } from '../api/hooks';
import { errorDetail, patchProgram, sittingErrorKey, startSitting, useProgramMutation, type ProgramSummary } from '../api/sessionPrograms';
import { topicName, type TopicRef } from '../api/topics';
import { useT } from '../i18n';
import type { Nav } from '../navigation/types';
import { radius, useTheme } from '../theme';
import { kindKey } from './TopicPicker';
import { AppText, Button } from './ui';

export const whenLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const DAY_MS = 86_400_000;
/** True when someone has been away a couple of days: the card then offers a gentle welcome instead of any pressure. */
export const awayAWhile = (p: Pick<ProgramSummary, 'lastSittingAt' | 'todayState'>) =>
  p.todayState === 'READY' && !!p.lastSittingAt && Date.now() - Date.parse(p.lastSittingAt) > 2 * DAY_MS;

/** Starts (or resumes) today's sitting and opens it. Friendly alerts for the 409/400 cases; the lists refresh afterwards. */
export function useStartSitting() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const me = useMe();
  const m = useProgramMutation((p: ProgramSummary) => startSitting(p.id, { language: me.data?.locale ?? 'en' }));
  const open = (programId: string, sittingId: string) => nav.navigate('Chat', { sittingId, programId });
  const start = (p: ProgramSummary) => {
    if (p.todayState === 'IN_PROGRESS' && p.activeSittingId) { open(p.id, p.activeSittingId); return; }
    m.mutate(p, {
      onSuccess: (r) => open(p.id, r.sittingId),
      onError: (e) => {
        const sid = errorDetail(e, 'sittingId');
        if ((e as { code?: string })?.code === 'SITTING_ALREADY_ACTIVE' && sid) { open(p.id, sid); return; }
        void qc.invalidateQueries({ queryKey: ['therapy'] });
        const when = errorDetail(e, 'nextAvailableAt');
        Alert.alert(t(sittingErrorKey(e) ?? 'errorTitle') + (when ? ` ${t('spNextAt', { when: whenLabel(when) })}` : ''));
      },
    });
  };
  return { start, busy: m.isPending };
}

/** The one action a program offers right now, by todayState. DONE_TODAY is disabled and says when the next sitting opens. */
export function TodayButton({ p }: { p: ProgramSummary }) {
  const t = useT();
  const { start, busy } = useStartSitting();
  const resume = useProgramMutation(() => patchProgram(p.id, { status: 'ACTIVE' }));
  switch (p.todayState) {
    case 'READY':
    case 'IN_PROGRESS': {
      const label = p.todayState === 'READY' ? t('spStart') : t('spContinue');
      return <Button title={label} icon="play" loading={busy} onPress={() => start(p)} accessibilityLabel={t('spStartA11y', { title: p.title, action: label })} />;
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
