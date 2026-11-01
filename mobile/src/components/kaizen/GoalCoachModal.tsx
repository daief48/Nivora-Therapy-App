import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { api } from '../../api/client';
import { noteCrisis } from '../../api/crisisShape';
import type { CrisisPayload } from '../../api/practice';
import { tapHaptic, successHaptic } from '../../motion/haptics';
import { Avatar, type ReactionEvent } from '../Avatar';
import { CrisisNotice } from '../CrisisNotice';
import { AppText, Button, Card, Field, Row } from '../ui';
import { radius, space, useTheme } from '../../theme';
import { useT } from '../../i18n';

export interface GoalSetupResult {
  refinedTitle: string;
  whyItMatters: string;
  starterActionTitle: string;
  starterActionDescription: string;
  estimatedMinutes: number;
  category: string;
  crisis?: CrisisPayload;
}

export interface PdcaCheckInResult {
  reflection: string;
  nextActionTitle: string;
  nextActionDescription: string;
  adjustment: 'SIMPLIFY' | 'STEADY' | 'GROW';
  crisis?: CrisisPayload;
}

export interface GoalCoachModalProps {
  visible: boolean;
  mode?: 'SETUP' | 'CHECKIN';
  checkinData?: {
    goalTitle: string;
    actionTitle: string;
    status: 'DONE' | 'PARTIAL' | 'SKIPPED';
    difficultyFeedback?: string;
    feltLevel?: number;
    userNote?: string;
  };
  onClose: () => void;
  onAdoptGoal?: (goal: { title: string; category: string; targetDirection?: string }) => void;
}

export function GoalCoachModal({
  visible,
  mode = 'SETUP',
  checkinData,
  onClose,
  onAdoptGoal,
}: GoalCoachModalProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  // Setup state
  const [rawGoal, setRawGoal] = useState('');
  const [timeMin, setTimeMin] = useState(2);
  const [setupResult, setSetupResult] = useState<GoalSetupResult | null>(null);

  // Checkin state
  const [checkinResult, setCheckinResult] = useState<PdcaCheckInResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [reaction, setReaction] = useState<ReactionEvent | undefined>(undefined);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);

  // Animated card slide/spring
  const sheetTranslateY = useSharedValue(200);

  useEffect(() => {
    if (visible) {
      sheetTranslateY.value = withSpring(0, { damping: 14, stiffness: 100 });
      setCrisis(null);

      if (mode === 'CHECKIN' && checkinData) {
        // Automatically fetch checkin reflection
        void fetchCheckin(checkinData);
      }
    } else {
      sheetTranslateY.value = 200;
      setSetupResult(null);
      setCheckinResult(null);
      setRawGoal('');
      setReaction(undefined);
    }
  }, [visible, mode, checkinData, sheetTranslateY]);

  const fetchCheckin = async (data: NonNullable<GoalCoachModalProps['checkinData']>) => {
    setLoading(true);
    setReaction({ type: 'curious', key: Date.now() });

    try {
      const res = await api<PdcaCheckInResult>('/kaizen/coach/checkin', {
        method: 'POST',
        body: data,
      });

      const foundCrisis = noteCrisis(res);
      if (foundCrisis || res.crisis) {
        setCrisis(foundCrisis ?? res.crisis ?? null);
        setLoading(false);
        return;
      }

      setCheckinResult(res);
      setReaction({ type: 'joy', key: Date.now() });
      successHaptic();
    } catch {
      // Curated local fallback
      setCheckinResult({
        reflection: 'আজকের চেষ্টাটির জন্য আপনাকে সাধুবাদ — প্রতিটি পদক্ষেপই আপনার বৃদ্ধির অংশ।',
        nextActionTitle: 'কালকের জন্য ১টি শান্ত পদক্ষেপ',
        nextActionDescription: 'কোনো তাড়া নেই, কালও নিজের সুবিধাজনক সময়ে সহজ ১ মিনিটের অভ্যাসটি বজায় রাখুন।',
        adjustment: 'STEADY',
      });
      setReaction({ type: 'joy', key: Date.now() });
    } finally {
      setLoading(false);
    }
  };

  const handleRefineGoal = async () => {
    if (!rawGoal.trim()) return;
    tapHaptic();
    setLoading(true);
    setCrisis(null);
    setReaction({ type: 'curious', key: Date.now() });

    try {
      const res = await api<GoalSetupResult>('/kaizen/coach/setup', {
        method: 'POST',
        body: {
          rawGoal: rawGoal.trim(),
          availableTimeMin: timeMin,
        },
      });

      const foundCrisis = noteCrisis(res);
      if (foundCrisis || res.crisis) {
        setCrisis(foundCrisis ?? res.crisis ?? null);
        setLoading(false);
        return;
      }

      setSetupResult(res);
      setReaction({ type: 'joy', key: Date.now() });
      successHaptic();
    } catch {
      setSetupResult({
        refinedTitle: rawGoal.trim().slice(0, 40) || 'শান্ত মন ও নিয়মিত বিশ্রাম',
        whyItMatters: 'প্রতিদিনের ছোট প্রশান্তি আপনাকে দীর্ঘমেয়াদে মানসিক শক্তি দেবে।',
        starterActionTitle: `${timeMin} মিনিট দীর্ঘ নিঃশ্বাস ও মন শান্ত করা`,
        starterActionDescription: 'সোজা হয়ে বসুন বা শুয়ে ধীরে ধীরে শ্বাস ছাড়ুন এবং কাঁধ আলগা করুন।',
        estimatedMinutes: timeMin,
        category: 'BREATHING',
      });
      setReaction({ type: 'joy', key: Date.now() });
    } finally {
      setLoading(false);
    }
  };

  const handleAdopt = () => {
    if (!setupResult) return;
    successHaptic();
    onAdoptGoal?.({
      title: setupResult.refinedTitle,
      category: setupResult.category,
      targetDirection: setupResult.whyItMatters,
    });
    onClose();
  };

  const timeOptions = [
    { min: 1, label: t('kzCoachTime1') },
    { min: 2, label: t('kzCoachTime2') },
    { min: 5, label: t('kzCoachTime5') },
  ];

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.container,
            { backgroundColor: isDark ? '#231822' : '#FFFFFF', borderColor: c.border },
            animatedSheetStyle,
          ]}
        >
          {/* Header Bar */}
          <Row style={styles.headerRow}>
            <View style={styles.avatarWrap}>
              <Avatar
                state={loading ? 'thinking' : 'idle'}
                reaction={reaction}
                tone="warm"
                size={70}
              />
            </View>
            <View style={styles.headerTextCol}>
              <AppText size={18} weight="800">
                {mode === 'SETUP' ? t('kzCoachTitle') : t('kzCoachCheckinTitle')}
              </AppText>
              <AppText size={12} muted>
                {t('kzCoachSub')}
              </AppText>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={styles.closeBtn}
            >
              <AppText size={16} weight="700" style={{ color: c.text }}>
                ✕
              </AppText>
            </Pressable>
          </Row>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {crisis ? (
              <CrisisNotice crisis={crisis} dismissLabel="notNow" onDismiss={() => setCrisis(null)} />
            ) : mode === 'SETUP' ? (
              /* ================= SETUP MODE ================= */
              !setupResult ? (
                <View style={styles.formSection}>
                  <Field
                    label={t('kzCoachPromptLabel')}
                    value={rawGoal}
                    onChangeText={setRawGoal}
                    placeholder={t('kzCoachPromptHint')}
                    multiline
                    maxLength={300}
                  />

                  {/* Time chip selector */}
                  <View style={styles.timeGroup}>
                    <AppText size={13} weight="600" muted>
                      {t('kzCoachTimeLabel')}
                    </AppText>
                    <Row style={styles.chipsRow}>
                      {timeOptions.map((opt) => (
                        <Pressable
                          key={opt.min}
                          onPress={() => {
                            tapHaptic();
                            setTimeMin(opt.min);
                          }}
                          style={[
                            styles.chip,
                            opt.min === timeMin ? styles.chipActive : styles.chipInactive,
                          ]}
                        >
                          <AppText
                            size={12}
                            weight="700"
                            style={opt.min === timeMin ? styles.chipTextActive : styles.chipTextInactive}
                          >
                            {opt.label}
                          </AppText>
                        </Pressable>
                      ))}
                    </Row>
                  </View>

                  <Button
                    title={loading ? t('kzCoachThinking') : t('kzCoachRefineBtn')}
                    variant="primary"
                    disabled={!rawGoal.trim() || loading}
                    loading={loading}
                    onPress={handleRefineGoal}
                  />
                </View>
              ) : (
                /* Setup Result Recommendation */
                <View style={styles.resultSection}>
                  <Card style={styles.resultCard}>
                    <AppText size={12} weight="700" style={styles.cardHeaderTag}>
                      🌿 {t('kzCoachRefinedGoal')}
                    </AppText>
                    <AppText size={20} weight="800">
                      {setupResult.refinedTitle}
                    </AppText>
                    <AppText size={13} muted style={styles.whyText}>
                      💬 {setupResult.whyItMatters}
                    </AppText>
                  </Card>

                  <Card style={[styles.resultCard, styles.starterCard]}>
                    <AppText size={12} weight="700" style={styles.cardHeaderTag}>
                      ⚡ {t('kzCoachFirstStep')} ({setupResult.estimatedMinutes} min)
                    </AppText>
                    <AppText size={16} weight="700">
                      {setupResult.starterActionTitle}
                    </AppText>
                    <AppText size={13} muted style={{ lineHeight: 18 }}>
                      {setupResult.starterActionDescription}
                    </AppText>
                  </Card>

                  <Button
                    title={`🌱 ${t('kzCoachAdoptBtn')}`}
                    variant="primary"
                    onPress={handleAdopt}
                  />
                  <Button
                    title={t('back')}
                    variant="ghost"
                    onPress={() => setSetupResult(null)}
                  />
                </View>
              )
            ) : (
              /* ================= CHECKIN MODE ================= */
              checkinResult ? (
                <View style={styles.checkinSection}>
                  {/* Adjustment badge */}
                  <View style={styles.adjustBadge}>
                    <AppText size={12} weight="700" style={styles.adjustBadgeText}>
                      {checkinResult.adjustment === 'SIMPLIFY'
                        ? t('kzCoachAdjustmentSimplify')
                        : checkinResult.adjustment === 'GROW'
                        ? t('kzCoachAdjustmentGrow')
                        : t('kzCoachAdjustmentSteady')}
                    </AppText>
                  </View>

                  {/* Reflection Card */}
                  <Card style={styles.resultCard}>
                    <AppText size={12} weight="700" style={styles.cardHeaderTag}>
                      💬 {t('kzCoachReflection')}
                    </AppText>
                    <AppText size={15} style={styles.reflectionText}>
                      {checkinResult.reflection}
                    </AppText>
                  </Card>

                  {/* Tomorrow's Action Card */}
                  <Card style={[styles.resultCard, styles.starterCard]}>
                    <AppText size={12} weight="700" style={styles.cardHeaderTag}>
                      🌅 {t('kzCoachTomorrowStep')}
                    </AppText>
                    <AppText size={17} weight="800">
                      {checkinResult.nextActionTitle}
                    </AppText>
                    <AppText size={13} muted style={{ lineHeight: 19 }}>
                      {checkinResult.nextActionDescription}
                    </AppText>
                  </Card>

                  <Button
                    title={t('kzCoachCheckinDone')}
                    variant="primary"
                    onPress={onClose}
                  />
                </View>
              ) : (
                <View style={styles.loadingWrap}>
                  <AppText size={14} muted>
                    {t('kzCoachThinking')}
                  </AppText>
                </View>
              )
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    maxHeight: '88%',
    borderWidth: 1,
  },
  headerRow: {
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.sm,
  },
  avatarWrap: {
    width: 50,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerTextCol: {
    flex: 1,
    gap: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(150, 150, 150, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    gap: space.md,
    paddingVertical: space.sm,
  },
  formSection: {
    gap: space.md,
  },
  timeGroup: {
    gap: space.xs,
  },
  chipsRow: {
    gap: space.xs,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  chipActive: {
    backgroundColor: '#E87A90',
  },
  chipInactive: {
    backgroundColor: 'rgba(150, 150, 150, 0.12)',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  chipTextInactive: {
    color: '#9CA3AF',
  },
  resultSection: {
    gap: space.md,
  },
  resultCard: {
    gap: 6,
    borderRadius: radius.lg,
  },
  starterCard: {
    borderColor: 'rgba(232, 122, 144, 0.35)',
    borderWidth: 1,
  },
  cardHeaderTag: {
    color: '#E87A90',
    letterSpacing: 0.3,
  },
  whyText: {
    fontStyle: 'italic',
    lineHeight: 18,
  },
  checkinSection: {
    gap: space.md,
  },
  adjustBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(232, 122, 144, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  adjustBadgeText: {
    color: '#E87A90',
  },
  reflectionText: {
    lineHeight: 22,
  },
  loadingWrap: {
    paddingVertical: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

