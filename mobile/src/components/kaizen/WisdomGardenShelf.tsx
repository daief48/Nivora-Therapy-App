import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppText, Button, Card, Icon, Row } from '../ui';
import { radius, useTheme } from '../../theme';
import { useT } from '../../i18n';

export interface WisdomPetal {
  title: string;
  text: string;
  date: string;
}

export function WisdomGardenShelf() {
  const t = useT();
  const { c, isDark } = useTheme();

  const [petals, setPetals] = useState<WisdomPetal[]>([]);
  const [selectedPetal, setSelectedPetal] = useState<WisdomPetal | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem('@nivora_wisdom_garden');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) setPetals(list.slice(-8).reverse());
        }
      } catch {
        // quiet fallback
      }
    })();
  }, []);

  if (!petals.length) return null;

  return (
    <>
      <Card style={[styles.container, { backgroundColor: isDark ? '#231B27' : '#FFFDF9', borderColor: '#EBD8B8' }]}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <AppText size={16}>🪷</AppText>
            <AppText size={13} weight="800" style={{ color: '#B46B12' }}>
              {t('kzWisdomGarden')}
            </AppText>
          </Row>
          <AppText size={11} muted>{petals.length}টি সংগৃহীত বাণী</AppText>
        </Row>

        {/* Horizontal Petal Scroll */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {petals.map((item, idx) => (
            <Pressable
              key={idx}
              accessibilityRole="button"
              accessibilityLabel={`Wisdom Petal ${idx + 1}`}
              onPress={() => setSelectedPetal(item)}
              style={[
                styles.petalCard,
                {
                  backgroundColor: isDark ? '#382828' : '#FFF6EA',
                  borderColor: '#F3CD95',
                },
              ]}
            >
              <AppText size={20}>📜</AppText>
              <AppText size={12} weight="700" numberOfLines={2} style={styles.snippet}>
                {item.text}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      </Card>

      {/* Keepsake Reader Modal */}
      <Modal visible={!!selectedPetal} transparent animationType="fade" onRequestClose={() => setSelectedPetal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: isDark ? '#261D2A' : '#FFFDF9', borderColor: '#E5C088' }]}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <AppText size={12} weight="800" style={{ color: '#D97706', letterSpacing: 1.2 }}>
                🌸 KAIZEN WISDOM SCROLL
              </AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSelectedPetal(null)}>
                <Icon name="close" size={20} color={c.textMuted} />
              </Pressable>
            </Row>

            <View style={styles.scrollBody}>
              <AppText size={28} style={{ textAlign: 'center', marginVertical: 4 }}>
                🪷
              </AppText>
              <AppText size={16} weight="700" style={styles.fullText}>
                "{selectedPetal?.text}"
              </AppText>
              {selectedPetal?.title ? (
                <AppText size={12} muted style={{ textAlign: 'center', marginTop: 8 }}>
                  পদক্ষেপ: {selectedPetal.title}
                </AppText>
              ) : null}
            </View>

            <Button title="হৃদয়ে রাখলাম" variant="primary" onPress={() => setSelectedPetal(null)} style={{ width: '100%' }} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginVertical: 4,
  },
  scroll: {
    gap: 10,
    paddingVertical: 2,
  },
  petalCard: {
    width: 140,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    gap: 6,
    justifyContent: 'center',
  },
  snippet: {
    lineHeight: 18,
    color: '#92400E',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    padding: 24,
    borderRadius: radius.xl,
    borderWidth: 2,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  scrollBody: {
    width: '100%',
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D4AF37',
    gap: 6,
  },
  fullText: {
    textAlign: 'center',
    lineHeight: 26,
    fontStyle: 'italic',
  },
});

