import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, G, Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { api } from '../../api/client';
import { AppText, Button, Card, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface OmikujiResult {
  omikuji: string;
  blessingType: string;
}

interface OmikujiBloomModalProps {
  visible: boolean;
  actionTitle: string;
  streakCount?: number;
  onClose: () => void;
}

export function OmikujiBloomModal({
  visible,
  actionTitle,
  streakCount = 1,
  onClose,
}: OmikujiBloomModalProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  const [omikuji, setOmikuji] = useState<string>('');
  const [saved, setSaved] = useState(false);

  // Animations: Flower scale (0 -> 1.15 -> 1.0), Petal rotation & Scroll reveal
  const flowerScale = useSharedValue(0);
  const scrollOpacity = useSharedValue(0);
  const scrollScale = useSharedValue(0.8);

  useEffect(() => {
    if (visible) {
      setSaved(false);
      flowerScale.value = withSequence(
        withSpring(1.15, { damping: 8, stiffness: 100 }),
        withSpring(1.0, { damping: 12, stiffness: 90 }),
      );
      scrollOpacity.value = withDelay(400, withTiming(1, { duration: 600 }));
      scrollScale.value = withDelay(400, withSpring(1.0, { damping: 10, stiffness: 100 }));

      // Fetch omikuji blessing from backend
      void (async () => {
        try {
          const res = await api<OmikujiResult>('/kaizen/omikuji', {
            method: 'POST',
            body: { completedActionTitle: actionTitle, completionStreak: streakCount },
          });
          setOmikuji(res.omikuji);
        } catch {
          setOmikuji('একটি শান্ত নদী যেমন পাথরের বাধা পেরিয়ে যায়, আপনার ধীর পদক্ষেপও নতুন পথের সৃষ্টি করবে।');
        }
      })();
    } else {
      flowerScale.value = 0;
      scrollOpacity.value = 0;
      scrollScale.value = 0.8;
      setOmikuji('');
    }
  }, [visible, actionTitle, streakCount, flowerScale, scrollOpacity, scrollScale]);

  const flowerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: flowerScale.value }],
  }));

  const scrollAnimStyle = useAnimatedStyle(() => ({
    opacity: scrollOpacity.value,
    transform: [{ scale: scrollScale.value }],
  }));

  const saveToWisdomGarden = async () => {
    try {
      const existing = await AsyncStorage.getItem('@nivora_wisdom_garden');
      const list = existing ? JSON.parse(existing) : [];
      list.push({ text: omikuji, date: new Date().toISOString(), title: actionTitle });
      await AsyncStorage.setItem('@nivora_wisdom_garden', JSON.stringify(list));
      setSaved(true);
    } catch {
      setSaved(true);
    }
  };

  const handleClose = () => {
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: isDark ? '#231B26' : '#FFFFFF', borderColor: c.border }]}>
          {/* Header */}
          <AppText size={12} weight="700" style={{ color: c.accent, letterSpacing: 1.5, textAlign: 'center' }}>
            🌸 {t('kzOmikujiTitle')} 🌸
          </AppText>

          {/* Blooming Sakura Blossom SVG Animation */}
          <Animated.View style={[styles.flowerBox, flowerAnimStyle]}>
            <Svg width={110} height={110} viewBox="0 0 100 100">
              <G transform="translate(50, 50)">
                {/* 5 Sakura Petals rotated around center */}
                {[0, 72, 144, 216, 288].map((angle, idx) => (
                  <G key={idx} transform={`rotate(${angle})`}>
                    <Path
                      d="M 0 0 C -12 -22, -14 -40, 0 -48 C 14 -40, 12 -22, 0 0 Z"
                      fill="#FFAFCC"
                      stroke="#FF80AB"
                      strokeWidth="1.5"
                      opacity="0.95"
                    />
                    <Path
                      d="M 0 -12 C -6 -24, -6 -36, 0 -40 C 6 -36, 6 -24, 0 -12 Z"
                      fill="#FFD6E8"
                      opacity="0.8"
                    />
                  </G>
                ))}
                {/* Golden Center Pistil */}
                <Circle cx="0" cy="0" r="10" fill="#FFE082" stroke="#FFD54F" strokeWidth="2" />
                <Circle cx="0" cy="0" r="5" fill="#FFA000" />
              </G>
            </Svg>
          </Animated.View>

          {/* Sacred Temple Omikuji Scroll Card */}
          <Animated.View style={[styles.scrollCard, scrollAnimStyle, { backgroundColor: isDark ? '#2D2230' : '#FFFDF7', borderColor: '#E8C59A' }]}>
            <Row style={{ gap: 6, justifyContent: 'center', marginBottom: 4 }}>
              <AppText size={13} weight="800" style={{ color: '#D97706', letterSpacing: 1 }}>
                御神籤 · KAIZEN BLESSING
              </AppText>
            </Row>

            <AppText size={15} weight="700" style={styles.omikujiText}>
              {omikuji || 'ধীর পদক্ষেপে ফোটে প্রশান্তি...'}
            </AppText>
          </Animated.View>

          {/* Actions */}
          <Row style={{ gap: 10, width: '100%' }}>
            <Button
              title={saved ? 'সংরক্ষিত হয়েছে ✨' : t('kzCollectPetal')}
              variant="secondary"
              disabled={saved}
              style={{ flex: 1 }}
              onPress={saveToWisdomGarden}
            />
            <Button
              title="ধন্যবাদ"
              variant="primary"
              style={{ flex: 1 }}
              onPress={handleClose}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 340,
    padding: 24,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  flowerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  scrollCard: {
    width: '100%',
    padding: 18,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 8,
  },
  omikujiText: {
    textAlign: 'center',
    lineHeight: 24,
    fontStyle: 'italic',
  },
});

