/**
 * NightWhispererSheet — bottom-sheet modal for pre-sleep cognitive offloading.
 *
 * Slides up from the bottom with a Reanimated spring animation.
 * Lets the user type a worry/thought, then calls POST /sleep/night-whisper.
 * On success shows: 💜 Validation | 🔄 Reframe | 🌙 Release with staggered fade-in.
 * "Moon Box" SVG animation represents the thought being stored away.
 * Crisis flag in response immediately shows <CrisisNotice> instead.
 *
 * i18n keys: slWhisperTitle, slWhisperHint, slWhisperSend, slWhisperSending,
 *            slWhisperValidation, slWhisperReframe, slWhisperRelease,
 *            slWhisperMoonBox, slWhisperClose.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';
import { api } from '../../api/client';
import type { CrisisPayload } from '../../api/practice';
import { noteCrisis } from '../../api/crisisShape';
import { useT } from '../../i18n';
import { radius, space, useTheme } from '../../theme';
import { AppText, Button, Field } from '../ui';
import { CrisisNotice } from '../CrisisNotice';

// ─── Props ────────────────────────────────────────────────────────────────────

interface NightWhispererSheetProps {
  visible: boolean;
  onClose: () => void;
}

// ─── API response shape ───────────────────────────────────────────────────────

interface NightWhisperResponse {
  validation: string;
  reframe: string;
  release: string;
  riskMode?: boolean;
}

// ─── Moon Box SVG animation ───────────────────────────────────────────────────

function MoonBoxAnimation() {
  const glowOpacity = useSharedValue(0);
  const circleOpacity = useSharedValue(0);

  useEffect(() => {
    // Fade in
    circleOpacity.value = withTiming(1, { duration: 400 });
    // Glow pulse then fade out
    glowOpacity.value = withSequence(
      withTiming(0.8, { duration: 600 }),
      withTiming(0.2, { duration: 600 }),
      withTiming(0.9, { duration: 500 }),
      withDelay(300, withTiming(0, { duration: 900 })),
    );
    // Circle fades out after glow
    circleOpacity.value = withDelay(
      1800,
      withTiming(0, { duration: 700 }),
    );
  }, [glowOpacity, circleOpacity]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));
  const circleStyle = useAnimatedStyle(() => ({ opacity: circleOpacity.value }));

  return (
    <Animated.View style={[styles.moonBoxWrap, circleStyle]}>
      {/* Glow halo */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.moonGlowHalo,
          glowStyle,
        ]}
      />
      <Svg width={60} height={60} viewBox="0 0 60 60">
        <Circle cx={30} cy={30} r={28} fill="#1A1E38" stroke="#8899E0" strokeWidth={2} />
      </Svg>
    </Animated.View>
  );
}

// ─── Staggered result section ─────────────────────────────────────────────────

function ResultSection({
  emoji,
  text,
  delay,
}: {
  emoji: string;
  text: string;
  delay: number;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 500 }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 400 }));
  }, [opacity, translateY, delay]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.resultSection, animStyle]}>
      <AppText size={18}>{emoji}</AppText>
      <AppText size={15} style={styles.resultText}>
        {text}
      </AppText>
    </Animated.View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NightWhispererSheet({ visible, onClose }: NightWhispererSheetProps) {
  const { c } = useTheme();
  const t = useT();

  const [thought, setThought] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<NightWhisperResponse | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState(false);
  const [showMoonBox, setShowMoonBox] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Sheet slide-up animation (translateY from 400 → 0)
  const translateY = useSharedValue(400);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
    } else {
      // Reset on close
      translateY.value = 400;
      setThought('');
      setSending(false);
      setResult(null);
      setCrisis(null);
      setError(false);
      setShowMoonBox(false);
    }
  }, [visible, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ─── Send thought ──────────────────────────────────────────────────────────

  async function handleSend() {
    if (!thought.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setError(false);

    try {
      const raw = await api<NightWhisperResponse | CrisisPayload>('/sleep/night-whisper', {
        method: 'POST',
        body: { text: thought.trim() },
        signal: controller.signal,
      });

      const crisisPayload = noteCrisis(raw);
      if (crisisPayload) {
        setCrisis(crisisPayload);
      } else if ((raw as NightWhisperResponse).riskMode) {
        // riskMode in body
        setCrisis({
          crisis: true,
          safety: { severity: 'HIGH', crisis: true, resources: [], message: '' },
        });
      } else {
        const res = raw as NightWhisperResponse;
        setResult(res);
        setShowMoonBox(true);
        // Hide moon box after its animation completes
        setTimeout(() => setShowMoonBox(false), 2800);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(true);
      }
    } finally {
      setSending(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Scrim */}
      <View style={styles.scrim}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: c.card },
            sheetStyle,
          ]}
        >
          {/* Handle bar */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <AppText size={20}>🌙</AppText>
            <AppText size={18} weight="700">
              {t('slWhisperTitle')}
            </AppText>
          </View>

          {/* Crisis notice */}
          {crisis ? (
            <CrisisNotice crisis={crisis} onDismiss={onClose} dismissLabel="notNow" />
          ) : result ? (
            /* ─── Success state ─────────────────────────── */
            <View style={styles.resultWrap}>
              {showMoonBox ? <MoonBoxAnimation /> : null}

              <ResultSection emoji="💜" text={result.validation} delay={0} />
              <ResultSection emoji="🔄" text={result.reframe} delay={180} />
              <ResultSection emoji="🌙" text={result.release} delay={360} />

              <View style={{ marginTop: space.md }}>
                <Button title={t('slWhisperClose')} onPress={onClose} variant="ghost" />
              </View>
            </View>
          ) : (
            /* ─── Input state ───────────────────────────── */
            <View style={styles.inputWrap}>
              <Field
                multiline
                maxLength={200}
                placeholder={t('slWhisperHint')}
                value={thought}
                onChangeText={setThought}
                style={styles.field}
              />

              {error ? (
                /* Fallback static release text */
                <AppText size={14} muted style={{ fontStyle: 'italic' }}>
                  {t('slWhisperRelease')}
                </AppText>
              ) : null}

              <Button
                title={sending ? t('slWhisperSending') : t('slWhisperSend')}
                onPress={handleSend}
                loading={sending}
                disabled={!thought.trim() || sending}
              />
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: space.lg,
    gap: space.md,
    paddingBottom: 48,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  inputWrap: {
    gap: space.md,
  },
  field: {
    minHeight: 120,
  },
  resultWrap: {
    gap: space.md,
  },
  resultSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  resultText: {
    flex: 1,
    lineHeight: 22,
  },
  moonBoxWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
  },
  moonGlowHalo: {
    borderRadius: 30,
    backgroundColor: '#8899E0',
  },
});
