import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import {
  addMemory, deleteMemory, editMemory, forgetLearned, memoryOn, setContinuity,
  useMemoryMutation, useMemoryOverview, useMemoryPrefs, useUserMemories,
} from '../api/memory';
import { AppText, Button, Card, EmptyState, ErrorState, Field, Icon, Loading, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useTheme } from '../theme';

/** What Nivora remembers: a calm overview. Everything is switchable, editable and deletable at any time. */
export function MemoryScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<any>();
  const prefs = useMemoryPrefs();
  const overview = useMemoryOverview();
  const mine = useUserMemories();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const add = useMemoryMutation(addMemory);
  const edit = useMemoryMutation(editMemory);
  const del = useMemoryMutation(deleteMemory);
  const forget = useMemoryMutation(forgetLearned);
  const toggle = useMemoryMutation((on: boolean) => setContinuity(prefs.data, on));
  const enabled = memoryOn(prefs.data);

  const confirmDelete = (id: string) =>
    Alert.alert(t('memDeleteTitle'), t('memDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => del.mutate(id) },
    ]);
  const confirmForget = () =>
    Alert.alert(t('memForgetBtn'), t('memForgetBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('memForgetConfirm'), style: 'destructive', onPress: () => forget.mutate(undefined, { onSuccess: () => setNote(t('memForgetDone')) }) },
    ]);
  const flip = (on: boolean) => { setNote(null); toggle.mutate(on, { onError: () => setNote(t('memSaveFail')) }); };

  const DeleteBtn = ({ id }: { id: string }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={t('delete')} hitSlop={10} onPress={() => confirmDelete(id)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="trash-outline" size={20} color={c.danger} />
    </Pressable>
  );

  if (overview.isLoading || mine.isLoading) return <Screen><Loading /></Screen>;
  const failed = (overview.isError || !overview.data) && (mine.isError || !mine.data);
  if (failed) return <Screen><ErrorState error={overview.error} onRetry={() => { void overview.refetch(); void mine.refetch(); }} /></Screen>;

  const o = overview.data ?? { pinned: [], recent: [], themes: [], counts: { session: 0, user: 0, notes: 0 } };
  const own = mine.data ?? [];
  const nothing = o.pinned.length === 0 && o.recent.length === 0 && o.themes.length === 0 && own.length === 0;

  return (
    <Screen>
      <AppText size={26} weight="700" accessibilityRole="header">{t('memHeading')}</AppText>
      <AppText muted>{t('memLead')}</AppText>

      <Card tone="lavender">
        <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
          <AppText weight="700" style={{ flex: 1 }}>{t('memSwitchLabel')}</AppText>
          <Switch value={enabled} disabled={prefs.isLoading || toggle.isPending} onValueChange={flip} accessibilityLabel={t('memSwitchLabel')} trackColor={{ true: c.primary, false: c.border }} />
        </Row>
        {!enabled ? <AppText size={13} accessibilityLiveRegion="polite">{t('memOffNote')}</AppText> : null}
      </Card>
      {note ? <AppText size={13} accessibilityRole="alert" accessibilityLiveRegion="polite">{note}</AppText> : null}

      {nothing ? <EmptyState icon="bookmark-outline" body={t('memEmptyAll')} /> : null}

      {o.pinned.length > 0 ? (
        <>
          <SectionTitle>{t('memAboutYou')}</SectionTitle>
          {o.pinned.map((m) => (
            <Card key={m.id}><Row style={{ gap: 12 }}><AppText style={{ flex: 1 }}>{m.text}</AppText><DeleteBtn id={m.id} /></Row></Card>
          ))}
        </>
      ) : null}

      {o.recent.length > 0 ? (
        <>
          <SectionTitle>{t('memRecent')}</SectionTitle>
          {o.recent.map((m) => (
            <Card key={m.id}><Row style={{ gap: 12 }}><AppText style={{ flex: 1 }}>{m.text}</AppText><DeleteBtn id={m.id} /></Row></Card>
          ))}
        </>
      ) : null}

      {o.themes.length > 0 ? (
        <>
          <SectionTitle>{t('memThemes')}</SectionTitle>
          <Row style={{ flexWrap: 'wrap' }}>
            {o.themes.map((th) => (
              <View key={th.id} accessible accessibilityLabel={`${th.label}, ${th.count} ${t('memThemeCount')}`} style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
                <AppText size={14} weight="600">{th.label} · {th.count}</AppText>
              </View>
            ))}
          </Row>
        </>
      ) : null}

      <SectionTitle>{t('memAsked')}</SectionTitle>
      {own.length === 0 ? <AppText size={14} muted>{t('memAskedEmpty')}</AppText> : own.map((m) => (
        <Card key={m.id}>
          {editing === m.id ? (
            <>
              <Field value={draft} onChangeText={setDraft} maxLength={300} multiline accessibilityLabel={t('memEditLabel')} />
              <Row>
                <Button title={t('cancel')} variant="ghost" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                <Button title={t('memSave')} disabled={!draft.trim()} loading={edit.isPending} style={{ flex: 1 }}
                  onPress={() => edit.mutate({ id: m.id, text: draft.trim() }, { onSuccess: () => setEditing(null) })} />
              </Row>
            </>
          ) : (
            <Row style={{ gap: 4 }}>
              <AppText style={{ flex: 1 }}>{m.text}</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel={t('memEdit')} hitSlop={10} onPress={() => { setEditing(m.id); setDraft(m.text); }} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="create-outline" size={20} color={c.accent} />
              </Pressable>
              <DeleteBtn id={m.id} />
            </Row>
          )}
        </Card>
      ))}
      <Field value={text} onChangeText={setText} placeholder={t('memPlaceholder')} maxLength={300} accessibilityLabel={t('memAdd')} />
      <Button title={t('memAdd')} icon="bookmark-outline" disabled={!text.trim()} loading={add.isPending} onPress={() => add.mutate(text.trim(), { onSuccess: () => setText('') })} />
      <AppText size={13} muted>{t('memSayIt')}</AppText>

      <Card>
        <Button title={t('memSessionNotes')} variant="secondary" icon="document-text-outline" onPress={() => nav.navigate('SessionData')} />
        <Button title={t('memForgetBtn')} variant="ghost" icon="leaf-outline" loading={forget.isPending} onPress={confirmForget} />
      </Card>
    </Screen>
  );
}
