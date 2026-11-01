import React, { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { AppText, Button } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface ZenPearlRewardModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ZenPearlRewardModal({ visible, onClose }: ZenPearlRewardModalProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  const scale = useSharedValue(0.3);
  const glow = useSharedValue(0.6);
  const floatY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scale.value = withSpring(1, { damping: 10, stiffness: 120 });
      glow.value = withRepeat(
        withSequence(withTiming(1, { duration: 1000 }), withTiming(0.6, { duration: 1000 })),
        -1,
        true,
      );
      floatY.value = withRepeat(
        withSequence(withTiming(-10, { duration: 1400 }), withTiming(0, { duration: 1400 })),
        -1,
        true,
      );
    } else {
      scale.value = 0.3;
    }
  }, [visible, scale, glow, floatY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: floatY.value }],
    opacity: glow.value,
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: isDark ? '#231B26' : '#FFFFFF', borderColor: c.border }]}>
          <AppText size={13} weight="700" style={{ color: c.accent, letterSpacing: 1.2 }}>
            🌸 {t('kzZenPearl')} 🌸
          </AppText>

          {/* Luminous Pearl SVG */}
          <Animated.View style={[styles.pearlContainer, animatedStyle]}>
            <Svg width={120} height={120} viewBox="0 0 120 120">
              <Defs>
                <RadialGradient id="pearlGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor="#FFF4E6" stopOpacity="1" />
                  <Stop offset="50%" stopColor="#F9D2E0" stopOpacity="0.8" />
                  <Stop offset="85%" stopColor="#D8B4F8" stopOpacity="0.4" />
                  <Stop offset="100%" stopColor="#A881E6" stopOpacity="0" />
                </RadialGradient>
                <RadialGradient id="pearlCore" cx="35%" cy="35%" r="65%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
                  <Stop offset="40%" stopColor="#FFF0F5" stopOpacity="0.95" />
                  <Stop offset="80%" stopColor="#F4D3DE" stopOpacity="0.9" />
                  <Stop offset="100%" stopColor="#DEC2D4" stopOpacity="0.8" />
                </RadialGradient>
              </Defs>
              {/* Outer soft aura */}
              <Circle cx="60" cy="60" r="54" fill="url(#pearlGlow)" />
              {/* Core pearl */}
              <Circle cx="60" cy="60" r="34" fill="url(#pearlCore)" stroke="#FFFFFF" strokeWidth="2" />
              {/* Highlight specular */}
              <Circle cx="50" cy="50" r="8" fill="#FFFFFF" opacity="0.85" />
            </Svg>
          </Animated.View>

          <AppText size={20} weight="800" style={{ textAlign: 'center' }}>
            {t('kzZenPearlAwarded')}
          </AppText>

          <AppText muted size={14} style={{ textAlign: 'center', lineHeight: 22 }}>
            ক্লান্তির মাঝেও নিজের জন্য একটি শান্ত মুহূর্ত উপহার দিয়েছেন। এই মুক্তোটি আপনার বাগানের হৃদয়ে শান্তভাবে জ্বলবে।
          </AppText>

          <Button title="গ্রহণ করলাম" variant="primary" onPress={onClose} style={{ marginTop: 8 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    padding: 24,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  pearlContainer: {
    marginVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

