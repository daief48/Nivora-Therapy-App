import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import { api } from '../api/client';
import { useInvalidatingMutation } from '../api/hooks';
import { AppText, Button, Card, Check, EmptyState, ErrorState, Field, Icon, Loading, QueryBoundary, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useTheme } from '../theme';

export interface SessionRow {
  sessionId: string; startedAt: string; endedAt: string | null; sessionType: string; lengthMin: number; phase: string; isIntake: boolean;
  moodBefore: number | null; moodAfter: number | null; themes: string[]; summary: string; progressNote: string; homeworkCount: number; finalized: boolean;
}
export interface SessionDetail extends SessionRow {
  note: { summary: string; progressNote: string; agenda: string[]; themes: string[]; techniques: string[]; keyInsights: string[]; unresolved: string[]; homework: string[] };
  homework: { id: string; title: string; dueDate: string | null; status: string; feedback: string | null }[];
  messageCount: number;
}
export interface SharedSample { id: string; createdAt: string; redactions: number; messages: { role: string; text: string }[] }

export const useTherapySessions = () => useQuery({ queryKey: ['therapy', 'sessions'], queryFn: () => api<SessionRow[]>('/therapy/sessions') });
export const useTherapySession = (id: string) => useQuery({ queryKey: ['therapy', 'session', id], queryFn: () => api<SessionDetail>(`/therapy/sessions/${id}`) });
export const useSharedSamples = () => useQuery({ queryKey: ['quality', 'samples'], queryFn: () => api<SharedSample[]>('/quality/samples') });

const ALL_KEYS = [['therapy'], ['quality']];
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(); } catch { return iso; } };

/** Hands the JSON to the user: a download on web, the OS share sheet on devices. The temporary file is removed straight after. */
export async function saveJson(json: string, filename: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(json);
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: filename });
    else throw new Error('sharing unavailable');
  } finally { try { file.delete(); } catch { /* already gone */ } }
}

type Confirm = { kind: 'one'; id: string } | { kind: 'all' } | { kind: 'samples' } | null;

export function SessionDataScreen() {
  const t = useT();
  const { c } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [alsoConvos, setAlsoConvos] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const sessions = useTherapySessions();
  const shared = useSharedSamples();

  const delOne = useInvalidatingMutation((id: string) => api(`/therapy/sessions/${id}`, { method: 'DELETE' }), ALL_KEYS);
  const delAll = useInvalidatingMutation((withConvos: boolean) => api(`/therapy/data${withConvos ? '?includeSessions=true' : ''}`, { method: 'DELETE' }), ALL_KEYS);
  const delSample = useInvalidatingMutation((id: string) => api(`/quality/samples/${id}`, { method: 'DELETE' }), [['quality']]);
  const delSamples = useInvalidatingMutation((_: void) => api('/quality/samples', { method: 'DELETE' }), [['quality']]);

  const run = async (fn: () => Promise<unknown>, okText: string, failText: string) => {
    try { await fn(); setNote({ text: okText, bad: false }); return true; } catch { setNote({ text: failText, bad: true }); return false; }
  };

  const doExport = async () => {
    setExporting(true); setNote(null);
    try {
      const data = await api('/therapy/export');
      await saveJson(JSON.stringify(data, null, 2), 'my-session-data.json');
      setNote({ text: t('dcExportDone'), bad: false });
    } catch { setNote({ text: t('dcExportFail'), bad: true }); } finally { setExporting(false); }
  };

  const doConfirm = async () => {
    const what = confirm; setConfirm(null);
    if (!what) return;
    if (what.kind === 'one') { if (await run(() => delOne.mutateAsync(what.id), t('dcDeleted'), t('dcDeleteFail'))) setOpenId(null); }
    else if (what.kind === 'all') { if (await run(() => delAll.mutateAsync(alsoConvos), t('dcDeleted'), t('dcDeleteFail'))) setOpenId(null); }
    else await run(() => delSamples.mutateAsync(undefined), t('dcDeleted'), t('dcDeleteFail'));
  };

  const confirmText = confirm?.kind === 'one' ? { title: t('dcDeleteOneTitle'), body: t('dcDeleteOneBody') }
    : confirm?.kind === 'all' ? { title: t('dcDeleteAllTitle'), body: t('dcDeleteAllBody') }
    : { title: t('dcSharedDeleteAll'), body: t('dcSharedBody') };

  return (
    <Screen>
      {openId ? (
        <DetailView id={openId} onBack={() => setOpenId(null)} onDelete={() => setConfirm({ kind: 'one', id: openId })} onNote={(text, bad) => setNote({ text, bad })} />
      ) : (
        <>
          <AppText size={26} weight="800" accessibilityRole="header">{t('dcTitle')}</AppText>
          <AppText size={13} muted>{t('dcIntro')}</AppText>
          {note ? <AppText size={14} accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: note.bad ? c.danger : c.text }}>{note.text}</AppText> : null}

          <QueryBoundary q={sessions}>
            {(rows) => rows.length === 0 ? <EmptyState icon="document-text-outline" title={t('dcEmptyTitle')} body={t('dcEmptyBody')} /> : (
              <>
                {rows.map((s) => (
                  <Pressable key={s.sessionId} accessibilityRole="button" accessibilityLabel={`${t('dcSessionOn', { date: fmtDate(s.startedAt) })}. ${s.summary || t('dcNoSummary')}`} onPress={() => setOpenId(s.sessionId)}>
                    <Card>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <AppText size={15} weight="700">{fmtDate(s.startedAt)}</AppText>
                        <Icon name="chevron-forward" size={18} color={c.textMuted} />
                      </Row>
                      {s.themes.length ? <AppText size={13} style={{ color: c.accent }}>{s.themes.join(' · ')}</AppText> : null}
                      <AppText size={14} muted numberOfLines={3}>{s.summary || t('dcNoSummary')}</AppText>
                    </Card>
                  </Pressable>
                ))}
              </>
            )}
          </QueryBoundary>

          <Button title={t('dcExport')} variant="secondary" icon="download-outline" onPress={doExport} loading={exporting} />
          <Button title={t('dcDeleteAll')} variant="danger" onPress={() => { setAlsoConvos(false); setConfirm({ kind: 'all' }); }} />

          <SectionTitle>{t('dcSharedTitle')}</SectionTitle>
          <AppText size={13} muted>{t('dcSharedBody')}</AppText>
          <QueryBoundary q={shared}>
            {(rows) => rows.length === 0 ? <AppText size={14} muted>{t('dcSharedEmpty')}</AppText> : (
              <>
                {rows.map((s) => (
                  <Card key={s.id} tone="alt">
                    <AppText size={14} weight="700">{t('dcSharedItem', { date: fmtDate(s.createdAt) })}</AppText>
                    <AppText size={12} muted>{t('dcSharedRedacted', { n: s.redactions })}</AppText>
                    {s.messages.map((m, i) => (
                      <AppText key={i} size={13}><AppText size={13} weight="700">{m.role === 'user' ? t('dcYou') : t('dcNivora')}: </AppText>{m.text}</AppText>
                    ))}
                    <Button title={t('dcSharedDelete')} variant="ghost" onPress={() => run(() => delSample.mutateAsync(s.id), t('dcDeleted'), t('dcDeleteFail'))} />
                  </Card>
                ))}
                <Button title={t('dcSharedDeleteAll')} variant="ghost" onPress={() => setConfirm({ kind: 'samples' })} />
              </>
            )}
          </QueryBoundary>
        </>
      )}

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View accessibilityViewIsModal style={{ backgroundColor: c.card, borderRadius: 20, padding: 16, gap: 12 }}>
            <AppText size={20} weight="700" accessibilityRole="header">{confirmText.title}</AppText>
            <AppText>{confirmText.body}</AppText>
            {confirm?.kind === 'all' ? <Check checked={alsoConvos} onToggle={() => setAlsoConvos((v) => !v)} label={t('dcAlsoConvos')} /> : null}
            <Row>
              <Button title={t('dcCancel')} variant="ghost" onPress={() => setConfirm(null)} style={{ flex: 1 }} />
              <Button title={t('dcConfirmDelete')} variant="danger" onPress={doConfirm} style={{ flex: 1 }} />
            </Row>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function DetailView({ id, onBack, onDelete, onNote }: { id: string; onBack: () => void; onDelete: () => void; onNote: (text: string, bad: boolean) => void }) {
  const t = useT();
  const q = useTherapySession(id);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState('');
  const [insights, setInsights] = useState('');
  const [themes, setThemes] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = useInvalidatingMutation((body: { summary: string; keyInsights: string[]; themes: string[] }) => api(`/therapy/sessions/${id}/note`, { method: 'PATCH', body }), [['therapy']]);

  useEffect(() => { setEditing(false); }, [id]);
  const startEdit = (d: SessionDetail) => { setSummary(d.note.summary); setInsights(d.note.keyInsights.join('\n')); setThemes(d.note.themes.join(', ')); setEditing(true); };
  const save = async () => {
    setBusy(true);
    try {
      await patch.mutateAsync({
        summary: summary.trim(),
        keyInsights: insights.split('\n').map((s) => s.trim()).filter(Boolean),
        themes: themes.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setEditing(false); onNote(t('dcSaved'), false);
    } catch { onNote(t('dcSaveFail'), true); } finally { setBusy(false); }
  };

  return (
    <>
      <Button title={t('dcBack')} variant="ghost" icon="chevron-back" onPress={onBack} />
      {q.isLoading ? <Loading /> : q.isError || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const d = q.data;
        return (
          <>
            <AppText size={24} weight="800" accessibilityRole="header">{t('dcSessionOn', { date: fmtDate(d.startedAt) })}</AppText>
            <AppText size={12} muted>{t('dcMessages', { n: d.messageCount })} · {t('dcHomeworkCount', { n: d.homework.length })}</AppText>
            {editing ? (
              <Card>
                <Field label={t('dcSummary')} value={summary} onChangeText={setSummary} multiline />
                <Field label={t('dcInsights')} hint={t('dcInsightsHint')} value={insights} onChangeText={setInsights} multiline />
                <Field label={t('dcThemes')} hint={t('dcThemesHint')} value={themes} onChangeText={setThemes} />
                <Row>
                  <Button title={t('dcCancel')} variant="ghost" onPress={() => setEditing(false)} style={{ flex: 1 }} />
                  <Button title={t('dcSave')} onPress={save} loading={busy} style={{ flex: 1 }} />
                </Row>
              </Card>
            ) : (
              <Card>
                <AppText size={15} weight="700">{t('dcSummary')}</AppText>
                <AppText size={14}>{d.note.summary || t('dcNoSummary')}</AppText>
                <AppText size={15} weight="700">{t('dcThemes')}</AppText>
                <AppText size={14}>{d.note.themes.length ? d.note.themes.join(' · ') : t('dcNone')}</AppText>
                <AppText size={15} weight="700">{t('dcInsights')}</AppText>
                {d.note.keyInsights.length ? d.note.keyInsights.map((k, i) => <AppText key={i} size={14}>{`• ${k}`}</AppText>) : <AppText size={14}>{t('dcNone')}</AppText>}
                <Button title={t('dcEdit')} variant="secondary" icon="create-outline" onPress={() => startEdit(d)} />
              </Card>
            )}
            <SectionTitle>{t('dcHomework')}</SectionTitle>
            {d.homework.length === 0 ? <AppText size={14} muted>{t('dcNoHomework')}</AppText> : d.homework.map((h) => (
              <Card key={h.id} tone="alt">
                <AppText size={14} weight="700">{h.title}</AppText>
                <AppText size={12} muted>{[h.status, h.dueDate].filter(Boolean).join(' · ')}</AppText>
                {h.feedback ? <AppText size={13}>{h.feedback}</AppText> : null}
              </Card>
            ))}
            <Button title={t('dcDeleteOne')} variant="danger" onPress={onDelete} />
          </>
        );
      })()}
    </>
  );
}
