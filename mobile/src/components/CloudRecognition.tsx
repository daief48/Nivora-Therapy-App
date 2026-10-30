// Bangla (and mixed) listening. Phones rarely ship an offline Bangla recognizer, and Expo Go / the web have none, so the
// recording is sent to OUR backend (/speech/transcribe), which does the transcription. The microphone is opened only while an
// explicit, user-started call is in its "listening" turn (or while the hold-to-talk button is pressed) and closed right after;
// the audio is uploaded once and is not stored by the server.
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import React, { useEffect, useRef } from 'react';
import { AppState, Platform, Pressable } from 'react-native';
import { apiTranscribe } from '../api/client';
import { useT } from '../i18n';
import { radius, useTheme } from '../theme';
import type { RecognitionControlsProps } from './RecognitionControls';
import { AppText } from './ui';

const POLL_MS = 120;
const SILENCE_MS = 1500;      // this long after the last word ends the turn
const NO_SPEECH_MS = 9000;    // nobody spoke at all
const MAX_MS = 30000;
const MIN_SPEECH_MS = 300;
const NO_METER_MS = 7000;     // browsers without level metering: record this long, then send

export function CloudRecognition({ locale, listening, disabled, mode = 'push', listenNow = false, onListening, onTranscript, onError }: RecognitionControlsProps) {
  const t = useT();
  const { c } = useTheme();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const running = useRef(false);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lang = locale.startsWith('bn') ? 'bn' : locale.startsWith('en') ? 'en' : 'mixed';

  const clearTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  const finish = async (discard: boolean) => {
    if (!running.current) return;
    running.current = false; clearTimer();
    onListening(false);
    let uri: string | null = null;
    try { await recorder.stop(); uri = recorder.uri; } catch { /* nothing recorded */ }
    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* ignore */ }
    if (discard || cancelled.current || !uri) { if (!discard) onError('none'); return; }
    try {
      const blob = await (await fetch(uri)).blob();
      const mime = blob.type && blob.type.startsWith('audio/') ? blob.type : Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      const text = (await apiTranscribe(await blob.arrayBuffer(), mime, lang)).trim();
      if (cancelled.current) return;
      if (text) onTranscript(text, true); else onError('none');
    } catch { if (!cancelled.current) onError('failed'); }
  };

  const begin = async () => {
    if (disabled || running.current) return;
    cancelled.current = false;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { onError('denied'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch { onError('failed'); return; }
    running.current = true; onListening(true);
    if (mode !== 'call') return; // hold-to-talk: the button release ends it
    const t0 = Date.now(); let lastVoice = 0; let voiceMs = 0; let floor = 0; let seen = 0;
    timer.current = setInterval(() => {
      const now = Date.now() - t0;
      const m = recorder.getStatus().metering;
      if (typeof m === 'number' && m > -159) {
        seen += 1;
        if (seen <= 4) floor = seen === 1 ? m : Math.min(floor, m); // learn the room's background level first
        const loud = seen > 4 && m > Math.max(-45, floor + 12);
        if (loud) { lastVoice = now; voiceMs += POLL_MS; }
        if (voiceMs >= MIN_SPEECH_MS && now - lastVoice > SILENCE_MS) void finish(false);
        else if (voiceMs < MIN_SPEECH_MS && now > NO_SPEECH_MS) void finish(false);
      } else if (now > NO_METER_MS) void finish(false);
      if (now > MAX_MS) void finish(false);
    }, POLL_MS);
  };

  useEffect(() => {
    if (mode !== 'call') return;
    if (listenNow) void begin();
    else if (running.current) { cancelled.current = true; void finish(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenNow, mode]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && running.current) { cancelled.current = true; void finish(true); } });
    return () => { sub.remove(); cancelled.current = true; if (running.current) void finish(true); clearTimer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === 'call') return null;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={listening ? t('releaseToSend') : t('holdToTalk')} accessibilityHint={t('voiceNote')}
      onPressIn={begin} onPressOut={() => void finish(false)} disabled={disabled}
      style={{ minHeight: 72, borderRadius: radius.pill, backgroundColor: listening ? c.danger : c.primary, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1, paddingHorizontal: 24 }}>
      <AppText size={18} weight="700" style={{ color: listening ? c.onDanger : c.onPrimary }}>{listening ? t('listening') : t('holdToTalk')}</AppText>
    </Pressable>
  );
}
