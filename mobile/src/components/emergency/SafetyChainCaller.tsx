import React, { useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { tapHaptic, successHaptic } from '../../motion/haptics';
import type { TrustedContact } from '../TrustedPeople';
import { AppText, Button, Card, Row } from '../ui';
import { radius, space, useTheme } from '../../theme';
import { useT } from '../../i18n';
import { useSettings } from '../../store/settings';

interface SafetyChainCallerProps {
  visible: boolean;
  contacts: TrustedContact[];
  onClose: () => void;
  onAddPerson?: () => void;
  onViewHotlines?: () => void;
}

export function SafetyChainCaller({
  visible,
  contacts,
  onClose,
  onAddPerson,
  onViewHotlines,
}: SafetyChainCallerProps) {
  const t = useT();
  const { c, isDark } = useTheme();
  const lang = useSettings((s) => s.uiLang);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  // Card slide transition animation
  const cardTranslateX = useSharedValue(0);
  const cardOpacity = useSharedValue(1);

  const curContact = contacts[currentIndex];

  const handleNext = () => {
    tapHaptic();
    // Slide left and fade out
    cardTranslateX.value = withTiming(-100, { duration: 150 }, () => {
      cardTranslateX.value = 100;
      cardTranslateX.value = withSpring(0, { damping: 14, stiffness: 120 });
    });
    cardOpacity.value = withSequence(
      withTiming(0, { duration: 150 }),
      withTiming(1, { duration: 200 }),
    );

    if (currentIndex < contacts.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsFinished(true);
      successHaptic();
    }
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setIsFinished(false);
  };

  const dialPhone = (phone: string) => {
    tapHaptic();
    const cleaned = phone.replace(/[^\d+]/g, '');
    void Linking.openURL(`tel:${cleaned}`).catch(() => {
      Alert.alert(t('safetyCantOpen'));
    });
  };

  const sendGentleSMS = (phone: string, name: string) => {
    tapHaptic();
    const cleaned = phone.replace(/[^\d+]/g, '');
    const prefillBody =
      lang === 'bn'
        ? encodeURIComponent(
            `আসসালামু আলাইকুম ${name}, আমার এখন একটু মন খারাপ ও অস্থির লাগছে, একা থাকতে পারছি না। তোমার সাথে কি একটু কথা বলা যাবে?`
          )
        : encodeURIComponent(
            `Hi ${name}, I'm having a really difficult moment right now and don't want to be alone. Could you please call or sit with me for a bit?`
          );

    void Linking.openURL(`sms:${cleaned}?body=${prefillBody}`).catch(() => {
      void Linking.openURL(`sms:${cleaned}`).catch(() => {
        Alert.alert(t('safetyCantOpen'));
      });
    });
  };

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cardTranslateX.value }],
    opacity: cardOpacity.value,
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <AppText size={18} weight="700" style={styles.topTitle}>
            {t('emChainTitle')}
          </AppText>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            style={styles.closeBtn}
          >
            <AppText size={16} weight="700" style={styles.closeBtnText}>
              ✕
            </AppText>
          </Pressable>
        </View>

        {contacts.length === 0 ? (
          /* Empty State */
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <AppText size={44}>🤝</AppText>
            </View>
            <AppText size={18} weight="700" style={styles.emptyText}>
              {t('emChainNoContacts')}
            </AppText>
            {onAddPerson && (
              <Button
                title={t('emChainAddPerson')}
                variant="primary"
                onPress={() => {
                  onClose();
                  onAddPerson();
                }}
              />
            )}
          </View>
        ) : !isFinished && curContact ? (
          /* Active Contact Step Card */
          <View style={styles.deckContainer}>
            {/* Step Counter */}
            <AppText size={14} style={styles.stepBadge}>
              {t('emChainStep', { n: currentIndex + 1, total: contacts.length })}
            </AppText>

            {/* Main Interactive Contact Deck */}
            <Animated.View
              style={[
                styles.contactCard,
                { backgroundColor: isDark ? '#1C2237' : '#FFFFFF', borderColor: c.border },
                animatedCardStyle,
              ]}
            >
              <View style={styles.avatarWrap}>
                <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
                  <Circle cx={12} cy={8} r={4} fill="#818CF8" />
                  <Path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="#818CF8" strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </View>

              <AppText size={24} weight="800" style={styles.contactName}>
                {curContact.name}
              </AppText>

              {curContact.relation ? (
                <View style={styles.relationPill}>
                  <AppText size={12} weight="600" style={styles.relationText}>
                    {curContact.relation}
                  </AppText>
                </View>
              ) : null}

              <AppText size={15} muted style={styles.contactPhone}>
                {curContact.phone}
              </AppText>

              <AppText size={14} style={styles.promptText}>
                {t('emChainCallPrompt', { name: curContact.name })}
              </AppText>

              {/* Action Buttons */}
              <View style={styles.actionColumn}>
                <Button
                  title={`📞 ${t('emChainCallNow', { name: curContact.name })}`}
                  variant="primary"
                  onPress={() => dialPhone(curContact.phone)}
                />

                <Button
                  title={`💬 ${t('emChainMsgNow')}`}
                  variant="secondary"
                  onPress={() => sendGentleSMS(curContact.phone, curContact.name)}
                />

                <Button
                  title={t('emChainNext')}
                  variant="ghost"
                  onPress={handleNext}
                />
              </View>
            </Animated.View>
          </View>
        ) : (
          /* Finished State */
          <View style={styles.finishContainer}>
            <View style={styles.finishIcon}>
              <AppText size={48}>🛡️</AppText>
            </View>
            <AppText size={20} weight="800" style={styles.finishTitle}>
              {t('emChainAllDone')}
            </AppText>

            <View style={styles.finishActions}>
              {onViewHotlines && (
                <Button
                  title={t('emChainHotlines')}
                  variant="primary"
                  onPress={() => {
                    onClose();
                    onViewHotlines();
                  }}
                />
              )}
              <Button
                title={t('emGroundReset')}
                variant="ghost"
                onPress={handleReset}
              />
              <Button
                title={t('close')}
                variant="secondary"
                onPress={onClose}
              />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0B0F19',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.md,
  },
  topTitle: {
    color: '#E0E7FF',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFF',
  },
  deckContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  stepBadge: {
    color: '#A5B4FC',
    fontWeight: '700',
  },
  contactCard: {
    width: '100%',
    borderRadius: radius.xl,
    padding: space.xl,
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  contactName: {
    letterSpacing: 0.2,
  },
  relationPill: {
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  relationText: {
    color: '#818CF8',
  },
  contactPhone: {
    letterSpacing: 0.5,
  },
  promptText: {
    textAlign: 'center',
    marginVertical: space.xs,
  },
  actionColumn: {
    width: '100%',
    gap: space.sm,
    marginTop: space.sm,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#E0E7FF',
    textAlign: 'center',
    lineHeight: 26,
  },
  finishContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.md,
  },
  finishIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishTitle: {
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 28,
  },
  finishActions: {
    width: '100%',
    gap: space.sm,
  },
});

