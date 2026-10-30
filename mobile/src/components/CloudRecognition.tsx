// Bangla (and mixed) listening. Phones rarely ship an offline Bangla recognizer, and Expo Go / the web have none, so the
// recording is sent to OUR backend (/speech/transcribe), which does the transcription. The microphone is opened only while an
// explicit, user-started call is in its "listening" turn (or while the hold-to-talk button is pressed) and closed right after;
// the audio is uploaded once and is not stored by the server.
//
// Quality guards (call mode): the recorder starts the moment the turn opens, so the first words are never missed; the level meter
// decides whether anyone really spoke, and silent / too-short clips are dropped BEFORE upload (see utils/voiceVad). Transcripts that are
// fillers, silence hallucinations, or just the assistant's own words are dropped after transcription (see utils/voiceFilter).
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable } from 'react-native';
import { apiTranscribe } from '../api/client';
import { useT } from '../i18n';
import { isCloudEcho, isGarbageTranscript } from '../utils/voiceFilter';
import { adaptiveEndOfSpeechMs, DEFAULT_MIN_SPEECH_MS, POLL_MS, shouldUploadClip, SpeechGate } from '../utils/voiceVad';
import { radius, useTheme } from '../theme';
import type { RecognitionControlsProps } from './RecognitionControls';
import { AppText } from './ui';

// Silence that ends the turn is adaptive (see adaptiveEndOfSpeechMs): ~0.7 s after a short answer, up to 1.3 s after a long thought.
// Barge-in (talking over the assistant) is NOT done here: this recorder has no echo cancellation, so on a phone speaker it would hear
// the assistant and cut her off. Bangla relies on the stop button / the live (web) path instead.
const NO_SPEECH_MS = 9000;    // nobody spoke at all
const MAX_MS = 30000;
const NO_METER_MS = 7000;     // browsers without level metering: record this long, then send
/** After this much recording in one call the recorder object is released and recreated (memory / heat on long calls). */
export const RECREATE_AFTER_MS = 20 * 60 * 1000;

/** Wrapper: owns the recorder's lifetime and swaps in a fresh one when a long call has used the old one for a long time. */
export function CloudRecognition(props: RecognitionControlsProps) {
  const [gen, setGen] = useState(0);
  const total = useRef(0);
  const recreating = useRef(false);
  const onSessionEnd = useCallback((ms: number) => {
    total.current += ms;
    if (total.current >= RECREATE_AFTER_MS && !recreating.current) { recreating.current = true; total.current = 0; setGen((g) => g + 1); }
  }, []);
  useEffect(() => { recreating.current = false; }, [gen]);
  useEffect(() => () => { recreating.current = true; }, []); // unmounted: never schedule a recreate
  return <CloudRecorder key={gen} {...props} onSessionEnd={onSessionEnd} />;
}

function CloudRecorder({ locale, listening, disabled, mode = 'push', listenNow = false, spokenText = '', suppressEcho = true, minSpeechMs = DEFAULT_MIN_SPEECH_MS, onListening, onTranscript, onError, onSessionEnd }: RecognitionControlsProps & { onSessionEnd: (ms: number) => void }) {
  const t = useT();
  const { c } = useTheme();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const running = useRef(false);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const gate = useRef<SpeechGate | null>(null);
  const startedAt = useRef(0);
  const spoken = useRef(spokenText);
  spoken.current = spokenText;
  const lang = locale.startsWith('bn') ? 'bn' : locale.startsWith('en') ? 'en' : locale.startsWith('hi') ? 'hi' : locale.startsWith('ne') ? 'ne' : locale === 'auto' ? 'auto' : 'mixed';

  const clearTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  const finish = async (discard: boolean) => {
    if (!running.current) return;
    running.current = false; clearTimer();
    onListening(false);
    const recordedMs = Date.now() - startedAt.current;
    try { await finishClip(discard); } finally { onSessionEnd(recordedMs); }
  };

  const finishClip = async (discard: boolean) => {
    let uri: string | null = null;
    try { await recorder.stop(); uri = recorder.uri; } catch { /* nothing recorded */ }
    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* ignore */ }
    if (discard || cancelled.current || !uri) { if (!discard) onError('none'); return; }
    // Call mode: nobody really spoke (silence, a cough, room noise)? Do not upload; the server would only invent words from it.
    if (gate.current && !shouldUploadClip(gate.current.summary(), minSpeechMs)) { onError('none'); return; }
    try {
      const blob = await (await fetch(uri)).blob();
      const mime = blob.type && blob.type.startsWith('audio/') ? blob.type : Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      const text = (await apiTranscribe(await blob.arrayBuffer(), mime, lang)).trim();
      if (cancelled.current) return;
      if (!text || isGarbageTranscript(text) || (suppressEcho && isCloudEcho(text, spoken.current))) onError('none');
      else onTranscript(text, true);
    } catch (e) {
      if (!cancelled.current) onError((e as { code?: string })?.code === 'NETWORK' ? 'no_network' : 'failed');
    }
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
    running.current = true; startedAt.current = Date.now(); onListening(true);
    gate.current = null;
    if (mode !== 'call') return; // hold-to-talk: the button release ends it
    const g = new SpeechGate(POLL_MS);
    gate.current = g;
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const now = Date.now() - t0;
      const m = recorder.getStatus().metering;
      if (typeof m === 'number' && m > -159) {
        g.feed(now, m);
        if (g.speechMs >= minSpeechMs && now - g.lastVoiceAt > adaptiveEndOfSpeechMs(g.speechMs)) void finish(false);
        else if (g.speechMs < minSpeechMs && now > NO_SPEECH_MS) void finish(false);
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
