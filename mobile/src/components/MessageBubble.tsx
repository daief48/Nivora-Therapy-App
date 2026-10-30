import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ChatMessage } from '../api/types';
import { useT } from '../i18n';
import { useTheme } from '../theme';
import { AvatarMini } from './Avatar';
import { TypingDots } from './Brand';
import { AppText, Icon, Row } from './ui';

export function MessageBubble({ m, onFeedback, onSpeak, onRetry, onEmergency, speaking }: {
  m: ChatMessage; onFeedback?: (id: string, v: 1 | -1) => void; onSpeak?: (text: string) => void; onRetry?: () => void; onEmergency?: () => void; speaking?: boolean;
}) {
  const { c, shadow } = useTheme();
  const t = useT();
  const mine = m.role === 'user';
  const pending = m.role === 'assistant' && m.content === '';
  const saved = m.id.startsWith('local-') === false;
  const corners = mine
    ? { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomLeftRadius: 22, borderBottomRightRadius: 6 }
    : { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomRightRadius: 22, borderBottomLeftRadius: 6 };
  const content = (
    <>
      {!mine ? <Row style={{ gap: 6 }}><AvatarMini size={22} /><AppText size={11} weight="800" style={{ color: c.primary, letterSpacing: 0.6 }}>{t('aiBadge')} · {t('appName')}</AppText></Row> : null}
      {pending ? <TypingDots /> : <AppText selectable style={mine ? { color: c.onBubbleUser } : undefined}>{m.content}</AppText>}
    </>
  );
  const pad = { paddingHorizontal: 14, paddingVertical: 10 };
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View accessible accessibilityLabel={`${mine ? '' : t('aiBadge') + ': '}${pending ? t('thinking') : m.content}`}
        style={[{ maxWidth: '88%', opacity: m.failed ? 0.6 : 1 }, corners, mine ? null : shadow('sm'), m.crisis && { borderWidth: 2, borderColor: c.danger }]}>
        {mine ? (
          <View style={[pad, corners, { backgroundColor: c.bubbleUser }]}>{content}</View>
        ) : (
          <View style={[pad, corners, { backgroundColor: c.bubbleAi, borderWidth: m.crisis ? 0 : StyleSheet.hairlineWidth, borderColor: c.border }]}>{content}</View>
        )}
      </View>
      {m.failed ? (
        <Row><AppText size={13} style={{ color: c.danger }}>{t('failedSend')}</AppText><Pressable accessibilityRole="button" onPress={onRetry} style={{ minHeight: 44, justifyContent: 'center' }}><AppText size={13} weight="700" style={{ color: c.primary }}>{t('retrySend')}</AppText></Pressable></Row>
      ) : null}
      {!mine && !pending && saved ? (
        <Row style={{ flexWrap: 'wrap', gap: 2 }}>
          {m.crisis && onEmergency ? <Pressable accessibilityRole="button" onPress={onEmergency} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}><AppText size={13} weight="700" style={{ color: c.danger }}>{t('emergency')}</AppText></Pressable> : null}
          {onSpeak ? <Pressable accessibilityRole="button" accessibilityLabel={speaking ? t('stopReading') : t('readAloud')} accessibilityState={{ selected: !!speaking }} onPress={() => onSpeak(m.content)} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}><Icon name={speaking ? 'stop' : 'volume-high-outline'} size={20} color={speaking ? c.primary : c.textMuted} /></Pressable> : null}
          {onFeedback ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={t('helpful')} accessibilityState={{ selected: m.feedback === 1 }} onPress={() => onFeedback(m.id, 1)} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}><Icon name={m.feedback === 1 ? 'thumbs-up' : 'thumbs-up-outline'} size={19} color={m.feedback === 1 ? c.primary : c.textMuted} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('notHelpful')} accessibilityState={{ selected: m.feedback === -1 }} onPress={() => onFeedback(m.id, -1)} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}><Icon name={m.feedback === -1 ? 'thumbs-down' : 'thumbs-down-outline'} size={19} color={m.feedback === -1 ? c.danger : c.textMuted} /></Pressable>
            </>
          ) : null}
        </Row>
      ) : null}
    </View>
  );
}
