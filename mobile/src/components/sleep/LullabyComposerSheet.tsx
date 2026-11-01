/**
 * LullabyComposerSheet — bottom-sheet modal for personalized AI sleep story generation.
 *
 * 3-step picker (setting → mood → length) then calls POST /sleep/lullaby.
 * Displays story title + body with a Luna typing indicator during loading.
 * Supports "Read aloud" via speak() and "Save story" to AsyncStorage.
 *
 * i18n keys: slLullabyTitle, slLullabySetting, slLullabyMood, slLullabyLength,
 *            slLullabyShort, slLullabyLong, slLullabyWrite, slLullabyWriting,
 *            slLullabyRead, slLullabySave, slLullabySaved,
 *            slLullabyCalm, slLullabyTired, slLullabyAnxious, slLullabyGrateful,
 *            slLullabyOcean, slLullabyForest, slLullabyCloud, slLullabyMountain,
 *            slLullabyMoonGarden.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { api } from '../../api/client';
import { useT } from '../../i18n';
import { radius, space, useTheme } from '../../theme';
import { speak } from '../../utils/speech';
import { AppText, Button } from '../ui';

// ─── Props ────────────────────────────────────────────────────────────────────

interface LullabyComposerSheetProps {
  visible: boolean;
  userName?: string;
  onClose: () => void;
}

// ─── API response shape ───────────────────────────────────────────────────────

interface LullabyResponse {
  title: string;
  body: string;
  lang: string; // 'bn' | 'en'
}

// ─── Picker option types ──────────────────────────────────────────────────────

type SettingKey = 'ocean' | 'forest' | 'cloud' | 'mountain' | 'moonGarden';
type MoodKey = 'calm' | 'tired' | 'anxious' | 'grateful';
type LengthKey = 'short' | 'long';

interface SettingOption {
  key: SettingKey;
  emoji: string;
  labelKey: string;
}

interface MoodOption {
  key: MoodKey;
  labelKey: string;
}

const SETTINGS: SettingOption[] = [
  { key: 'ocean',      emoji: '🌊', labelKey: 'slLullabyOcean' },
  { key: 'forest',     emoji: '🌲', labelKey: 'slLullabyForest' },
  { key: 'cloud',      emoji: '☁️', labelKey: 'slLullabyCloud' },
  { key: 'mountain',   emoji: '🏔️', labelKey: 'slLullabyMountain' },
  { key: 'moonGarden', emoji: '🌙', labelKey: 'slLullabyMoonGarden' },
];

const MOODS: MoodOption[] = [
  { key: 'calm',     labelKey: 'slLullabyCalm' },
  { key: 'tired',    labelKey: 'slLullabyTired' },
  { key: 'anxious',  labelKey: 'slLullabyAnxious' },
  { key: 'grateful', labelKey: 'slLullabyGrateful' },
];

const STORAGE_KEY = '@nivora_my_stories';

// ─── Luna typing indicator (3 bouncing dots) ──────────────────────────────────

function LunaTypingIndicator() {
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    const bounce = withRepeat(
      withSequence(withTiming(-8, { duration: 300 }), withTiming(0, { duration: 300 })),
      -1,
      false,
    );
    dot1.value = bounce;
    dot2.value = withDelay(120, bounce);
    dot3.value = withDelay(240, bounce);
  }, [dot1, dot2, dot3]);

  const d1 = useAnimatedStyle(() => ({ transform: [{ translateY: dot1.value }] }));
  const d2 = useAnimatedStyle(() => ({ transform: [{ translateY: dot2.value }] }));
  const d3 = useAnimatedStyle(() => ({ transform: [{ translateY: dot3.value }] }));

  return (
    <View style={styles.typingRow}>
      <AppText size={18}>🌙</AppText>
      <Animated.View style={[styles.dot, d1]} />
      <Animated.View style={[styles.dot, d2]} />
      <Animated.View style={[styles.dot, d3]} />
    </View>
  );
}

// ─── Pill selector ────────────────────────────────────────────────────────────

interface PillRowProps<K extends string> {
  options: Array<{ key: K; label: string; emoji?: string }>;
  selected: K | null;
  onSelect: (k: K) => void;
}

function PillRow<K extends string>({ options, selected, onSelect }: PillRowProps<K>) {
  const { c } = useTheme();
  return (
    <View style={styles.pillRow}>
      {options.map((o) => {
        const active = selected === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(o.key)}
            style={[
              styles.pill,
              {
                backgroundColor: active ? c.primary : c.cardAlt,
                borderColor: active ? c.primary : c.border,
              },
            ]}
          >
            {o.emoji ? <AppText size={16}>{o.emoji}</AppText> : null}
            <AppText
              size={13}
              weight="600"
              style={{ color: active ? '#fff' : c.text }}
            >
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LullabyComposerSheet({ visible, userName, onClose }: LullabyComposerSheetProps) {
  const { c } = useTheme();
  const t = useT();

  const [setting, setSetting] = useState<SettingKey | null>(null);
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [length, setLength] = useState<LengthKey | null>(null);

  const [writing, setWriting] = useState(false);
  const [story, setStory] = useState<LullabyResponse | null>(null);
  const [saved, setSaved] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Sheet slide-up
  const translateY = useSharedValue(500);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
    } else {
      // Reset everything on close
      translateY.value = 500;
      setSetting(null);
      setMood(null);
      setLength(null);
      setWriting(false);
      setStory(null);
      setSaved(false);
    }
  }, [visible, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ─── Generate story ──────────────────────────────────────────────────────────

  async function handleWrite() {
    if (!setting || !mood || !length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setWriting(true);

    try {
      const res = await api<LullabyResponse>('/sleep/lullaby', {
        method: 'POST',
        body: { setting, mood, length, userName },
        signal: controller.signal,
      });
      setStory(res);
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        // Silently fail — button returns to normal state
      }
    } finally {
      setWriting(false);
    }
  }

  // ─── Read aloud ──────────────────────────────────────────────────────────────

  function handleReadAloud() {
    if (!story) return;
    speak(story.body, story.lang as 'en' | 'bn', {});
  }

  // ─── Save story ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!story || !setting) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const existing: Array<{ title: string; body: string; setting: string; date: string }> =
        raw ? (JSON.parse(raw) as Array<{ title: string; body: string; setting: string; date: string }>) : [];
      existing.unshift({
        title: story.title,
        body: story.body,
        setting,
        date: new Date().toISOString(),
      });
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      setSaved(true);
      // Hide confirmation after 2.5 s
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // storage error — ignore
    }
  }

  // ─── Build picker option arrays with i18n labels ──────────────────────────────

  const settingOptions = SETTINGS.map((s) => ({
    key: s.key,
    label: t(s.labelKey as never),
    emoji: s.emoji,
  }));

  const moodOptions = MOODS.map((m) => ({
    key: m.key,
    label: t(m.labelKey as never),
  }));

  const lengthOptions: Array<{ key: LengthKey; label: string }> = [
    { key: 'short', label: t('slLullabyShort') },
    { key: 'long',  label: t('slLullabyLong') },
  ];

  const canWrite = !!setting && !!mood && !!length && !writing;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <Animated.View style={[styles.sheet, { backgroundColor: c.card }, sheetStyle]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Header */}
            <AppText size={20} weight="800" style={{ marginBottom: space.md }}>
              {t('slLullabyTitle')}
            </AppText>

            {story ? (
              /* ─── Story result ────────────────────────── */
              <View style={styles.storyWrap}>
                <AppText size={18} weight="700" style={{ lineHeight: 26 }}>
                  {story.title}
                </AppText>
                <AppText size={15} style={styles.storyBody}>
                  {story.body}
                </AppText>

                {/* Actions */}
                <View style={styles.actionRow}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={`🔊 ${t('slLullabyRead')}`}
                      onPress={handleReadAloud}
                      variant="secondary"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={`💾 ${t('slLullabySave')}`}
                      onPress={handleSave}
                      variant="secondary"
                    />
                  </View>
                </View>

                {/* Saved confirmation */}
                {saved ? (
                  <AppText size={13} muted style={{ textAlign: 'center' }}>
                    ✅ {t('slLullabySaved')}
                  </AppText>
                ) : null}

                <Button title="✕" onPress={onClose} variant="ghost" />
              </View>
            ) : writing ? (
              /* ─── Loading (Luna typing) ───────────────── */
              <View style={styles.loadingWrap}>
                <LunaTypingIndicator />
                <AppText size={14} muted style={{ textAlign: 'center' }}>
                  {t('slLullabyWriting')}
                </AppText>
              </View>
            ) : (
              /* ─── Picker steps ────────────────────────── */
              <View style={styles.pickerWrap}>
                {/* Step 1: Setting */}
                <AppText size={14} weight="700" muted>
                  1 · {t('slLullabySetting')}
                </AppText>
                <PillRow<SettingKey>
                  options={settingOptions}
                  selected={setting}
                  onSelect={setSetting}
                />

                {/* Step 2: Mood */}
                <AppText size={14} weight="700" muted>
                  2 · {t('slLullabyMood')}
                </AppText>
                <PillRow<MoodKey>
                  options={moodOptions}
                  selected={mood}
                  onSelect={setMood}
                />

                {/* Step 3: Length */}
                <AppText size={14} weight="700" muted>
                  3 · {t('slLullabyLength')}
                </AppText>
                <PillRow<LengthKey>
                  options={lengthOptions}
                  selected={length}
                  onSelect={setLength}
                />

                <Button
                  title={t('slLullabyWrite')}
                  onPress={handleWrite}
                  disabled={!canWrite}
                />
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: space.lg,
    paddingBottom: 48,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.md,
  },
  pickerWrap: {
    gap: space.md,
    paddingBottom: space.lg,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: space.md,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8899E0',
  },
  storyWrap: {
    gap: space.md,
    paddingBottom: space.lg,
  },
  storyBody: {
    fontStyle: 'italic',
    lineHeight: 26,
  },
  actionRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
});
