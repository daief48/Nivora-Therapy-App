import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { tapHaptic, successHaptic } from '../../motion/haptics';
import { AppText, Button, Card, Field, Row } from '../ui';
import { radius, space, useTheme } from '../../theme';
import { useT } from '../../i18n';
import { useSettings } from '../../store/settings';

const STORAGE_KEY = '@nivora_safety_contract';

interface ContractData {
  promise: string;
  savedAt: string;
}

export function MicroSafetyContract() {
  const t = useT();
  const { c, isDark } = useTheme();
  const lang = useSettings((s) => s.uiLang);

  const [savedData, setSavedData] = useState<ContractData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState('');

  // Golden glow pulse upon saving
  const sealGlow = useSharedValue(0);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ContractData;
          setSavedData(parsed);
          setText(parsed.promise);
        } else {
          // Default promise
          setText(
            lang === 'bn'
              ? 'আমি এই মুহূর্তটা পার করব। শুধু এই একটি মুহূর্ত।'
              : 'I will get through this moment. Just this single moment.'
          );
        }
      } catch {
        // ignore
      }
    })();
  }, [lang]);

  const handleSelectPreset = (presetText: string) => {
    tapHaptic();
    setText(presetText);
  };

  const handleSave = async () => {
    if (!text.trim()) return;
    successHaptic();
    const data: ContractData = {
      promise: text.trim(),
      savedAt: new Date().toISOString(),
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSavedData(data);
      setIsEditing(false);

      sealGlow.value = withSequence(
        withTiming(1, { duration: 300 }),
        withTiming(0, { duration: 800 }),
      );
    } catch {
      // ignore
    }
  };

  const presets = [
    { id: 'p1', label: t('emContractPreset1') },
    { id: 'p2', label: t('emContractPreset2') },
    { id: 'p3', label: t('emContractPreset3') },
  ];

  const animatedGlowStyle = useAnimatedStyle(() => ({
    opacity: sealGlow.value,
  }));

  return (
    <Card style={styles.card}>
      <Row style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <AppText size={20}>📜</AppText>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="800" size={16}>
            {t('emContractTitle')}
          </AppText>
          <AppText size={13} muted>
            {t('emContractSub')}
          </AppText>
        </View>
      </Row>

      {savedData && !isEditing ? (
        /* Sealed Promise Display */
        <View style={[styles.sealedBox, { backgroundColor: isDark ? 'rgba(245, 215, 130, 0.1)' : '#FEF9EE' }]}>
          <Animated.View style={[styles.glowBorder, animatedGlowStyle]} />
          <AppText size={18} weight="700" style={styles.sealedText}>
            “{savedData.promise}”
          </AppText>
          <Row style={styles.sealedFooter}>
            <AppText size={12} muted>
              ✨ {t('emContractSavedJustNow')}
            </AppText>
            <Button
              title={t('emContractUpdate')}
              variant="ghost"
              onPress={() => {
                tapHaptic();
                setIsEditing(true);
              }}
            />
          </Row>
        </View>
      ) : (
        /* Edit / Create Form */
        <View style={styles.formContainer}>
          {/* Quick Anchor Pills */}
          <View style={styles.presetsRow}>
            {presets.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => handleSelectPreset(p.label)}
                style={[
                  styles.presetChip,
                  { backgroundColor: isDark ? '#272E44' : '#F1F5F9' },
                ]}
              >
                <AppText size={12} weight="600">
                  {p.label}
                </AppText>
              </Pressable>
            ))}
          </View>

          <Field
            value={text}
            onChangeText={setText}
            placeholder={t('emContractPlaceholder')}
            maxLength={140}
            multiline
          />

          <Button
            title={`🔒 ${t('emContractSave')}`}
            variant="secondary"
            disabled={!text.trim()}
            onPress={handleSave}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(245, 215, 130, 0.25)',
  },
  headerRow: {
    alignItems: 'center',
    gap: space.sm,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(245, 215, 130, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sealedBox: {
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: '#F5D78E',
    gap: space.sm,
    overflow: 'hidden',
  },
  glowBorder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(245, 215, 130, 0.35)',
  },
  sealedText: {
    color: '#D97706',
    fontStyle: 'italic',
    lineHeight: 26,
    textAlign: 'center',
  },
  sealedFooter: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  formContainer: {
    gap: space.sm,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
});
