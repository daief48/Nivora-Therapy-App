/**
 * GoalVoiceMic — the small "speak instead" button in the goal update box.
 * Loaded lazily (require) by GoalCard ONLY when the native speech-recognition module exists,
 * so Expo Go (where the module is absent) simply never loads this file.
 */
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { useT } from '../../i18n';
import { useSettings } from '../../store/settings';
import { speechLocale } from '../../utils/speech';
import { radius, useTheme } from '../../theme';
import { Icon } from '../ui';

export function GoalVoiceMic({ onText }: { onText: (text: string) => void }) {
  const t = useT();
  const { c } = useTheme();
  const lang = useSettings((s) => s.uiLang);
  const [listening, setListening] = useState(false);

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results?.[0]?.transcript ?? '';
    if (e.isFinal && text.trim()) { onText(text.trim()); ExpoSpeechRecognitionModule.stop(); }
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => setListening(false));

  const start = async () => {
    let perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!perm.granted) perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setListening(false); return; }
    setListening(true);
    try {
      ExpoSpeechRecognitionModule.start({ lang: speechLocale(lang), interimResults: true, continuous: false, maxAlternatives: 1 });
    } catch { setListening(false); }
  };

  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={t('kzUpVoice')} accessibilityState={{ busy: listening }}
      onPress={() => (listening ? ExpoSpeechRecognitionModule.stop() : void start())}
      style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: c.border }}>
      <Icon name={listening ? 'stop' : 'mic-outline'} size={20} color={listening ? c.danger : c.textMuted} />
    </Pressable>
  );
}
