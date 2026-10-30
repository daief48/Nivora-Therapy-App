import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { api } from '../api/client';
import { useConsents, useInvalidatingMutation, useJournal } from '../api/hooks';
import type { JournalEntry } from '../api/types';
import {
  AppText, Button, Card, Chip, EmptyState, ErrorState, Field, Icon, IconCircle, Loading, QueryBoundary, Row, Screen,
} from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useTheme } from '../theme';

const TYPES = ['FREE', 'THOUGHT_RECORD', 'GRATITUDE', 'DAILY_REFLECTION', 'SLEEP_STRESS'] as const;
const PROMPTS: StringKey[] = ['prompt1', 'prompt2', 'prompt3', 'prompt4', 'prompt5'];
const typeLabel = (t: ReturnType<typeof useT>, type: string) => t(`type${type}` as StringKey);

export function JournalScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<string | undefined>();
  useEffect(() => { const id = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(id); }, [search]);
  const q = useJournal(debounced, type);
  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText size={28} weight="800" accessibilityRole="header">{t('journalTitle')}</AppText>
        <Icon name="lock-closed-outline" size={20} color={c.textMuted} />
      </Row>
      <AppText size={13} muted>{t('journalPrivate')}</AppText>
      <Button title={t('newEntry')} icon="add" onPress={() => nav.navigate('JournalEdit')} />
      <Field value={search} onChangeText={setSearch} placeholder={t('searchJournal')} accessibilityLabel={t('searchJournal')} style={{ borderRadius: 24 }} />
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={t('allTypes')} selected={!type} onPress={() => setType(undefined)} />
        {TYPES.map((x) => <Chip key={x} label={typeLabel(t, x)} selected={type === x} onPress={() => setType(x)} />)}
      </Row>
      <QueryBoundary q={q}>
        {(rows) => rows.length === 0 ? <EmptyState icon="book-outline" body={t('journalEmpty')} /> : (
          <>
            {rows.map((e) => (
              <Pressable key={e.id} accessibilityRole="button" onPress={() => nav.navigate('JournalEdit', { id: e.id })}>
                <Card>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <AppText size={12} weight="800" style={{ color: c.primary }}>{typeLabel(t, e.entryType)}</AppText>
                    <Row style={{ gap: 4 }}><Icon name="lock-closed-outline" size={12} color={c.textMuted} /><AppText size={12} muted>{new Date(e.createdAt).toLocaleDateString()}</AppText></Row>
                  </Row>
                  <AppText numberOfLines={4}>{e.content}</AppText>
                </Card>
              </Pressable>
            ))}
          </>
        )}
      </QueryBoundary>
    </Screen>
  );
}

export function JournalEditScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const id = useRoute<RouteProp<RootParams, 'JournalEdit'>>().params?.id;
  const entry = useQuery({ queryKey: ['journal-entry', id], enabled: !!id, queryFn: () => api<JournalEntry>(`/journal/${id}`) });
  const consents = useConsents();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(!id);
  const [err, setErr] = useState(false);
  const [promptIdx, setPromptIdx] = useState(() => new Date().getDate() % PROMPTS.length);
  useEffect(() => { if (entry.data && !loaded) { setText(entry.data.content); setLoaded(true); } }, [entry.data, loaded]);
  const keys = [['journal'], ['journal-entry', id ?? '']];
  const save = useInvalidatingMutation((cnt: string) => (id ? api(`/journal/${id}`, { method: 'PATCH', body: { content: cnt } }) : api('/journal', { method: 'POST', body: { content: cnt } })), keys);
  const del = useInvalidatingMutation(() => api(`/journal/${id}`, { method: 'DELETE' }), keys);
  const grant = useInvalidatingMutation(() => api('/consents', { method: 'POST', body: { consentType: 'JOURNAL_AI_SHARING' } }), [['consents']]);

  if (id && entry.isLoading) return <Screen><Loading /></Screen>;
  if (id && entry.isError) return <Screen><ErrorState error={entry.error} onRetry={() => entry.refetch()} /></Screen>;

  const share = () => {
    const go = () => nav.navigate('Chat', { journalEntryId: id });
    if (consents.data?.some((x) => x.consentType === 'JOURNAL_AI_SHARING' && !x.withdrawnAt)) { go(); return; }
    Alert.alert(t('shareConsentTitle'), t('shareConsentBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('agree'), onPress: () => { grant.mutateAsync(undefined as never).then(go).catch(() => Alert.alert(t('errorTitle'))); } },
    ]);
  };
  const remove = () => Alert.alert(t('deleteJournalConfirm'), undefined, [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete'), style: 'destructive', onPress: () => { del.mutateAsync(undefined as never).then(() => nav.goBack()).catch(() => Alert.alert(t('errorTitle'))); } },
  ]);

  return (
    <Screen>
      <Row><Icon name="lock-closed-outline" size={16} color={c.textMuted} /><AppText size={13} muted>{t('privateEntry')}</AppText></Row>
      {!id ? (
        <Card tone="lavender">
          <Row style={{ justifyContent: 'space-between' }}>
            <Row><IconCircle icon="sparkles-outline" tone={1} size={34} /><AppText size={13} weight="800" style={{ color: c.accent }}>{t('promptLabel')}</AppText></Row>
            <Pressable accessibilityRole="button" accessibilityLabel={t('retry')} onPress={() => setPromptIdx((promptIdx + 1) % PROMPTS.length)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="refresh-outline" size={20} color={c.accent} />
            </Pressable>
          </Row>
          <AppText>{t(PROMPTS[promptIdx]!)}</AppText>
          <Button title={t('usePrompt')} variant="secondary" onPress={() => setText((cur) => (cur ? `${cur}\n\n` : '') + t(PROMPTS[promptIdx]!) + '\n')} />
        </Card>
      ) : entry.data ? <AppText size={12} weight="800" style={{ color: c.primary }}>{typeLabel(t, entry.data.entryType)}</AppText> : null}
      <Field value={text} onChangeText={setText} placeholder={t('writeEntry')} accessibilityLabel={t('writeEntry')} multiline maxLength={20000} style={{ minHeight: 260, borderRadius: 20 }} />
      {err ? <AppText accessibilityRole="alert" style={{ color: c.danger }}>{t('errorTitle')}</AppText> : null}
      <Button title={t('save')} icon="checkmark" disabled={!text.trim()} loading={save.isPending}
        onPress={async () => { setErr(false); try { await save.mutateAsync(text.trim()); nav.goBack(); } catch { setErr(true); } }} />
      {id ? (
        <View style={{ gap: 10 }}>
          <Button title={t('shareWithAi')} variant="secondary" icon="sparkles-outline" onPress={share} />
          <Button title={t('delete')} variant="ghost" icon="trash-outline" onPress={remove} loading={del.isPending} />
        </View>
      ) : null}
    </Screen>
  );
}
