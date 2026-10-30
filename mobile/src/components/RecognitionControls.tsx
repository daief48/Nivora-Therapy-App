// Loaded lazily (require) by CallScreen ONLY when the native speech-recognition module exists.
// The microphone is opened only when the user presses the button (push mode) or while an explicit,
// user-started call is in its "listening" turn (call mode). It is closed on release / turn end / backgrounding.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useEffect, useRef } from 'react';
import { AppState, Pressable } from 'react-native';
import { useT } from '../i18n';
import { radius, useTheme } from '../theme';
import { AppText } from './ui';

export type RecogError = 'denied' | 'failed' | 'none';
export interface RecognitionControlsProps {
  locale: string; listening: boolean; disabled?: boolean;
  /** 'call': no button; recognition runs while `listenNow` is true. Default 'push' = hold-to-talk button. */
  mode?: 'push' | 'call'; listenNow?: boolean;
  onListening: (on: boolean) => void; onTranscript: (text: string, final: boolean) => void; onError: (e: RecogError) => void;
}

export function RecognitionControls({ locale, listening, disabled, mode = 'push', listenNow = false, onListening, onTranscript, onError }: RecognitionControlsProps) {
  const t = useT();
  const { c } = useTheme();
  const active = useRef(false);
  const last = useRef('');

  useSpeechRecognitionEvent('start', () => { active.current = true; onListening(true); });
  useSpeechRecognitionEvent('end', () => {
    active.current = false; onListening(false);
    if (last.current) { onTranscript(last.current, true); last.current = ''; } else onError('none');
  });
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results?.[0]?.transcript ?? '';
    last.current = text;
    onTranscript(text, !!e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    active.current = false; onListening(false); last.current = '';
    onError(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'none' : 'failed');
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && active.current) ExpoSpeechRecognitionModule.abort(); });
    return () => { sub.remove(); if (active.current) ExpoSpeechRecognitionModule.abort(); };
  }, []);

  const begin = async () => {
    if (disabled || active.current) return;
    let perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!perm.granted) perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { onError('denied'); return; }
    last.current = '';
    ExpoSpeechRecognitionModule.start({
      lang: locale, interimResults: true, continuous: false, maxAlternatives: 1,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  };
  const finish = () => { if (active.current) ExpoSpeechRecognitionModule.stop(); };

  useEffect(() => {
    if (mode !== 'call') return;
    if (listenNow) void begin();
    else if (active.current) ExpoSpeechRecognitionModule.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenNow, mode]);

  if (mode === 'call') return null;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={listening ? t('releaseToSend') : t('holdToTalk')} accessibilityHint={t('voiceNote')}
      onPressIn={begin} onPressOut={finish} disabled={disabled}
      style={{ minHeight: 72, borderRadius: radius.pill, backgroundColor: listening ? c.danger : c.primary, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1, paddingHorizontal: 24 }}>
      <AppText size={18} weight="700" style={{ color: listening ? c.onDanger : c.onPrimary }}>{listening ? t('listening') : t('holdToTalk')}</AppText>
    </Pressable>
  );
}
