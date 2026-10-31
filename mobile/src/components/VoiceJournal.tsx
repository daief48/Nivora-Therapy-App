import { useGuideConsent, useGuideFallback, useGuideSuppress } from '../guide';
import { useNavigation } from '@react-navigation/native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { postVoiceJournal, readEmotions, updateJournalEntry, type VoiceEmotions, type VoiceLang, type VoiceResult, type VoiceSafety } from '../api/voiceJournal';
import { vjTranslate, type VjKey } from '../i18n/ext/voicejournal';
import { BreathingOrb, FadeInUp, PressScale, Shimmer, Stagger, successHaptic, tapHaptic, useReducedMotion } from '../motion';
import type { Nav } from '../navigation/types';
import { useSettings } from '../store/settings';
import { radius, useTheme } from '../theme';
import { AiBadge } from './AiBadge';
import { Celebrate } from './Celebrate';
import { ConsentRequiredPrompt } from './ConsentRequired';
import { JournalStepCard } from './JournalStepCard';
import { AppText, Button, Card, Chip, Field, Icon, Row } from './ui';

export const MAX_VOICE_SEC = 180;
const BARS = 24;
const POLL_MS = 120;

/** Voice-journal strings: own dictionaries, so no global i18n wiring is required. */
export function useVj() {
  const lang = useSettings((s) => s.uiLang);
  return (key: VjKey, vars?: Record<string, string | number>) => vjTranslate(lang, key, vars);
}

/** Small "voice" marker for entries with source === 'voice'. */
export function VoiceMarker({ source }: { source?: string }) {
  const { c } = useTheme();
  const vj = useVj();
  if (source !== 'voice') return null;
  return (
    <View accessible accessibilityLabel={vj('vjMarkerA11y')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.lavender }}>
      <Icon name="mic-outline" size={12} color={c.tintFg[2]} />
      <AppText size={11} weight="700" style={{ color: c.tintFg[2] }}>{vj('vjMarker')}</AppText>
    </View>
  );
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const levelOf = (db: number | undefined) => (typeof db === 'number' && db > -159 ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0.15);

type Phase = 'idle' | 'recording' | 'transcribing' | 'review' | 'saved' | 'crisis' | 'error';
type ErrKind = 'denied' | 'offline' | 'tooShort' | 'tooLong' | 'noSpeech' | 'unavailable' | 'failed';
const ERR_KEY: Record<ErrKind, VjKey> = {
  denied: 'vjMicDenied', offline: 'vjOffline', tooShort: 'vjTooShort', tooLong: 'vjTooLong', noSpeech: 'vjNoSpeech', unavailable: 'vjUnavailable', failed: 'vjFailed',
};
export function errKind(e: unknown): ErrKind {
  const code = (e as { code?: string })?.code;
  if (code === 'NETWORK') return 'offline';
  if (code === 'AUDIO_TOO_SHORT') return 'tooShort';
  if (code === 'AUDIO_TOO_LONG' || (e as { status?: number })?.status === 413) return 'tooLong';
  if (code === 'NO_SPEECH') return 'noSpeech';
  if (code === 'MODE_DISABLED' || code === 'UNSUPPORTED_MEDIA') return 'unavailable';
  return 'failed';
}

/** The record -> transcribe -> review -> saved flow. `onTypeInstead` lets the screen offer the text editor as the fallback. */
export function VoiceJournalCard({ onTypeInstead }: { onTypeInstead?: () => void }) {
  const vj = useVj();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const lang = useSettings((s) => s.uiLang) as VoiceLang;
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });

  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<ErrKind | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0.15));
  const [level, setLevel] = useState(0.15);
  const [entry, setEntry] = useState<{ id: string; content: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [emotions, setEmotions] = useState<VoiceEmotions | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [safety, setSafety] = useState<VoiceSafety | null>(null);
  const [saving, setSaving] = useState(false);
  useGuideConsent(consentNeeded ? 'JOURNAL_AI_SHARING' : null, consentNeeded);
  useGuideSuppress('recording', phase === 'recording');
  useGuideFallback('voiceEmotions', emotions?.ai);
  const [play, setPlay] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const live = useRef(false);
  const clip = useRef<{ audio: ArrayBuffer; mime: string; sec: number } | null>(null);

  const clearTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => () => { clearTimer(); if (live.current) { live.current = false; void recorder.stop().catch(() => {}); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (k: ErrKind) => { setErr(k); setPhase('error'); };

  const send = useCallback(async () => {
    const cl = clip.current;
    if (!cl) { fail('failed'); return; }
    setPhase('transcribing'); setErr(null);
    try {
      const r: VoiceResult = await postVoiceJournal(cl.audio, cl.mime, { language: lang, durationSec: cl.sec });
      clip.current = null;
      if (r.crisis) { setSafety(r.safety); setEntry(null); setEmotions(null); setPhase('crisis'); return; }
      setEntry({ id: r.entry.id, content: r.entry.content }); setDraft(r.entry.content);
      setEmotions(r.emotions); setConsentNeeded(r.consentNeeded === 'JOURNAL_AI_SHARING');
      void qc.invalidateQueries({ queryKey: ['journal'] });
      setPhase('review');
    } catch (e) {
      const k = errKind(e);
      if (k !== 'offline') clip.current = null; // keep the clip only when a retry can help
      fail(k);
    }
  }, [lang, qc]);

  const stop = useCallback(async (discard = false) => {
    if (!live.current) return;
    live.current = false; clearTimer();
    const sec = Math.round((Date.now() - startedAt.current) / 1000);
    let uri: string | null = null;
    try { await recorder.stop(); uri = recorder.uri; } catch { /* nothing recorded */ }
    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* ignore */ }
    if (discard) { setPhase('idle'); return; }
    if (!uri) { fail('tooShort'); return; }
    setPhase('transcribing');
    try {
      const blob = await (await fetch(uri)).blob();
      const mime = blob.type && blob.type.startsWith('audio/') ? blob.type : Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      clip.current = { audio: await blob.arrayBuffer(), mime, sec: Math.min(sec, MAX_VOICE_SEC) };
    } catch { fail('failed'); return; }
    await send();
  }, [recorder, send]);

  const start = async () => {
    setErr(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { fail('denied'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch { fail('failed'); return; }
    tapHaptic();
    live.current = true; startedAt.current = Date.now();
    setElapsed(0); setBars(Array(BARS).fill(0.15)); setPhase('recording');
    timer.current = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(Math.min(sec, MAX_VOICE_SEC));
      const l = levelOf(recorder.getStatus().metering);
      setLevel(l); setBars((b) => [...b.slice(1), l]);
      if (sec >= MAX_VOICE_SEC) { tapHaptic(); void stop(false); }
    }, POLL_MS);
  };

  const finishNow = () => { tapHaptic(); void stop(false); };

  const saveEdits = async () => {
    if (!entry) return;
    const next = draft.trim();
    if (next && next !== entry.content) {
      setSaving(true);
      try { await updateJournalEntry(entry.id, next); setEntry({ ...entry, content: next }); void qc.invalidateQueries({ queryKey: ['journal'] }); }
      catch (e) { setSaving(false); setErr(errKind(e) === 'offline' ? 'offline' : 'failed'); return; }
      setSaving(false);
    }
    setErr(null); setPhase('saved'); setPlay((n) => n + 1);
  };

  const afterConsent = async () => {
    setConsentNeeded(false);
    try {
      const r = await readEmotions((entry?.content ?? draft).trim(), entry?.id);
      if (r.crisis) { setSafety(r.safety ?? null); setPhase('crisis'); return; }
      setEmotions({ emotions: r.emotions ?? [], reflection: r.reflection, suggestion: r.suggestion, ai: r.ai ?? true, step: r.step ?? null, saved: r.saved });
    } catch { /* the entry is saved either way; the reading can be tried later */ }
  };

  const reset = () => { setPhase('idle'); setEntry(null); setEmotions(null); setConsentNeeded(false); setSafety(null); setErr(null); setDraft(''); setPlay(0); clip.current = null; };

  const insights = (
    <>
      {emotions ? (
        <Card tone="lavender">
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText size={13} weight="800" style={{ color: c.accent }}>{vj('vjFeelings')}</AppText>
            <AiBadge ai={emotions.ai !== false} />
          </Row>
          {emotions.emotions.length ? (
            <Row style={{ flexWrap: 'wrap' }}><Stagger step={70}>{emotions.emotions.map((x) => <Chip key={x} label={x} selected onPress={() => {}} />)}</Stagger></Row>
          ) : null}
          <Stagger step={140}>
            {[
              emotions.reflection ? <View key="r" style={{ gap: 2 }}><AppText size={12} weight="700" muted>{vj('vjReflection')}</AppText><AppText>{emotions.reflection}</AppText></View> : null,
              emotions.suggestion ? <View key="s" style={{ gap: 2 }}><AppText size={12} weight="700" muted>{vj('vjMinute2')}</AppText><AppText>{emotions.suggestion}</AppText></View> : null,
              <AppText key="n" size={12} muted>{vj('vjNoteAi')}</AppText>,
            ].filter(Boolean)}
          </Stagger>
        </Card>
      ) : null}
      {entry && emotions?.step && emotions.saved !== false ? <JournalStepCard key={entry.id} entryId={entry.id} step={emotions.step} /> : null}
      {consentNeeded ? (
        <FadeInUp>
          <AppText size={13} muted>{vj('vjConsentLater')}</AppText>
          <ConsentRequiredPrompt error={{ code: 'CONSENT_REQUIRED', details: { consentType: 'JOURNAL_AI_SHARING' } }} onGranted={() => { void afterConsent(); }} onDismiss={() => setConsentNeeded(false)} />
        </FadeInUp>
      ) : null}
    </>
  );

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row><Icon name="mic-outline" size={18} color={c.primary} /><AppText size={16} weight="800">{vj('vjTitle')}</AppText></Row>
      </Row>

      {phase === 'idle' ? (
        <View style={{ gap: 12, alignItems: 'center' }}>
          <AppText size={13} muted>{vj('vjIntro')}</AppText>
          <MicButton label={vj('vjStart')} onPress={start} />
        </View>
      ) : null}

      {phase === 'recording' ? (
        <View style={{ gap: 10, alignItems: 'center' }}>
          <BreathingOrb level={level} running size={110} showLabel={false} />
          <Waveform bars={bars} still={reduced} />
          <AppText size={20} weight="800" accessibilityLiveRegion="polite" accessibilityLabel={vj('vjTimer', { s: fmt(elapsed) })}>{vj('vjTimer', { s: fmt(elapsed) })}</AppText>
          <AppText size={13} muted>{vj('vjRecording')}</AppText>
          <MicButton label={vj('vjStop')} recording onPress={finishNow} />
          <Button title={vj('vjCancel')} variant="ghost" onPress={() => { void stop(true); }} />
        </View>
      ) : null}

      {phase === 'transcribing' ? (
        <View accessibilityRole="progressbar" accessibilityLabel={vj('vjTranscribing')} style={{ gap: 8 }}>
          <AppText muted>{vj('vjTranscribing')}</AppText>
          <Shimmer />
          <Shimmer width="85%" />
          <Shimmer width="60%" />
        </View>
      ) : null}

      {phase === 'review' || phase === 'saved' ? (
        <View style={{ gap: 10 }}>
          {phase === 'review' ? (
            <>
              <AppText size={14} weight="700">{vj('vjReviewTitle')}</AppText>
              <AppText size={12} muted>{vj('vjReviewHint')}</AppText>
              <Field value={draft} onChangeText={setDraft} accessibilityLabel={vj('vjEdit')} multiline maxLength={20000} style={{ minHeight: 140, borderRadius: 16 }} />
              {err ? <AppText size={13} accessibilityRole="alert" style={{ color: c.danger }}>{vj(ERR_KEY[err])}</AppText> : null}
              <Button title={draft.trim() !== entry?.content ? vj('vjSaveChanges') : vj('vjDone')} icon="checkmark" loading={saving} disabled={!draft.trim()} onPress={saveEdits} />
            </>
          ) : (
            <View style={{ gap: 8, alignItems: 'center', minHeight: 90, justifyContent: 'center' }}>
              <Celebrate play={play} variant="petals" haptic />
              <AppText weight="700" style={{ textAlign: 'center' }}>{vj('vjSaved')}</AppText>
              <AppText muted numberOfLines={4}>{entry?.content}</AppText>
              <Button title={vj('vjAnother')} variant="secondary" icon="mic-outline" onPress={reset} />
            </View>
          )}
          {insights}
        </View>
      ) : null}

      {phase === 'crisis' ? (
        <Card tone="danger" accessibilityRole="alert">
          <AppText size={20} weight="700">{vj('vjCrisisTitle')}</AppText>
          {safety?.message ? <AppText>{safety.message}</AppText> : null}
          {(safety?.resources ?? []).map((r) => (
            <View key={`${r.name}-${r.contactDetails}`}><AppText weight="700">{r.name}</AppText><AppText size={18} weight="700">{r.contactDetails}</AppText></View>
          ))}
          <AppText size={13} muted>{vj('vjCrisisNote')}</AppText>
          <Button title={vj('vjOpenEmergency')} variant="danger" onPress={() => nav.navigate('Emergency')} />
          <Button title={vj('vjDone')} variant="ghost" onPress={reset} />
        </Card>
      ) : null}

      {phase === 'error' && err ? (
        <View style={{ gap: 10 }}>
          <AppText accessibilityRole="alert" muted>{vj(ERR_KEY[err])}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            {err === 'offline' && clip.current ? <Button title={vj('vjRetry')} icon="refresh-outline" onPress={() => { void send(); }} />
              : err !== 'unavailable' && err !== 'denied' ? <Button title={vj('vjRetry')} icon="mic-outline" onPress={() => { reset(); void start(); }} /> : null}
            {onTypeInstead ? <Button title={vj('vjTypeInstead')} variant="secondary" onPress={onTypeInstead} /> : null}
            <Button title={vj('vjCancel')} variant="ghost" onPress={reset} />
          </Row>
        </View>
      ) : null}
    </Card>
  );
}

function MicButton({ label, onPress, recording }: { label: string; onPress: () => void; recording?: boolean }) {
  const { c } = useTheme();
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} haptic={false}
      style={{ minHeight: 72, minWidth: 72, paddingHorizontal: 28, borderRadius: radius.pill, backgroundColor: recording ? c.danger : c.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}>
      <Icon name={recording ? 'stop' : 'mic'} size={26} color={recording ? c.onDanger : c.onPrimary} />
      <AppText size={17} weight="700" style={{ color: recording ? c.onDanger : c.onPrimary }}>{label}</AppText>
    </PressScale>
  );
}

function Waveform({ bars, still }: { bars: number[]; still?: boolean }) {
  const { c } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 44 }}>
      {bars.map((b, i) => <View key={i} style={{ width: 4, height: Math.max(4, (still ? 0.3 : b) * 44), borderRadius: 2, backgroundColor: c.primary, opacity: 0.4 + 0.6 * (i / bars.length) }} />)}
    </View>
  );
}
