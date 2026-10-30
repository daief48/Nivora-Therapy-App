import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useMe } from '../api/hooks';
import { SakuraPetals } from '../components/sakura';
import { MessageBubble } from '../components/MessageBubble';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText, Button, EmptyState, ErrorState, Field, Icon, Loading, OfflineBanner, Row } from '../components/ui';
import { useConversation } from '../hooks/useConversation';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { MAX_MESSAGE_CHARS } from '../config';
import { speak, stopSpeaking } from '../utils/speech';
import { track } from '../utils/analytics';

export function ChatScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootParams, 'Chat'>>();
  const me = useMe();
  const { fontScale, set } = useSettings();
  const language = me.data?.locale ?? 'en';
  const conv = useConversation({ sessionId: route.params?.sessionId, language, sessionType: 'TEXT' });
  const [input, setInput] = useState('');
  const scroll = useRef<any>(null);

  useEffect(() => { if (conv.cancelledText) setInput(conv.cancelledText); }, [conv.cancelledText]);
  useEffect(() => () => { stopSpeaking(); }, []);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }, [conv.messages]);

  const [speakingId, setSpeakingId] = useState<string | null>(null); // which reply is being read aloud
  const toggleSpeak = (id: string, txt: string) => {
    if (speakingId === id) { stopSpeaking(); setSpeakingId(null); return; }
    setSpeakingId(id);
    void speak(txt, language, { onDone: () => setSpeakingId((cur) => (cur === id ? null : cur)), onError: () => setSpeakingId(null) });
  };
  const [journalId, setJournalId] = useState(route.params?.journalEntryId);
  const submit = () => { const text = input; if (!text.trim()) return; setInput(''); void conv.send(text, journalId); setJournalId(undefined); };
  const cycleText = () => set({ fontScale: fontScale === 1 ? 1.15 : fontScale === 1.15 ? 1.3 : 1 });
  const feedback = async (id: string, value: 1 | -1) => {
    if (!conv.sessionId) return;
    try { await api(`/sessions/${conv.sessionId}/messages/${id}/feedback`, { method: 'POST', body: { value } }); track('message_feedback', { ok: value === 1 }); Alert.alert(t('feedbackThanks')); } catch { Alert.alert(t('errorTitle')); }
  };
  const end = () => Alert.alert(t('endSession'), t('endSessionBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('endNoSummary'), onPress: () => { void conv.finish(false).then(() => nav.goBack()); } },
    { text: t('endWithSummary'), onPress: () => { void conv.finish(true).then(() => nav.goBack()); } },
  ]);
  const clear = () => Alert.alert(t('clearConversation'), t('clearConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete'), style: 'destructive', onPress: () => { void conv.remove(); } },
  ]);

  if (conv.loadingHistory) return <Loading />;
  if (conv.historyError) return <ErrorState error={conv.historyError} onRetry={() => conv.refetchHistory()} />;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: c.cardAlt }}>
      <SakuraPetals count={3} height={340} />
      <OfflineBanner />
      <View style={{ padding: 8, backgroundColor: c.bgTop }}><AppText size={12} style={{ textAlign: 'center' }}>{t('chatDisclosure')}</AppText></View>
      <Row style={{ padding: 8, flexWrap: 'wrap' }}>
        <Button title={t('emergency')} icon="medkit-outline" variant="danger" onPress={() => nav.navigate('Emergency')} style={{ minHeight: 44 }} />
        <Button title="Aa" accessibilityLabel={t('textSize')} variant="secondary" onPress={cycleText} style={{ minHeight: 44, paddingVertical: 6 }} />
        <Button title={t('endSession')} variant="ghost" onPress={end} disabled={!conv.sessionId || conv.ended} style={{ minHeight: 44, paddingVertical: 6 }} />
        <Button title={t('clearConversation')} variant="ghost" onPress={clear} disabled={!conv.sessionId} style={{ minHeight: 44, paddingVertical: 6 }} />
      </Row>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {conv.messages.length === 0 ? <EmptyState icon="chatbubble-ellipses-outline" body={t('chatEmpty')} /> : null}
        {conv.messages.map((m) => (
          <MessageBubble key={m.id} m={m} onFeedback={feedback} speaking={speakingId === m.id} onSpeak={(txt) => toggleSpeak(m.id, txt)} onRetry={conv.retry} onEmergency={() => nav.navigate('Emergency')} />
        ))}
        {journalId ? <AppText size={13} muted>{t('shareWithAi')}: {t('journalTitle')}</AppText> : null}
        {conv.errorKey ? <AppText accessibilityRole="alert" style={{ color: c.danger }}>{t(conv.errorKey)}</AppText> : null}
        {conv.cancelledText ? <AppText size={13} muted>{t('cancelled')}</AppText> : null}
        {conv.ended ? <AppText muted>{t('sessionEnded')}</AppText> : null}
      </ScrollView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ padding: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 18px rgba(120,84,96,0.08)' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('quickVoice')} onPress={() => nav.navigate('Call', { mode: 'voice' })} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.tint[0], alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mic-outline" size={24} color={c.tintFg[0]} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Field value={input} onChangeText={setInput} placeholder={t('chatPlaceholder')} multiline maxLength={MAX_MESSAGE_CHARS} editable={!conv.busy && !conv.ended} style={{ minHeight: 48, maxHeight: 130, borderRadius: 24 }} accessibilityLabel={t('chatPlaceholder')} />
          </View>
          {conv.busy ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('stopGenerating')} onPress={conv.cancel} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.cardAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
              <Icon name="stop" size={22} color={c.text} />
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={t('send')} accessibilityState={{ disabled: !input.trim() || conv.ended }} onPress={submit} disabled={!input.trim() || conv.ended} style={{ opacity: !input.trim() || conv.ended ? 0.4 : 1, marginBottom: 2 }}>
              <LinearGradient colors={[c.gradA, c.gradB]} style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="send" size={22} color={c.onPrimary} />
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
