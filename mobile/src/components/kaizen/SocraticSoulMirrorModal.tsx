import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '../../api/client';
import { noteCrisis } from '../../api/crisisShape';
import type { CrisisPayload } from '../../api/practice';
import { Avatar, type ReactionEvent } from '../Avatar';
import { CrisisNotice } from '../CrisisNotice';
import { AppText, Button, Card, Field, Icon, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface ChatMessage {
  id: string;
  sender: 'user' | 'nivora';
  text: string;
}

interface SocraticSoulMirrorModalProps {
  visible: boolean;
  onClose: () => void;
  programId: string;
  day: number;
  lessonTitle: string;
  lessonContext: string;
}

export function SocraticSoulMirrorModal({
  visible,
  onClose,
  programId,
  day,
  lessonTitle,
  lessonContext,
}: SocraticSoulMirrorModalProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [reaction, setReaction] = useState<ReactionEvent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);

  const handleSend = async () => {
    const doubt = input.trim();
    if (!doubt || loading) return;

    const userMsg: ChatMessage = { id: `u_${Date.now()}`, sender: 'user', text: doubt };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setCrisis(null);

    // Avatar tilts thoughtfully while examining
    setReaction({ type: 'curious', key: Date.now() });

    try {
      const res = await api<{ reply: string | null; crisis?: CrisisPayload | null }>(
        `/programs/${programId}/days/${day}/chat`,
        {
          method: 'POST',
          body: {
            lessonContext: `${lessonTitle}: ${lessonContext.slice(0, 300)}`,
            userDoubt: doubt,
          },
        },
      );

      const foundCrisis = noteCrisis(res);
      if (foundCrisis || res.crisis) {
        setCrisis(foundCrisis ?? res.crisis ?? null);
        setReaction({ type: 'concern', key: Date.now() });
        setLoading(false);
        return;
      }

      if (res.reply) {
        const aiMsg: ChatMessage = { id: `n_${Date.now()}`, sender: 'nivora', text: res.reply };
        setMessages((prev) => [...prev, aiMsg]);
        // Avatar smiles warmly when delivering the insight
        setReaction({ type: 'joy', key: Date.now() });
      }
    } catch {
      const fallbackMsg: ChatMessage = {
        id: `n_${Date.now()}`,
        sender: 'nivora',
        text: 'এই ভাবনাটি মনে আসা খুবই স্বাভাবিক। আজকের পাঠের আলোকে ভাবুন তো—এই চিন্তাটি কি সত্যিই নিশ্চিত, নাকি এর পেছনে একটি নরম শান্ত ব্যাখ্যাও থাকতে পারে?',
      };
      setMessages((prev) => [...prev, fallbackMsg]);
      setReaction({ type: 'empathy', key: Date.now() });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setInput('');
    setMessages([]);
    setCrisis(null);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: isDark ? '#1F1A24' : '#FFFFFF', borderColor: c.border }]}>
          {/* Top Bar with Avatar */}
          <Row style={styles.topBar}>
            <View style={styles.avatarWrapper}>
              <Avatar
                state={loading ? 'thinking' : 'idle'}
                reaction={reaction}
                tone={loading ? 'warm' : 'cheerful'}
                size={84}
              />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText size={16} weight="800">
                {t('kzSocraticTitle')}
              </AppText>
              <AppText size={12} muted>
                {t('kzSocraticSub')} · {lessonTitle}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={handleClose}
              style={{ padding: 6 }}
            >
              <Icon name="close" size={22} color={c.textMuted} />
            </Pressable>
          </Row>

          {/* Conversation Thread */}
          <ScrollView contentContainerStyle={styles.chatArea}>
            {crisis ? (
              <CrisisNotice crisis={crisis} dismissLabel="notNow" onDismiss={() => setCrisis(null)} />
            ) : null}

            {messages.length === 0 ? (
              <Card tone="lavender" style={{ gap: 8, marginVertical: 10 }}>
                <Row style={{ gap: 8 }}>
                  <Icon name="bulb-outline" size={18} color={c.primary} />
                  <AppText size={13} weight="700" style={{ color: c.primary }}>
                    সক্রেটিক ভাবনা যাচাই
                  </AppText>
                </Row>
                <AppText size={14} muted style={{ lineHeight: 22 }}>
                  আজকের পাঠ নিয়ে আপনার মনের কোনো দ্বিধা বা নেতিবাচক চিন্তা থাকলে লিখুন। নিভোরা কোনো প্রেসক্রিপশন দেবে না, বরং শান্ত প্রশ্নের মাধ্যমে আপনার চিন্তার সত্যতা যাচাই করতে সাহায্য করবে।
                </AppText>
              </Card>
            ) : null}

            {messages.map((m) => (
              <View
                key={m.id}
                style={[
                  styles.bubble,
                  m.sender === 'user'
                    ? [styles.userBubble, { backgroundColor: c.primary }]
                    : [styles.aiBubble, { backgroundColor: isDark ? '#2E2536' : '#F6EEF4', borderColor: c.border }],
                ]}
              >
                <AppText
                  size={14}
                  style={[
                    styles.bubbleText,
                    m.sender === 'user' && { color: '#FFFFFF' },
                  ]}
                >
                  {m.text}
                </AppText>
              </View>
            ))}

            {loading ? (
              <Row style={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}>
                <Icon name="ellipsis-horizontal" size={18} color={c.accent} />
                <AppText size={13} muted style={{ color: c.accent }}>
                  নিভোরা গভীর মনোযোগ দিয়ে ভাবছে...
                </AppText>
              </Row>
            ) : null}
          </ScrollView>

          {/* Input Row */}
          <View style={[styles.inputRow, { borderColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Field
                value={input}
                onChangeText={setInput}
                placeholder={t('kzSocraticHint')}
                multiline
                maxLength={400}
                style={{ minHeight: 44, maxHeight: 90 }}
              />
            </View>
            <Button
              title={t('kzSocraticSend')}
              icon="send"
              disabled={!input.trim()}
              loading={loading}
              onPress={handleSend}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    height: '82%',
    paddingBottom: 20,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2D5DF',
  },
  avatarWrapper: {
    width: 60,
    height: 66,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatArea: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  bubble: {
    maxWidth: '82%',
    padding: 12,
    borderRadius: radius.lg,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  bubbleText: {
    lineHeight: 22,
  },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

