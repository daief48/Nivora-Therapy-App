import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { api } from '../../api/client';
import { GrowthPlant } from '../nv';
import { AppText, Button, Card, Icon, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

interface ChronicleData {
  letter: string;
  haiku: string;
}

export type PlantStage = 'SEED' | 'GROWING' | 'GROWING_STRONG' | 'FLOURISHING';

const toPlantStage = (s?: string): PlantStage =>
  s === 'SEED' || s === 'GROWING' || s === 'GROWING_STRONG' || s === 'FLOURISHING' ? s : 'GROWING';

interface PlantChronicleCardProps {
  stage?: PlantStage | string;
  weeklyActions?: Array<{ date: string; status: string | null; micro?: boolean; difficulty?: number }>;
}

export function PlantChronicleCard({ stage = 'GROWING', weeklyActions }: PlantChronicleCardProps) {
  const t = useT();
  const { c, isDark } = useTheme();

  const [loading, setLoading] = useState(false);
  const [chronicle, setChronicle] = useState<ChronicleData | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchChronicle = async () => {
    setLoading(true);
    try {
      const res = await api<ChronicleData>('/kaizen/living-chronicle', {
        method: 'POST',
        body: { stage, weeklyActions },
      });
      setChronicle(res);
      setModalVisible(true);
    } catch {
      setChronicle({
        letter: 'প্রিয় বন্ধু, আপনি ক্লান্ত দিনেও আমার দিকে ফিরে তাকিয়েছেন। মাটির নিচে শিকড় যেমন অন্ধকারে নীরবে বাড়ে, আপনার প্রতিটি ছোট চেষ্টাও আমাকে বাঁচিয়ে রেখেছে। আপনার শান্ত পদক্ষেপে আমি কৃতজ্ঞ।',
        haiku: 'নীরব পদক্ষেপে,\nসবুজ পাতা মেলে চোখ,\nশান্তির আলোক।',
      });
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!chronicle) return;
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        // Sharing text or note
      }
    } catch {
      // quiet fallback
    }
  };

  return (
    <>
      {/* Interactive Trigger Card */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('kzLetterFromPlant')}
        onPress={fetchChronicle}
        style={[
          styles.triggerCard,
          {
            backgroundColor: isDark ? '#261D2E' : '#FDF4F8',
            borderColor: '#F2C1DB',
          },
        ]}
      >
        <Row style={{ gap: 14, alignItems: 'center' }}>
          <View style={[styles.envelopeBadge, { backgroundColor: isDark ? '#43264E' : '#FFEBF3' }]}>
            <AppText size={28}>🪴✉️</AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText size={15} weight="800" style={{ color: c.accent }}>
              {t('kzLetterFromPlant')}
            </AppText>
            <AppText size={12} muted>
              আপনার কাইজেন গাছটি এই সপ্তাহের অনুভূতি লিখেছে
            </AppText>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={c.accent} />
          ) : (
            <Icon name="chevron-forward" size={20} color={c.accent} />
          )}
        </Row>
      </Pressable>

      {/* Aesthetic Sakura Keepsake Card Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.keepsakeCard,
              {
                backgroundColor: isDark ? '#201A24' : '#FFFDFD',
                borderColor: '#E8ADC7',
              },
            ]}
          >
            {/* Header with Plant Avatar */}
            <Row style={styles.cardHeader}>
              <GrowthPlant stage={toPlantStage(stage)} size={54} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText size={12} weight="700" style={{ color: c.accent, letterSpacing: 1.2 }}>
                  SAKURA KEEPSAKE
                </AppText>
                <AppText size={17} weight="800">
                  {t('kzKeepsakeCard')}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setModalVisible(false)}
                style={{ padding: 4 }}
              >
                <Icon name="close" size={20} color={c.textMuted} />
              </Pressable>
            </Row>

            {/* Letter Content */}
            <View style={[styles.letterBody, { backgroundColor: isDark ? '#2B2230' : '#FFF5F8' }]}>
              <AppText size={15} style={styles.letterText}>
                {chronicle?.letter}
              </AppText>
            </View>

            {/* Japanese Haiku Inset */}
            <View style={[styles.haikuBox, { borderColor: '#E8B4C9' }]}>
              <AppText size={11} weight="700" style={{ color: c.accent, marginBottom: 4, letterSpacing: 1 }}>
                🌸 ZEN HAIKU 🌸
              </AppText>
              <AppText size={14} weight="700" style={styles.haikuText}>
                {chronicle?.haiku}
              </AppText>
            </View>

            {/* Bottom Actions */}
            <Row style={{ gap: 10, marginTop: 6 }}>
              <Button
                title={t('kzShareKeepsake')}
                variant="secondary"
                icon="download-outline"
                style={{ flex: 1 }}
                onPress={handleShare}
              />
              <Button
                title="বন্ধ করুন"
                variant="primary"
                style={{ flex: 1 }}
                onPress={() => setModalVisible(false)}
              />
            </Row>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerCard: {
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginVertical: 4,
  },
  envelopeBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  keepsakeCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.xl,
    borderWidth: 2,
    padding: 20,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 10,
  },
  cardHeader: {
    alignItems: 'center',
    gap: 12,
  },
  letterBody: {
    padding: 16,
    borderRadius: radius.md,
  },
  letterText: {
    lineHeight: 24,
    fontStyle: 'italic',
  },
  haikuBox: {
    borderLeftWidth: 3,
    paddingLeft: 14,
    paddingVertical: 6,
  },
  haikuText: {
    lineHeight: 22,
  },
});

