import { StackActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useMe } from '../api/hooks';
import { callModeOf, modesOf, sittingErrorKey, switchSittingMode, useProgram, type SittingMode } from '../api/sessionPrograms';
import { SakuraPetals } from '../components/sakura';
import { MessageBubble } from '../components/MessageBubble';
import { SessionBar, useSittingClock } from '../components/SessionBar';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText, Button, EmptyState, ErrorState, Field, Icon, Loading, OfflineBanner, Row } from '../components/ui';
import { useConversation, type ConversationOptions } from '../hooks/useConversation';
import { useT } from '../i18n';
import { useReducedMotion } from '../motion';
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
  // Guided-session options chosen in the lobby are sent when the session is created.
  // A sitting is a session row, so its id doubles as the session id; programId is only used to open the right summary.
  const sittingId = route.params?.sittingId;
  const programId = route.params?.programId;
  const reduced = useReducedMotion();
  const base: ConversationOptions = { humanPacing: !reduced, sessionId: route.params?.sessionId ?? sittingId, language, sessionType: 'TEXT', sessionOpts: route.params?.opts };
  const conv = useConversation(base);
  const lastId = conv.messages[conv.messages.length - 1]?.id;
  const clock = useSittingClock(conv.sessionId);
  const left = clock.remainingSec;
  const qc = useQueryClient();
  // Voice and video are only offered inside a sitting, and only when the program allows them.
  const program = useProgram(sittingId ? programId : undefined);
  const callModes = modesOf(program.data).filter((m): m is 'VOICE' | 'VIDEO' => m !== 'TEXT');
  const [switching, setSwitching] = useState(false);
  const [input, setInput] = useState('');
  const scroll = useRef<any>(null);
  // Replies from this visit are "fresh" (spring-in / reveal); history is not. A streamed local reply keeps its key when the server id replaces it, so it never re-animates.
  const keys = useRef(new Map<string, string>());
  const freshServer = useRef(new Set<string>());
  const prevMsgs = useRef(conv.messages);
  conv.messages.forEach((m, i) => {
    const was = prevMsgs.current[i];
    if (was && was.id !== m.id && was.role === 'assistant' && m.role === 'assistant' && was.id.startsWith('local-')) { keys.current.set(m.id, keys.current.get(was.id) ?? was.id); freshServer.current.add(m.id); }
  });
  prevMsgs.current = conv.messages;
  // Quiet mode, from signals already on the client: a safety result with any severity above NONE (conv.crisisResources) or a reply flagged crisis. The model's hidden intensity is never exposed to the app.
  const quiet = conv.crisisResources != null || conv.messages.some((m) => m.crisis);

  useEffect(() => { if (conv.cancelledText) setInput(conv.cancelledText); }, [conv.cancelledText]);
  useEffect(() => () => { stopSpeaking(); }, []);
  const toSummary = () => { if (conv.sessionId) nav.dispatch(StackActions.replace('SessionSummary', { sessionId: conv.sessionId, ...(programId ? { programId } : {}) })); };
  // The server closed the sitting (time box reached): wrap up gently by opening the summary.
  useEffect(() => { if (conv.errorCode === 'SITTING_TIME_UP' && conv.sessionId) toSummary(); }, [conv.errorCode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Idle at zero: the server only wraps a sitting up when a message arrives after time-up, so close it here (best effort). Someone in a crisis view is never cut off.
  useEffect(() => { if (sittingId && left === 0 && !conv.ended && !quiet && conv.sessionId) void conv.finish(true).catch(() => undefined); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }, [conv.messages]);

  const toCall = async (mode: Exclude<SittingMode, 'TEXT'>) => {
    if (!programId || !sittingId || switching) return;
    setSwitching(true);
    try { await switchSittingMode(programId, sittingId, mode); } catch (e) {
      setSwitching(false);
      void qc.invalidateQueries({ queryKey: ['therapy'] });
      Alert.alert(t(sittingErrorKey(e) ?? 'errorTitle'));
      return;
    }
    setSwitching(false);
    nav.dispatch(StackActions.replace('Call', { mode: callModeOf(mode), sittingId, programId }));
  };

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
    { text: t('endWithSummary'), onPress: () => { void conv.finish(true).then(() => { if (conv.sessionId) toSummary(); else nav.goBack(); }); } },
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
      <View style={{ paddingTop: 6 }}><SessionBar sessionId={conv.sessionId} /></View>
      {left != null && left > 0 && left <= 60 ? (
        <AppText size={13} accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ textAlign: 'center', paddingHorizontal: 12, paddingTop: 6 }}>{t('spOneMinute')}</AppText>
      ) : null}
      {(left === 0 || (conv.ended && sittingId)) && conv.sessionId ? (
        <View style={{ padding: 10, gap: 6, alignItems: 'center' }}>
          <AppText size={14} accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>{t('spTimeUp')}</AppText>
          <Button title={t('spSeeSummary')} variant="secondary" onPress={toSummary} style={{ minHeight: 44 }} />
        </View>
      ) : null}
      <Row style={{ padding: 8, flexWrap: 'wrap' }}>
        <Button title={t('emergency')} icon="medkit-outline" variant="danger" onPress={() => nav.navigate('Emergency')} style={{ minHeight: 44 }} />
        {callModes.includes('VOICE') && !conv.ended && left !== 0 ? <Button title={t('spSwitchVoice')} icon="mic-outline" variant="secondary" disabled={switching} onPress={() => { void toCall('VOICE'); }} style={{ minHeight: 44, paddingVertical: 6 }} /> : null}
        {callModes.includes('VIDEO') && !conv.ended && left !== 0 ? <Button title={t('spSwitchVideo')} icon="videocam-outline" variant="secondary" disabled={switching} onPress={() => { void toCall('VIDEO'); }} style={{ minHeight: 44, paddingVertical: 6 }} /> : null}
        <Button title="Aa" accessibilityLabel={t('textSize')} variant="secondary" onPress={cycleText} style={{ minHeight: 44, paddingVertical: 6 }} />
        <Button title={t('endSession')} variant="ghost" onPress={end} disabled={!conv.sessionId || conv.ended} style={{ minHeight: 44, paddingVertical: 6 }} />
        <Button title={t('clearConversation')} variant="ghost" onPress={clear} disabled={!conv.sessionId} style={{ minHeight: 44, paddingVertical: 6 }} />
      </Row>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {conv.messages.length === 0 ? <EmptyState icon="chatbubble-ellipses-outline" body={t('chatEmpty')} /> : null}
        {conv.messages.map((m) => (
          <MessageBubble key={keys.current.get(m.id) ?? m.id} m={m} quiet={quiet} finished={!(conv.busy && m.id === lastId)} fresh={m.id.startsWith('local-') || freshServer.current.has(m.id)} onFeedback={feedback} speaking={speakingId === m.id} onSpeak={(txt) => toggleSpeak(m.id, txt)} onRetry={conv.retry} onEmergency={() => nav.navigate('Emergency')} />
        ))}
        {journalId ? <AppText size={13} muted>{t('shareWithAi')}: {t('journalTitle')}</AppText> : null}
        {conv.errorKey ? <AppText accessibilityRole="alert" style={{ color: c.danger }}>{t(conv.errorKey)}</AppText> : null}
        {conv.cancelledText ? <AppText size={13} muted>{t('cancelled')}</AppText> : null}
        {conv.ended ? <AppText muted>{t('sessionEnded')}</AppText> : null}
      </ScrollView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ padding: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 18px rgba(120,84,96,0.08)' }}>
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
