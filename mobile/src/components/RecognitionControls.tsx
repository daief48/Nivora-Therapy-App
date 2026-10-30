// Loaded lazily (require) by CallScreen ONLY when the native speech-recognition module exists.
// The microphone is opened only when the user presses the button (push mode) or while an explicit,
// user-started call is in its "listening" turn (call mode). It is closed on release / turn end / backgrounding.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useEffect, useMemo, useRef } from 'react';
import { AppState, Pressable } from 'react-native';
import { useT } from '../i18n';
import { isEcho } from '../utils/speech';
import { isGarbageTranscript, isRealBargeIn } from '../utils/voiceFilter';
import { chooseRecognizer, reasonFromNativeError } from '../utils/voiceRecognizer';
import { adaptiveEndOfSpeechMs } from '../utils/voiceVad';
import { radius, useTheme } from '../theme';
import { AppText } from './ui';

/** 'none' = heard nothing; the others say why listening is impossible so the screen can explain it. */
export type RecogError = 'denied' | 'failed' | 'none' | 'unsupported_language' | 'no_network';
export interface RecognitionControlsProps {
  locale: string; listening: boolean; disabled?: boolean;
  /** 'call': no button; recognition runs while `listenNow` is true. Default 'push' = hold-to-talk button. */
  mode?: 'push' | 'call'; listenNow?: boolean;
  /** Call mode, while the assistant is speaking: watch for the user talking over it (barge-in). Words that merely echo `spokenText` are ignored. */
  bargeIn?: boolean; spokenText?: string; onSpeechStart?: () => void;
  /** Drop speech that is just the assistant's own voice coming back through the speaker. Default true. */
  suppressEcho?: boolean;
  /** Cloud recorder only: clips with less speech than this (ms) are discarded before upload. Default 350. */
  minSpeechMs?: number;
  onListening: (on: boolean) => void; onTranscript: (text: string, final: boolean) => void; onError: (e: RecogError) => void;
}

/**
 * Picks the listening engine for the locale (see chooseRecognizer): the phone's recogniser when it supports the language,
 * otherwise our server-side transcription (CloudRecognition). Both honour the same props.
 */
export function RecognitionControls(props: RecognitionControlsProps) {
  const choice = useMemo(() => chooseRecognizer(props.locale, { deviceAvailable: true }), [props.locale]);
  if (choice.kind === 'cloud') {
    const Cloud = require('./CloudRecognition').CloudRecognition as React.ComponentType<RecognitionControlsProps>;
    return <Cloud {...props} />;
  }
  return <DeviceRecognition {...props} />;
}

function DeviceRecognition({ locale, listening, disabled, mode = 'push', listenNow = false, bargeIn = false, spokenText = '', suppressEcho = true, onSpeechStart, onListening, onTranscript, onError }: RecognitionControlsProps) {
  const t = useT();
  const { c } = useTheme();
  const active = useRef(false);
  const last = useRef('');
  const monitoring = useRef(false); // recogniser is running only to notice the user talking over the assistant
  const monitorFirstAt = useRef(0);
  const wantMonitor = useRef(false);
  const listenRef = useRef(listenNow);
  listenRef.current = listenNow;
  const spoken = useRef(spokenText);
  spoken.current = spokenText;
  const onStartRef = useRef(onSpeechStart);
  onStartRef.current = onSpeechStart;
  const echoRef = useRef(suppressEcho);
  echoRef.current = suppressEcho;
  const turnStartAt = useRef(0);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearEndTimer = () => { if (endTimer.current) { clearTimeout(endTimer.current); endTimer.current = null; } };
  const clearRestart = () => { if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; } };
  const scheduleMonitor = (ms: number) => { clearRestart(); restartTimer.current = setTimeout(() => { restartTimer.current = null; void startMonitor(); }, ms); };

  const startOpts = { lang: locale, interimResults: true, continuous: false, maxAlternatives: 1, requiresOnDeviceRecognition: false } as const;
  const startMonitor = async () => {
    if (!wantMonitor.current || active.current || disabled) return;
    try {
      const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!perm.granted || !wantMonitor.current || active.current) return; // never prompt for the microphone mid-reply
      monitoring.current = true; last.current = ''; monitorFirstAt.current = 0;
      ExpoSpeechRecognitionModule.start({ ...startOpts, requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() });
    } catch { monitoring.current = false; }
  };

  useSpeechRecognitionEvent('start', () => { active.current = true; if (!monitoring.current) { turnStartAt.current = 0; onListening(true); } });
  useSpeechRecognitionEvent('end', () => {
    active.current = false; clearEndTimer();
    if (monitoring.current) { // nobody interrupted: keep watching while the assistant is still talking
      monitoring.current = false; last.current = '';
      if (wantMonitor.current) scheduleMonitor(120);
      return;
    }
    onListening(false);
    const text = last.current; last.current = '';
    if (text && !isGarbageTranscript(text)) onTranscript(text, true); else onError('none');
  });
  useSpeechRecognitionEvent('result', (e) => {
    const r = e.results?.[0];
    const text = r?.transcript ?? '';
    const now = Date.now();
    if (monitoring.current) {
      if (!monitorFirstAt.current) monitorFirstAt.current = now;
      const conf = (r as { confidence?: number } | undefined)?.confidence;
      // Stricter than a normal turn: the speaker feeds the assistant's voice back into the microphone.
      if (!isRealBargeIn({ text, confidence: conf, sinceFirstMs: now - monitorFirstAt.current, spoken: spoken.current, suppressEcho: echoRef.current }) || isEcho(text, spoken.current, echoRef.current)) return;
      monitoring.current = false; onListening(true); onStartRef.current?.(); // real interruption: this session now becomes the listening turn
    }
    if (!turnStartAt.current) turnStartAt.current = now;
    const final = !!e.isFinal;
    if (final && isGarbageTranscript(text)) { last.current = ''; return; } // "um", a silence hallucination...: 'end' reports "heard nothing"
    last.current = text;
    onTranscript(text, final);
    // Adaptive end of speech (call mode): the platform waits a fixed ~1.5-2 s; we stop sooner after a finished-sounding sentence, later mid-thought.
    clearEndTimer();
    if (mode === 'call' && !final && text.trim()) {
      endTimer.current = setTimeout(() => { endTimer.current = null; if (active.current && !monitoring.current) ExpoSpeechRecognitionModule.stop(); }, adaptiveEndOfSpeechMs(now - turnStartAt.current, text));
    }
  });
  useSpeechRecognitionEvent('error', (e) => {
    active.current = false; last.current = ''; clearEndTimer();
    if (monitoring.current) { monitoring.current = false; if (e.error === 'no-speech' && wantMonitor.current) scheduleMonitor(300); return; }
    onListening(false);
    const reason = reasonFromNativeError(e.error);
    onError(reason);
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && active.current) ExpoSpeechRecognitionModule.abort(); });
    return () => {
      sub.remove(); clearEndTimer(); clearRestart(); wantMonitor.current = false;
      if (active.current) ExpoSpeechRecognitionModule.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    else if (active.current) { clearEndTimer(); ExpoSpeechRecognitionModule.abort(); }
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
