import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import type { ChatMessage } from '../api/types';
import { useT } from '../i18n';
import { duration, easing, spring, TypeWriter, useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { secondBubbleDelayMs, splitReply, TYPING_DELAY_MS } from '../utils/humanFeel';
import { AiBadge } from './AiBadge';
import { AvatarMini } from './Avatar';
import { AppText, Icon, Row } from './ui';

/** Three softly pulsing dots while the reply is on its way. Still (mid-opacity) under reduced motion. */
export function SoftTypingDots() {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const a = useSharedValue(0.4), b = useSharedValue(0.4), d = useSharedValue(0.4);
  useEffect(() => {
    const vals = [a, b, d];
    if (reduced) { vals.forEach((v) => { v.value = 0.5; }); return; }
    vals.forEach((v, i) => {
      v.value = withDelay(i * 220, withRepeat(withSequence(withTiming(1, { duration: duration.calm, easing: easing.breath }), withTiming(0.35, { duration: duration.calm, easing: easing.breath })), -1, false));
    });
    return () => vals.forEach((v) => cancelAnimation(v));
  }, [reduced, a, b, d]);
  const sa = useAnimatedStyle(() => ({ opacity: a.value, transform: [{ scale: 0.8 + 0.2 * a.value }] }));
  const sb = useAnimatedStyle(() => ({ opacity: b.value, transform: [{ scale: 0.8 + 0.2 * b.value }] }));
  const sd = useAnimatedStyle(() => ({ opacity: d.value, transform: [{ scale: 0.8 + 0.2 * d.value }] }));
  const dot = { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary };
  return (
    <View testID="typing-dots" style={{ flexDirection: 'row', gap: 6, paddingVertical: 8, paddingHorizontal: 2 }}>
      {[sa, sb, sd].map((st, i) => <Animated.View key={i} style={[dot, st]} />)}
    </View>
  );
}

/** The typing dots show up a beat after send (never instantly). Immediate and still under reduced motion. The space is held so nothing jumps. */
export function DelayedTypingDots() {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(reduced);
  useEffect(() => {
    if (reduced) { setOn(true); return; }
    const id = setTimeout(() => setOn(true), TYPING_DELAY_MS);
    return () => clearTimeout(id);
  }, [reduced]);
  return on ? <SoftTypingDots /> : <View testID="typing-wait" style={{ height: 24 }} />;
}

/** Soft arrival: a short spring (just a fade in quiet mode). New replies only; static under reduced motion. */
function Arrive({ on, quiet, children, style }: { on: boolean; quiet: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const animate = on && !reduced;
  const p = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) { p.value = 1; return; }
    p.value = quiet ? withTiming(1, { duration: duration.slow, easing: easing.out }) : withSpring(1, spring.soft);
  }, [animate, quiet, p]);
  const st = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.4), transform: quiet ? [] : [{ translateY: (1 - p.value) * 14 }, { scale: 0.96 + 0.04 * p.value }] }));
  if (!animate) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, st]}>{children}</Animated.View>;
}

/**
 * `fresh`: a reply that arrived during this visit (not history). It springs in, and if it lands whole it is revealed with TypeWriter.
 * Replies that streamed in live are shown as they are (they already appeared progressively).
 * `quiet`: a gentler mode for heavy moments: slower reveal, no bounce.
 */
export function MessageBubble({ m, onFeedback, onSpeak, onRetry, onEmergency, speaking, fresh = false, quiet = false, finished = false }: {
  m: ChatMessage; onFeedback?: (id: string, v: 1 | -1) => void; onSpeak?: (text: string) => void; onRetry?: () => void; onEmergency?: () => void; speaking?: boolean;
  fresh?: boolean; quiet?: boolean;
  /** The reply is complete (not streaming). A fresh, finished, longer reply may show as two bubbles; it is still ONE message (feedback, read-aloud and screen readers use the whole text). */
  finished?: boolean;
}) {
  const { c, shadow } = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  // Once the text changes between two non-empty values it is streaming live and needs no extra reveal.
  const prev = useRef(m.content);
  const streamed = useRef(false);
  if (prev.current !== '' && m.content !== prev.current) streamed.current = true;
  prev.current = m.content;
  const reveal = fresh && !streamed.current && !reduced && m.role === 'assistant' && m.content !== '';
  const mine = m.role === 'user';
  const pending = m.role === 'assistant' && m.content === '';
  const saved = m.id.startsWith('local-') === false;
  const corners = mine
    ? { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomLeftRadius: 22, borderBottomRightRadius: 6 }
    : { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomRightRadius: 22, borderBottomLeftRadius: 6 };
  const parts = !mine && finished && fresh && !pending && !m.crisis && !m.noSplit && !m.failed ? splitReply(m.content) : null;
  const tail = parts?.[1];
  const [showSecond, setShowSecond] = useState(false);
  useEffect(() => {
    if (!tail) { setShowSecond(false); return; }
    if (reduced) { setShowSecond(true); return; }
    const id = setTimeout(() => setShowSecond(true), secondBubbleDelayMs(tail.length));
    return () => clearTimeout(id);
  }, [tail, reduced]);
  const head = parts ? parts[0] : m.content;
  const content = (
    <>
      {!mine ? <Row style={{ gap: 6 }}><AvatarMini size={22} /><AppText size={11} weight="800" style={{ color: c.primary, letterSpacing: 0.6 }}>{t('aiBadge')} · {t('appName')}</AppText></Row> : null}
      {!mine && m.ai ? <AiBadge ai /> : null}
      {pending ? <DelayedTypingDots /> : reveal ? <TypeWriter text={head} slow={quiet} /> : <AppText selectable style={mine ? { color: c.onBubbleUser } : undefined}>{head}</AppText>}
    </>
  );
  const pad = { paddingHorizontal: 14, paddingVertical: 10 };
  const shell = (node: React.ReactNode, key: string) => (
    <View key={key} style={[corners, mine ? null : shadow('sm'), m.crisis && { borderWidth: 2, borderColor: c.danger }]}>
      {mine ? (
        <View style={[pad, corners, { backgroundColor: c.bubbleUser }]}>{node}</View>
      ) : (
        <View style={[pad, corners, { backgroundColor: c.bubbleAi, borderWidth: m.crisis ? 0 : StyleSheet.hairlineWidth, borderColor: c.border }]}>{node}</View>
      )}
    </View>
  );
  return (
    <Arrive on={fresh && !mine} quiet={quiet} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {/* one accessible element for the whole reply, even when it is drawn as two bubbles: read once, with the full text */}
      <View accessible accessibilityLabel={`${mine ? '' : t('aiBadge') + ': '}${pending ? t('thinking') : m.content}`}
        style={{ maxWidth: '88%', opacity: m.failed ? 0.6 : 1, gap: 6, alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {shell(content, 'a')}
        {tail && showSecond ? shell(<AppText selectable testID="bubble-second">{tail}</AppText>, 'b') : null}
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
    </Arrive>
  );
}
