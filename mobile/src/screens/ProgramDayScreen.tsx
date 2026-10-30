import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation } from '../api/hooks';
import { AppText, Button, Card, Field, IconCircle, ProgressBar, Row, Screen, Skeleton } from '../components/ui';
import { useT } from '../i18n';
import type { ExerciseKind, Nav, RootParams } from '../navigation/types';
import type { ProgramSummary } from './ProgramsScreen';

type DayItem =
  | { day: number; locked: true; completed: false }
  | { day: number; locked: false; completed: boolean; title: string; lesson: string; reflection: string; practice: { text: string; minutes: number; exercise: ExerciseKind | null; kaizen: string | null } };
interface ProgramDetail extends ProgramSummary { disclaimer: string; content: DayItem[] }
const useProgram = (id: string) => useQuery({ queryKey: ['programs', id], queryFn: () => api<ProgramDetail>(`/programs/${id}`) });
type Completed = ProgramSummary & { message: string };

export function ProgramDayScreen() {
  const t = useT();
  const nav = useNavigation<Nav>();
  const { programId, day: startDay } = useRoute<RouteProp<RootParams, 'ProgramDay'>>().params;
  const q = useProgram(programId);
  const [picked, setPicked] = useState<number | null>(startDay ?? null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const keys = [['programs']];
  const complete = useInvalidatingMutation((day: number) => api<Completed>(`/programs/${programId}/days/${day}/complete`, { method: 'POST' }), keys);
  const pause = useInvalidatingMutation(() => api<ProgramSummary>(`/programs/${programId}/pause`, { method: 'POST' }), keys);
  const resume = useInvalidatingMutation(() => api<ProgramSummary>(`/programs/${programId}/enroll`, { method: 'POST' }), keys);

  if (q.isLoading) return <Screen><Skeleton height={28} width="60%" /><Skeleton height={160} /></Screen>;
  if (q.isError || !q.data) {
    return <Screen><Card><AppText>{t('progLoadError')}</AppText><Button title={t('progRetry')} variant="secondary" onPress={() => q.refetch()} /></Card></Screen>;
  }
  const p = q.data;
  const n = Math.min(p.days, Math.max(1, picked ?? Math.min(p.nextDay ?? 1, p.unlockedDay)));
  const item = p.content[n - 1]!;
  const finished = p.status === 'COMPLETED';
  const go = (to: number) => { setPicked(to); setNote(''); setMessage(null); };

  const markDone = async () => {
    try { const r = await complete.mutateAsync(n); setMessage(r.message); } catch { /* error text shown below */ }
  };

  return (
    <Screen>
      <AppText muted size={13}>{p.title}</AppText>
      <AppText size={24} weight="800" accessibilityRole="header">{t('progDayOf', { day: n, total: p.days })}</AppText>
      <ProgressBar value={p.completedCount} max={p.days} label={t('progProgress', { done: p.completedCount, total: p.days })} />
      {finished ? <Card tone="lavender"><AppText size={14}>{t('progAllDone')}</AppText></Card> : null}
      {p.status === 'PAUSED' ? (
        <Card tone="alt">
          <AppText size={14}>{t('progPausedBody')}</AppText>
          <Button title={t('progResume')} onPress={() => resume.mutate(undefined as never)} loading={resume.isPending} />
        </Card>
      ) : null}

      {item.locked ? (
        <Card>
          <IconCircle icon="lock-closed-outline" tone={1} size={48} />
          <AppText size={18} weight="800">{t('progLockedTitle')}</AppText>
          <AppText muted size={14}>{t('progLockedBody')}</AppText>
        </Card>
      ) : (
        <>
          <Card>
            <AppText size={13} muted>{t('progLesson')}</AppText>
            <AppText size={20} weight="800" accessibilityRole="header">{item.title}</AppText>
            <AppText size={15} style={{ lineHeight: 24 }}>{item.lesson}</AppText>
          </Card>
          <Card tone="lavender">
            <AppText size={13} muted>{t('progReflect')}</AppText>
            <AppText size={16} weight="600">{item.reflection}</AppText>
            <Field value={note} onChangeText={setNote} placeholder={t('progNoteHint')} multiline style={{ minHeight: 72 }} />
          </Card>
          <Card>
            <Row style={{ gap: 12 }}>
              <IconCircle icon="sparkles-outline" tone={2} size={40} />
              <View style={{ flex: 1 }}>
                <AppText size={13} muted>{t('progPractice')} · {t('progMinutes', { n: item.practice.minutes })}</AppText>
                <AppText size={15}>{item.practice.text}</AppText>
              </View>
            </Row>
            {item.practice.exercise ? <Button title={t('progOpenExercise')} variant="secondary" onPress={() => nav.navigate('Exercise', { kind: item.practice.exercise! })} /> : null}
          </Card>
          {item.completed || message ? (
            <Card tone="alt">
              <AppText size={16} weight="800" accessibilityLiveRegion="polite">{t('progDayDone')}</AppText>
              <AppText size={14}>{message ?? (finished ? t('progCelebrateLast') : t('progCelebrate'))}</AppText>
              {!finished ? <AppText muted size={13}>{t('progNextTomorrow')}</AppText> : null}
            </Card>
          ) : p.status === 'PAUSED' ? null : (
            <Button title={t('progMarkDone')} onPress={markDone} loading={complete.isPending} />
          )}
          {complete.isError ? <AppText size={13} accessibilityLiveRegion="polite">{t('progSaveError')}</AppText> : null}
        </>
      )}

      <Row style={{ justifyContent: 'space-between' }}>
        <Button title={t('progPrevDay')} variant="ghost" disabled={n <= 1} onPress={() => go(n - 1)} />
        <Button title={t('progNextDay')} variant="ghost" disabled={n >= p.days} onPress={() => go(n + 1)} />
      </Row>
      {p.status === 'ACTIVE' ? <Button title={t('progPause')} variant="ghost" onPress={() => pause.mutate(undefined as never)} loading={pause.isPending} /> : null}
      <Card tone="alt">
        <AppText size={13} weight="700">{t('progSafetyTitle')}</AppText>
        <AppText size={13} muted>{p.safety}</AppText>
        <AppText size={13} muted>{p.disclaimer}</AppText>
      </Card>
      <Button title={t('progTitle')} variant="ghost" onPress={() => nav.navigate('Programs')} />
    </Screen>
  );
}
