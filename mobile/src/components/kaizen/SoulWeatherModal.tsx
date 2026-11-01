import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { api } from '../../api/client';
import { noteCrisis } from '../../api/crisisShape';
import type { CrisisPayload } from '../../api/practice';
import { CrisisNotice } from '../CrisisNotice';
import { AppText, Button, Card, Field, Icon, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface SoulWeatherResult {
  validation: string;
  ritualTitle: string;
  ritualStep: string;
  crisis?: CrisisPayload;
}

interface SoulWeatherModalProps {
  visible: boolean;
  onClose: () => void;
  onAdoptRitual?: (title: string, description: string) => void;
}

const WEATHER_EMOJIS = [
  { emoji: '🌧️', label: 'Rainy' },
  { emoji: '⚡', label: 'Stormy' },
  { emoji: '🌫️', label: 'Foggy' },
  { emoji: '🍂', label: 'Autumn' },
  { emoji: '💔', label: 'Heavy' },
  { emoji: '🤯', label: 'Overwhelmed' },
  { emoji: '🌤️', label: 'Gentle' },
  { emoji: '🌸', label: 'Blooming' },
  { emoji: '☀️', label: 'Sunny' },
  { emoji: '🌊', label: 'Restless' },
];

export function SoulWeatherModal({ visible, onClose, onAdoptRitual }: SoulWeatherModalProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);
  const [textNote, setTextNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SoulWeatherResult | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);

  // Background tint cross-fade: 0 = rainy mist / neutral, 1 = warm peach morning glow
  const glowFade = useSharedValue(0);

  const toggleEmoji = (emoji: string) => {
    setSelectedEmojis((prev) =>
      prev.includes(emoji)
        ? prev.filter((e) => e !== emoji)
        : prev.length < 3
        ? [...prev, emoji]
        : [...prev.slice(1), emoji],
    );
  };

  const generate = async () => {
    if (!selectedEmojis.length) return;
    setLoading(true);
    setCrisis(null);
    try {
      const res = await api<SoulWeatherResult>('/kaizen/soul-weather', {
        method: 'POST',
        body: { emojis: selectedEmojis, textNote: textNote.trim() || undefined },
      });

      const foundCrisis = noteCrisis(res);
      if (foundCrisis || res.crisis) {
        setCrisis(foundCrisis ?? res.crisis ?? null);
        setLoading(false);
        return;
      }

      setResult(res);
      glowFade.value = withTiming(1, { duration: 1200 });
    } catch {
      // safe fallback
      setResult({
        validation: 'আপনার মনের আকাশে মেঘ জমেছে, কিন্তু প্রতিটি মেঘই একসময় শান্ত বাতাসে কেটে যায়।',
        ritualTitle: 'উষ্ণ তালু ও চোখের বিশ্রাম',
        ritualStep: 'দুটি হাত একসঙ্গে আলতো ঘষে উষ্ণ করে চোখের ওপর রাখুন। ৫ সেকেন্ড ঘরের স্নিগ্ধ নীরবতা শুনুন।',
      });
      glowFade.value = withTiming(1, { duration: 1200 });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setCrisis(null);
    setSelectedEmojis([]);
    setTextNote('');
    glowFade.value = 0;
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    backgroundColor: glowFade.value === 0
      ? (isDark ? '#1C1920' : '#F4F1F5')
      : (isDark ? '#2D1F27' : '#FFF5F0'),
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.sheet, animatedBackdropStyle, { borderColor: c.border }]}>
          {/* Header */}
          <Row style={styles.header}>
            <Row style={{ gap: 8 }}>
              <AppText size={20}>🌤️</AppText>
              <AppText size={18} weight="800">{t('kzSoulWeatherTitle')}</AppText>
            </Row>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={handleClose} style={{ padding: 6 }}>
              <Icon name="close" size={22} color={c.textMuted} />
            </Pressable>
          </Row>

          <ScrollView contentContainerStyle={styles.content}>
            {crisis ? (
              <CrisisNotice crisis={crisis} dismissLabel="notNow" onDismiss={() => setCrisis(null)} />
            ) : null}

            {!result ? (
              <>
                <AppText size={14} muted>{t('kzSoulWeatherSub')}</AppText>

                {/* Mood Emojis Grid */}
                <View style={styles.emojiGrid}>
                  {WEATHER_EMOJIS.map((item) => {
                    const sel = selectedEmojis.includes(item.emoji);
                    return (
                      <Pressable
                        key={item.emoji}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        accessibilityLabel={item.label}
                        onPress={() => toggleEmoji(item.emoji)}
                        style={[
                          styles.emojiBtn,
                          {
                            backgroundColor: sel ? (isDark ? '#4D2A3E' : '#FFE8EE') : (isDark ? '#26202B' : '#FFFFFF'),
                            borderColor: sel ? c.accent : c.border,
                            borderWidth: sel ? 2 : 1,
                          },
                        ]}
                      >
                        <AppText size={28}>{item.emoji}</AppText>
                        <AppText size={11} muted>{item.label}</AppText>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Optional Whisper Input */}
                <Field
                  value={textNote}
                  onChangeText={setTextNote}
                  placeholder={t('kzSoulWeatherNoteHint')}
                  multiline
                  maxLength={500}
                  style={{ minHeight: 64 }}
                />

                <Button
                  title={t('kzSoulWeatherBrew')}
                  variant="primary"
                  icon="sparkles"
                  disabled={!selectedEmojis.length}
                  loading={loading}
                  onPress={generate}
                />
              </>
            ) : (
              <View style={styles.resultBox}>
                {/* Validation Notice */}
                <Card tone="lavender" style={{ gap: 8, borderColor: '#F2C6DE' }}>
                  <Row style={{ gap: 6 }}>
                    <AppText size={16}>🌧️✨</AppText>
                    <AppText size={13} weight="700" style={{ color: c.accent }}>মনের প্রতি সহানুভূতি</AppText>
                  </Row>
                  <AppText size={15} style={{ lineHeight: 22 }}>{result.validation}</AppText>
                </Card>

                {/* 60s Sensory Ritual Card */}
                <Card style={{ gap: 10, borderColor: c.primary, borderWidth: 1.5 }}>
                  <Row style={{ gap: 8 }}>
                    <Icon name="leaf-outline" size={20} color={c.primary} />
                    <AppText size={16} weight="800" style={{ color: c.primary }}>{result.ritualTitle}</AppText>
                  </Row>
                  <AppText size={14} style={{ lineHeight: 22 }}>{result.ritualStep}</AppText>
                </Card>

                {/* Actions */}
                <Row style={{ gap: 10 }}>
                  {onAdoptRitual ? (
                    <Button
                      title={t('kzSoulWeatherAdopt')}
                      variant="primary"
                      style={{ flex: 1 }}
                      onPress={() => {
                        onAdoptRitual(result.ritualTitle, result.ritualStep);
                        handleClose();
                      }}
                    />
                  ) : null}
                  <Button
                    title="সম্পন্ন করেছি"
                    variant="secondary"
                    style={{ flex: 1 }}
                    onPress={handleClose}
                  />
                </Row>

                <Button title="আরেকবার আবহাওয়া দেখুন" variant="ghost" onPress={reset} />
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 14,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  emojiBtn: {
    width: '18%',
    aspectRatio: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  resultBox: {
    gap: 14,
    marginTop: 4,
  },
});

