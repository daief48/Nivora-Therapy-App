// Loaded lazily (require) by CallScreen ONLY when the native speech-recognition module exists.
// The microphone is opened only when the user presses the button (push mode) or while an explicit,
// user-started call is in its "listening" turn (call mode). It is closed on release / turn end / backgrounding.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useEffect, useRef } from 'react';
import { AppState, Pressable } from 'react-native';
import { useT } from '../i18n';
import { isEcho } from '../utils/speech';
import { radius, useTheme } from '../theme';
import { AppText } from './ui';

export type RecogError = 'denied' | 'failed' | 'none';
export interface RecognitionControlsProps {
  locale: string; listening: boolean; disabled?: boolean;
  /** 'call': no button; recognition runs while `listenNow` is true. Default 'push' = hold-to-talk button. */
  mode?: 'push' | 'call'; listenNow?: boolean;
  /** Call mode, while the assistant is speaking: watch for the user talking over it (barge-in). Words that merely echo `spokenText` are ignored. */
  bargeIn?: boolean; spokenText?: string; onSpeechStart?: () => void;
  onListening: (on: boolean) => void; onTranscript: (text: string, final: boolean) => void; onError: (e: RecogError) => void;
}

export function RecognitionControls({ locale, listening, disabled, mode = 'push', listenNow = false, bargeIn = false, spokenText = '', onSpeechStart, onListening, onTranscript, onError }: RecognitionControlsProps) {
  const t = useT();
  const { c } = useTheme();
  const active = useRef(false);
  const last = useRef('');
  const monitoring = useRef(false); // recogniser is running only to notice the user talking over the assistant
  const wantMonitor = useRef(false);
  const listenRef = useRef(listenNow);
  listenRef.current = listenNow;
  const spoken = useRef(spokenText);
  spoken.current = spokenText;
  const onStartRef = useRef(onSpeechStart);
  onStartRef.current = onSpeechStart;

  const startOpts = { lang: locale, interimResults: true, continuous: false, maxAlternatives: 1, requiresOnDeviceRecognition: false } as const;
  const startMonitor = async () => {
    if (!wantMonitor.current || active.current || disabled) return;
    try {
      const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!perm.granted || !wantMonitor.current || active.current) return; // never prompt for the microphone mid-reply
      monitoring.current = true; last.current = '';
      ExpoSpeechRecognitionModule.start({ ...startOpts, requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() });
    } catch { monitoring.current = false; }
  };

  useSpeechRecognitionEvent('start', () => { active.current = true; if (!monitoring.current) onListening(true); });
  useSpeechRecognitionEvent('end', () => {
    active.current = false;
    if (monitoring.current) { // nobody interrupted: keep watching while the assistant is still talking
      monitoring.current = false; last.current = '';
      if (wantMonitor.current) setTimeout(() => void startMonitor(), 300);
      return;
    }
    onListening(false);
    if (last.current) { onTranscript(last.current, true); last.current = ''; } else onError('none');
  });
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results?.[0]?.transcript ?? '';
    if (monitoring.current) {
      if (isEcho(text, spoken.current)) return; // the assistant's own voice, or a single noise word
      monitoring.current = false; onListening(true); onStartRef.current?.(); // real interruption: this session now becomes the listening turn
    }
    last.current = text;
    onTranscript(text, !!e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    active.current = false; last.current = '';
    if (monitoring.current) { monitoring.current = false; if (e.error === 'no-speech' && wantMonitor.current) setTimeout(() => void startMonitor(), 300); return; }
    onListening(false);
    onError(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'none' : 'failed');
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && active.current) ExpoSpeechRecognitionModule.abort(); });
    return () => { sub.remove(); if (active.current) ExpoSpeechRecognitionModule.abort(); };
  }, []);

  const begin = async () => {
    if (monitoring.current) { monitoring.current = false; last.current = ''; onListening(true); return; } // the watching session becomes the listening turn
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

  useEffect(() => {
    if (mode !== 'call') return;
    wantMonitor.current = bargeIn;
    if (bargeIn) void startMonitor();
    else if (monitoring.current) {
      // the reply ended: normally the listening turn starts within a moment and adopts this session; otherwise stop watching
      const id = setTimeout(() => { if (monitoring.current && !listenRef.current) { monitoring.current = false; ExpoSpeechRecognitionModule.abort(); } }, 600);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bargeIn, mode]);

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
