import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessageKey, useMe } from '../api/hooks';
import type { ChatMessage } from '../api/types';
import { Avatar, type AvatarState, type AvatarTone, type ReactionEvent } from '../components/Avatar';
import { SakuraPetals } from '../components/sakura';
import { PulseRings, SoftOrbs, Waveform } from '../components/Brand';
import type { RecogError, RecognitionControlsProps } from '../components/RecognitionControls';
import { SessionBar } from '../components/SessionBar';
import { AppText, Button, Card, Field, Icon, OfflineBanner, Row, type IconName } from '../components/ui';
import { MAX_MESSAGE_CHARS } from '../config';
import { useConversation } from '../hooks/useConversation';
import { useT } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { reactionFor, replyToneFor, toneFor } from '../utils/reaction';
import { createRealtimeClient, firstAudio, realtimeSupported, turnStarted, type RealtimeClient } from '../utils/realtimeClient';
import { recognition, speak, speakStream, speechLocale, stopSpeaking, type SpeechStream } from '../utils/speech';
import { track } from '../utils/analytics';
import { LONG_CALL_SECS, setKeepAwake, shouldShowEchoHint, watchdogDecision, type CallPhase } from '../utils/callResilience';

const MAX_EMPTY_TURNS = 3; // after this many silent turns the call pauses instead of keeping the mic open
const WHITE = '#FFFFFF', SOFT = 'rgba(255,255,255,0.78)';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Outline pill that stays readable on the dark call backgrounds. */
function LightBtn({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

/** Round call button, optionally with a caption underneath (phone-style control grid). */
function CircleBtn({ icon, label, onPress, bg = 'rgba(255,255,255,0.16)', fg = WHITE, size = 56, caption, rotate }: {
  icon: IconName; label: string; onPress: () => void; bg?: string; fg?: string; size?: number; caption?: string; rotate?: number;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 6, minWidth: size }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
        style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.8 : 1 })}>
        <View style={rotate ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}><Icon name={icon} size={size * 0.44} color={fg} /></View>
      </Pressable>
      {caption ? <Text style={{ color: SOFT, fontSize: 12, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{caption}</Text> : null}
    </View>
  );
}

/**
 * Voice call and avatar ("video") call with the AI companion. Two different experiences share one conversation loop:
 *  - Voice call: a phone-call screen. Contact photo with pulsing rings, "Calling…" → running timer, keypad-style controls.
 *  - Video call: a full-screen avatar feed with a "You · camera off" tile, live captions and floating call controls.
 * The video call is an animated illustration: there is NO camera, NO real video and NO real person on the other end.
 * Loop: after the user presses Start → listen → AI replies → speak → listen. The mic is open only during the listening turn,
 * and stops on End, on pause, and when the app is backgrounded.
 */
export function CallScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { mode, sessionId, opts: sessionOpts } = useRoute<RouteProp<RootParams, 'Call'>>().params;
  const video = mode === 'video';
  const me = useMe();
  const { ttsMuted, set } = useSettings();
  const language = me.data?.locale ?? 'en';

  const [box, setBox] = useState({ w: 390, h: 700 });
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [listenNow, setListenNow] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false); // reply received, voice audio being prepared
  const [voiceNotice, setVoiceNotice] = useState(false);
  const [captions, setCaptions] = useState(true); // live captions on the avatar call (optional)
  const [reaction, setReaction] = useState<ReactionEvent | null>(null); // how she reacts to what you just said
  const [tone, setTone] = useState<AvatarTone>('warm'); // her expression while speaking the reply
  const [spokenText, setSpokenText] = useState(''); // the reply being spoken: drives lip-sync timing and the reply-tone face
  const [listenPulse, setListenPulse] = useState(0); // ticks while you speak so she nods along
  const [pulse, setPulse] = useState(0);
  const [caption, setCaption] = useState('');
  const [recogError, setRecogError] = useState<RecogError | null>(null);
  const [typed, setTyped] = useState('');
  const [showTyping, setShowTyping] = useState(false);
  const [secs, setSecs] = useState(0);
  const [ended, setEnded] = useState(false);
  // live (realtime) voice, web only; everything else uses the turn-based path below
  const rtCapable = useMemo(() => realtimeSupported(), []);
  const [rtOn, setRtOn] = useState(false);
  const [rtFailed, setRtFailed] = useState(false);
  const [rtPhase, setRtPhase] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  const [rtText, setRtText] = useState('');
  const [rtErrorKey, setRtErrorKey] = useState<ReturnType<typeof errorMessageKey> | null>(null);
  const [fallbackNote, setFallbackNote] = useState(false);
  const [crisisNote, setCrisisNote] = useState(false);
  const [crisisActive, setCrisisActive] = useState(false); // Emergency button stays prominent for the rest of the call
  const [rtReconnecting, setRtReconnecting] = useState(false);
  const [slowHint, setSlowHint] = useState(false);
  const [echoHint, setEchoHint] = useState(false);
  const [longDismissed, setLongDismissed] = useState(false);
  const [replacedNote, setReplacedNote] = useState(false);
  const [bgNote, setBgNote] = useState(false);
  const [energy, setEnergy] = useState(0); // smoothed loudness of the playing assistant audio (web live path)

  const activeRef = useRef(false);
  const lastNod = useRef({ at: 0, len: 0 });
  const empties = useRef(0);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const muted = useRef(ttsMuted);
  muted.current = ttsMuted;
  const rt = useRef<RealtimeClient | null>(null);
  const rtOnRef = useRef(false);
  const rtFailedRef = useRef(false);
  const rtUser = useRef('');
  const rtReply = useRef('');
  const stream = useRef<SpeechStream | null>(null);
  const phaseRef = useRef<CallPhase>('listening');
  const phaseSince = useRef(Date.now());
  const lastAudioAt = useRef(0);
  const doneAt = useRef(0);
  const audioOn = useRef(false);
  const echoFrames = useRef(0);
  const echoShown = useRef(false);
  const headset = useRef<boolean | null>(null);
  const bgPaused = useRef(false);
  const finishedRef = useRef(false);

  const Controls = useMemo(
    // Bangla/mixed always listens through our server (phones rarely have an offline Bangla recognizer; Expo Go and the web have none).
    // English uses the phone's own recognizer when it has one.
    () => (language !== 'en'
      ? (require('../components/CloudRecognition').CloudRecognition as React.ComponentType<RecognitionControlsProps>)
      : recognition() ? (require('../components/RecognitionControls').RecognitionControls as React.ComponentType<RecognitionControlsProps>) : null),
    [language],
  );
  // Voice works with either the turn-based recogniser or live voice. Without both, the typing box is the main way to talk.
  const voiceOk = !!Controls || (rtCapable && !rtFailed);
  const typingOpen = showTyping || !voiceOk;

  const startListening = useCallback(() => {
    if (!activeRef.current || !Controls || rtOnRef.current) return;
    setCaption(''); setListenNow(false);
    setTimeout(() => { if (activeRef.current) setListenNow(true); }, 50);
  }, [Controls]);

  const speakCallbacks = useCallback(() => ({
    onPreparing: () => setPreparing(true),
    onStart: () => { setPreparing(false); setSpeaking(true); },
    onDone: () => { setPreparing(false); setSpeaking(false); startListening(); }, // the recogniser stays off while the AI talks (except barge-in watching on the phone recogniser)
    onError: () => { setPreparing(false); setSpeaking(false); startListening(); },
    onBoundary: () => setPulse((p) => p + 1),
    onNotice: () => setVoiceNotice(true),
  }), [startListening]);

  const say = useCallback((text: string) => {
    if (muted.current) { startListening(); return; }
    void speak(text, language, speakCallbacks());
  }, [language, startListening, speakCallbacks]);

  const dropStream = useCallback(() => { stream.current?.cancel(); stream.current = null; }, []);

  const conv = useConversation({
    sessionId, language, sessionType: 'VOICE', sessionOpts,
    // Speak sentence by sentence while the reply is still being written (first sound after the first sentence, not after the whole reply).
    onAssistantText: (full: string) => {
      if (!activeRef.current || muted.current || rtOnRef.current) return;
      stream.current ??= speakStream(language, speakCallbacks());
      stream.current.push(full);
    },
    onAssistantReplace: () => { stream.current?.replace(); },
    onAssistantDone: (m: ChatMessage, safety?: { crisis?: boolean }) => {
      if (!activeRef.current) { dropStream(); return; }
      if (m.crisis || safety?.crisis) { setCrisisNote(true); setCrisisActive(true); }
      setTone(toneFor(m.content)); setSpokenText(m.content);
      const st = stream.current; stream.current = null;
      if (st) st.end(m.content); else say(m.content);
    },
  });
  // a failed or cancelled reply must not leave half a sentence playing
  useEffect(() => { if (!conv.busy && stream.current) dropStream(); }, [conv.busy, dropStream]);
  const convRef = useRef(conv);
  convRef.current = conv;

  // Call timer starts once connected.
  useEffect(() => {
    if (!active || connecting) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active, connecting]);

  // An error from the AI pauses the call so the mic is not left open.
  useEffect(() => { if (conv.errorKey && activeRef.current) { setListenNow(false); setPaused(true); } }, [conv.errorKey]);

  /** The call phase shown on screen. Always follows the server's 'state' frames; local updates are only the optimistic part. */
  const setPhase = useCallback((p: CallPhase) => {
    if (phaseRef.current !== p) { phaseRef.current = p; phaseSince.current = Date.now(); }
    setRtPhase(p);
  }, []);
  const idleRt = useCallback(() => {
    audioOn.current = false; setSpeaking(false); setPreparing(false); setPhase('listening'); setListening(true); setEnergy(0);
  }, [setPhase]);
  const closeRt = useCallback(() => {
    rt.current?.close(); rt.current = null; rtOnRef.current = false; setRtOn(false); setRtReconnecting(false); setPhase('listening'); setEnergy(0);
  }, [setPhase]);
  const checkEcho = useCallback(() => {
    if (shouldShowEchoHint({ alreadyShown: echoShown.current, echoFrames: echoFrames.current, headset: headset.current })) {
      echoShown.current = true; setEchoHint(true); setTimeout(() => setEchoHint(false), 12000);
    }
  }, []);

  /** Live voice (web). Resolves true when the relay is ready; false means "use the turn-based path". */
  const connectRt = useCallback(async (): Promise<boolean> => {
    const idle = idleRt;
    const client = createRealtimeClient({
      onSpeechStarted: () => { idle(); setCaption(''); setSlowHint(false); },
      onPartial: (txt) => {
        setCaption(txt);
        const now = Date.now();
        if (txt.length - lastNod.current.len >= 7 && now - lastNod.current.at > 650) { lastNod.current = { at: now, len: txt.length }; setListenPulse((p) => p + 1); }
      },
      onFinal: (txt) => {
        setCaption(txt); rtUser.current = txt; rtReply.current = ''; setRtText(''); lastNod.current = { at: 0, len: 0 };
        doneAt.current = 0; audioOn.current = false; setSlowHint(false);
        setPhase('thinking'); setListening(false); setRtErrorKey(null);
        setReaction({ type: reactionFor(txt), key: Date.now() });
        turnStarted(txt);
      },
      onAssistantDelta: (d) => { rtReply.current += d; setRtText(rtReply.current); },
      onAudioStart: () => { firstAudio('realtime'); audioOn.current = true; lastAudioAt.current = Date.now(); setPreparing(false); setSpeaking(true); setPhase('speaking'); setTone(toneFor(rtReply.current)); },
      onAssistantDone: (crisis) => {
        doneAt.current = Date.now();
        convRef.current.appendTurn(rtUser.current, rtReply.current, crisis);
        setSpokenText(rtReply.current);
        if (crisis) { setCrisisNote(true); setCrisisActive(true); }
        rtUser.current = '';
      },
      onPlaybackEnd: () => { idle(); setCaption(''); },
      onInterrupted: () => idle(),
      onError: (code) => { idle(); setRtErrorKey(errorMessageKey({ code })); },
      // the server is the source of truth for the phase: every frame reconciles the screen
      onState: (p) => {
        setPhase(p);
        if (p === 'listening') { audioOn.current = false; setSpeaking(false); setPreparing(false); setListening(true); }
        else if (p === 'thinking') { doneAt.current = 0; setSpeaking(false); setListening(false); }
        else { setListening(false); if (!audioOn.current) setPreparing(true); }
      },
      onEnergy: (e) => { setEnergy(e); if (e > 0) lastAudioAt.current = Date.now(); },
      onIgnored: (reason) => { if (reason === 'echo') { echoFrames.current += 1; checkEcho(); } },
      onReconnecting: () => { setRtReconnecting(true); setSpeaking(false); setPreparing(false); },
      onReconnected: () => { setRtReconnecting(false); idle(); },
      onReplaced: () => {
        rt.current = null; rtOnRef.current = false; setRtOn(false); finishedRef.current = true; // the other device now owns the session: do not end it
        stopAll(); setEnded(true); setReplacedNote(true);
      },
      onMicLost: () => { setRecogError('denied'); setShowTyping(true); },
      onUnavailable: () => {
        // the relay or the speech service went away for good: carry on with the turn-based voice path
        closeRt(); rtFailedRef.current = true; setRtFailed(true); setFallbackNote(true); setSpeaking(false); setPreparing(false); setListening(false);
        if (activeRef.current && Controls) startListening();
      },
    });
    rt.current = client;
    let sid: string;
    try { sid = await convRef.current.ensureSession(); } catch { rt.current = null; rtFailedRef.current = true; setRtFailed(true); return false; }
    const r = await client.connect(sid);
    if (!activeRef.current) { client.close(); if (rt.current === client) rt.current = null; return false; }
    if (!r.ok) {
      if (rt.current === client) rt.current = null;
      rtFailedRef.current = true; setRtFailed(true);
      if (r.reason === 'denied') { setRecogError('denied'); setShowTyping(true); } else if (r.reason === 'unavailable') setFallbackNote(true);
      return false;
    }
    client.setMuted(muted.current);
    rtOnRef.current = true; setRtOn(true); setPhase('listening'); setListening(true); setFallbackNote(false);
    if (Platform.OS === 'web') void client.detectHeadset().then((hs) => { headset.current = hs; checkEcho(); });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Controls, startListening, closeRt, idleRt, setPhase, checkEcho]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (!activeRef.current) return;
      if (st !== 'active') {
        if (rtOnRef.current) {
          // live call: pause the microphone and the voice, keep the call; it resumes when the app returns
          rt.current?.interrupt(); rt.current?.pauseCapture(); bgPaused.current = true; setBgNote(true);
          setSpeaking(false); setPreparing(false); setListening(false); setPaused(true);
          return;
        }
        dropStream(); closeRt(); stopSpeaking(); setSpeaking(false); setPreparing(false); setListenNow(false); setListening(false); setPaused(true);
      } else if (bgPaused.current && rtOnRef.current) {
        bgPaused.current = false;
        void rt.current?.resumeCapture().then((ok) => { if (!ok || !activeRef.current) return; setBgNote(false); setPaused(false); idleRt(); });
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the screen stays awake during a call
  useEffect(() => { if (!active) return; setKeepAwake(true); return () => setKeepAwake(false); }, [active]);

  // Watchdog: never leave "Thinking…" (or a silent "speaking") stuck. Recover to listening, tell the server, show a soft hint.
  useEffect(() => {
    if (!rtOn) return;
    const id = setInterval(() => {
      const v = watchdogDecision({ phase: phaseRef.current, now: Date.now(), phaseSince: phaseSince.current, lastAudioAt: lastAudioAt.current, doneAt: doneAt.current, playing: !!rt.current?.isPlaying() });
      if (v === 'recover') { rt.current?.interrupt(); doneAt.current = 0; idleRt(); setSlowHint(true); }
    }, 1000);
    return () => clearInterval(id);
  }, [rtOn, idleRt]);
  useEffect(() => { if (!slowHint) return; const id = setTimeout(() => setSlowHint(false), 9000); return () => clearTimeout(id); }, [slowHint]);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    if (connectTimer.current) clearTimeout(connectTimer.current);
    closeRt(); dropStream(); bgPaused.current = false; setBgNote(false);
    setActive(false); setConnecting(false); setListenNow(false); setListening(false); setSpeaking(false); setPreparing(false); stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { activeRef.current = false; if (connectTimer.current) clearTimeout(connectTimer.current); rt.current?.close(); stream.current?.cancel(); stopSpeaking(); }, []);

  const startCall = () => {
    // Anonymous, opt-in usage count only: mode and language, never anything that was said.
    track('call_started', { mode: video ? 'video' : 'voice', lang: language });
    activeRef.current = true; empties.current = 0; finishedRef.current = false;
    setReplacedNote(false); setSlowHint(false); setLongDismissed(false); setCrisisNote(false);
    setActive(true); setPaused(false); setEnded(false); setSecs(0); setRecogError(null); setConnecting(true);
    // a short "ringing / connecting" moment before the first listening turn makes it feel like a real call
    connectTimer.current = setTimeout(() => {
      if (rtCapable && !rtFailedRef.current) {
        void connectRt().then((ok) => { if (!activeRef.current) return; setConnecting(false); if (!ok && !rtOnRef.current) startListening(); });
        return;
      }
      setConnecting(false); startListening();
    }, video ? 1400 : 900);
  };
  const endCall = async () => {
    if (finishedRef.current) return; // End is idempotent: the session is ended and the summary flow starts exactly once
    finishedRef.current = true;
    track('call_ended', { mode: video ? 'video' : 'voice', duration_bucket: secs < 60 ? 'lt1m' : secs < 300 ? '1to5m' : secs < 900 ? '5to15m' : 'gt15m' });
    stopAll(); conv.cancel(); setEnded(true);
    try { await conv.finish(false); } catch { /* nothing to end if no message was ever sent */ }
  };
  const resume = () => {
    empties.current = 0; setPaused(false); setRecogError(null);
    if (rtOnRef.current) { bgPaused.current = false; setBgNote(false); void rt.current?.resumeCapture().then((ok) => { if (ok) idleRt(); else setPaused(true); }); return; }
    if (rtCapable && !rtFailedRef.current && !rtOnRef.current) { void connectRt().then((ok) => { if (!ok) startListening(); }); return; }
    startListening();
  };
  const toText = () => { stopAll(); nav.navigate('Chat', conv.sessionId ? { sessionId: conv.sessionId } : undefined); };
  const leave = () => { stopAll(); nav.goBack(); };
  const toggleMute = () => { if (!ttsMuted) { dropStream(); stopSpeaking(); setSpeaking(false); } rt.current?.setMuted(!ttsMuted); set({ ttsMuted: !ttsMuted }); };
  /** Stop talking now: the stop button or "stop generating". */
  const stopTalking = () => {
    dropStream(); stopSpeaking(); setSpeaking(false); setPreparing(false);
    if (rtOnRef.current) { rt.current?.interrupt(); setPhase('listening'); setListening(true); } else startListening();
  };
  /** The user started talking over the assistant (phone recogniser noticed words that are not the assistant's own voice). */
  const bargeIn = () => { dropStream(); stopSpeaking(); setSpeaking(false); setPreparing(false); };

  const onTranscript = (txt: string, final: boolean) => {
    if (!activeRef.current) return;
    setCaption(txt);
    if (!final) { // a small nod roughly every few words (at most ~1.5/s) so she visibly follows what you say
      const now = Date.now();
      if (txt.length - lastNod.current.len >= 7 && now - lastNod.current.at > 650) { lastNod.current = { at: now, len: txt.length }; setListenPulse((p) => p + 1); }
    }
    if (final && txt.trim()) {
      empties.current = 0; lastNod.current = { at: 0, len: 0 }; setListenNow(false);
      setReaction({ type: reactionFor(txt), key: Date.now() });
      turnStarted(txt);
      void conv.send(txt);
    }
  };
  const onError = (e: RecogError) => {
    setListenNow(false);
    if (!activeRef.current) return;
    if (e === 'denied') { setRecogError('denied'); setShowTyping(true); stopAll(); return; }
    if (e === 'failed') { setRecogError('failed'); setShowTyping(true); setPaused(true); return; }
    // clear, kind reasons instead of a silent retry loop
    if (e === 'no_network') { setRecogError('no_network'); setShowTyping(true); setPaused(true); return; }
    if (e === 'unsupported_language') { setRecogError('unsupported_language'); setShowTyping(true); return; }
    // 'none' = silence. Retry a few times, then pause rather than keep listening forever.
    if (conv.busy || speaking) return;
    empties.current += 1;
    if (empties.current >= MAX_EMPTY_TURNS) setPaused(true);
    else setTimeout(startListening, 500);
  };

  const sendTyped = () => {
    const text = typed.trim(); if (!text) return;
    setTyped(''); setPaused(false); setListenNow(false); dropStream(); stopSpeaking();
    if (!activeRef.current) { activeRef.current = true; setActive(true); setEnded(false); setConnecting(false); }
    setReaction({ type: reactionFor(text), key: Date.now() });
    turnStarted(text);
    void conv.send(text);
  };

  const thinking = conv.busy || (rtOn && rtPhase === 'thinking');
  const errKey = conv.errorKey ?? rtErrorKey;
  const avatarState: AvatarState = recogError === 'failed' || errKey ? 'error' : listening ? 'listening' : thinking || preparing ? 'thinking' : speaking ? 'speaking' : 'idle';
  const lastMsg = [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.content);
  const last = rtOn && rtText ? { content: rtText } : lastMsg;
  const micOn = listening || listenNow;
  const status = !active ? '' : connecting ? t(video ? 'callConnecting' : 'callCalling') : paused ? t('callPaused') : micOn ? t('callListeningNow') : thinking || preparing ? t('thinking') : speaking ? t('callAiSpeaking') : t('callConnected');
  const timer = active && !connecting ? fmt(secs) : '';
  const initial = (me.data?.displayName ?? '?').trim().charAt(0).toUpperCase();
  const idle = !active && !ended; // before the call starts

  // ---- shared pieces ----
  const emergency = (
    <Pressable accessibilityRole="button" accessibilityLabel={t('emergency')} onPress={() => nav.navigate('Emergency')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.danger, borderRadius: 999, minHeight: crisisActive ? 52 : 44, paddingHorizontal: crisisActive ? 20 : 14, borderWidth: crisisActive ? 2.5 : 0, borderColor: WHITE }}>
      <Icon name="medkit-outline" size={crisisActive ? 22 : 18} color={c.onDanger} /><AppText size={crisisActive ? 16 : 14} weight="800" style={{ color: c.onDanger }}>{t('emergency')}</AppText>
    </Pressable>
  );
  const topBar = (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <CircleBtn icon="chevron-back" label={t('back')} onPress={leave} size={44} />
        {video ? (
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: WHITE, fontSize: 17, fontWeight: '800' }}>{t('appName')}</Text>
            <Text style={{ color: SOFT, fontSize: 12 }} numberOfLines={1}>{timer || (connecting ? status : t('callVideoSub'))}</Text>
          </View>
        ) : <View style={{ flex: 1 }} />}
        <Row style={{ gap: 8 }}>
          {!video && active ? <CircleBtn icon="chatbubble-ellipses-outline" label={t('switchToText')} onPress={toText} size={44} /> : null}
          {emergency}
        </Row>
      </Row>
      <OfflineBanner />
      <SessionBar sessionId={conv.sessionId} tone="light" />
    </View>
  );
  const typingRow = typingOpen ? (
    <Row style={{ paddingHorizontal: 14 }}>
      <View style={{ flex: 1 }}>
        <Field value={typed} onChangeText={setTyped} placeholder={t('callTypeInstead')} accessibilityLabel={t('callTypeInstead')} maxLength={MAX_MESSAGE_CHARS} editable={!conv.busy} style={{ borderRadius: 26, minHeight: 50 }} />
      </View>
      <CircleBtn icon="send" label={t('send')} onPress={sendTyped} bg={c.primary} fg={c.onPrimary} size={50} />
    </Row>
  ) : null;
  const notices = (
    <View style={{ paddingHorizontal: 14, gap: 8, alignItems: 'center' }}>
      {conv.reconnecting || rtReconnecting ? <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" size={13} style={{ color: '#FFE08A', textAlign: 'center' }}>{t('voiceReconnecting')}</AppText> : null}
      {errKey ? <AppText accessibilityRole="alert" style={{ color: '#FFB4AB', textAlign: 'center' }}>{t(errKey)}</AppText> : null}
      {crisisNote ? <AppText accessibilityRole="alert" size={13} weight="700" style={{ color: WHITE, textAlign: 'center' }}>{t('voiceCrisisNote')}</AppText> : null}
      {slowHint ? <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" size={13} style={{ color: '#FFE08A', textAlign: 'center' }}>{t('voiceSlowHint')}</AppText> : null}
      {echoHint ? <AppText accessibilityLiveRegion="polite" size={12} style={{ color: SOFT, textAlign: 'center' }}>{t('voiceHeadphones')}</AppText> : null}
      {bgNote ? <AppText accessibilityLiveRegion="polite" size={13} style={{ color: WHITE, textAlign: 'center' }}>{t('voiceCallPaused')}</AppText> : null}
      {replacedNote ? <AppText accessibilityRole="alert" size={13} style={{ color: WHITE, textAlign: 'center' }}>{t('voiceReplaced')}</AppText> : null}
      {active && !connecting && secs >= LONG_CALL_SECS && !longDismissed ? (
        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <AppText size={13} style={{ color: WHITE, flexShrink: 1, textAlign: 'center' }}>{t('voiceLongCall')}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('voiceDismiss')} onPress={() => setLongDismissed(true)} hitSlop={12}><Text style={{ color: SOFT, fontSize: 13, fontWeight: '800' }}>{t('voiceDismiss')}</Text></Pressable>
        </Row>
      ) : null}
      {fallbackNote ? <AppText size={12} style={{ color: '#FFE08A', textAlign: 'center' }}>{t('voiceFallback')}</AppText> : null}
      {rtOn ? <AppText size={11} style={{ color: SOFT, textAlign: 'center' }}>{t('voiceLive')}</AppText> : null}
      {!voiceOk ? <AppText accessibilityRole="alert" size={13} style={{ color: WHITE, textAlign: 'center' }}>{t('voiceUnavailable')}</AppText> : null}
      {recogError === 'denied' ? (
        <Card tone="lavender" style={{ alignSelf: 'stretch' }}>
          <AppText weight="800">{t('voiceMicDeniedTitle')}</AppText>
          <AppText>{t('voiceMicDeniedBody')}</AppText>
          <AppText size={13}>{Platform.OS === 'web' ? t('voiceMicDeniedWeb') : t('voiceMicDeniedNative')}</AppText>
          {Platform.OS !== 'web' ? <Button title={t('openSettings')} variant="secondary" onPress={() => { void Linking.openSettings(); }} /> : null}
          <Button title={t('voiceTypeInstead')} onPress={() => setShowTyping(true)} />
        </Card>
      ) : null}
      {recogError === 'failed' ? <AppText accessibilityRole="alert" size={13} style={{ color: WHITE }}>{t('speechError')}</AppText> : null}
      {recogError === 'no_network' ? <AppText accessibilityRole="alert" size={13} style={{ color: WHITE }}>{t('vpNoNetwork')}</AppText> : null}
      {recogError === 'unsupported_language' ? <AppText accessibilityRole="alert" size={13} style={{ color: WHITE }}>{t('vpUnsupportedLang')}</AppText> : null}
      {voiceNotice && language !== 'en' ? <AppText size={12} style={{ color: '#FFE08A', textAlign: 'center' }}>{t('callVoiceHint')}</AppText> : null}
      <AppText size={11} style={{ color: SOFT, textAlign: 'center' }}>{t('callNotReal')}</AppText>
    </View>
  );
  const recognizer = Controls ? (
    <Controls mode="call" listenNow={listenNow} locale={speechLocale(language)} listening={listening} disabled={conv.busy || speaking}
      bargeIn={speaking && !rtOn && !muted.current} spokenText={lastMsg?.content ?? ''} onSpeechStart={bargeIn}
      onListening={setListening} onTranscript={onTranscript} onError={onError} />
  ) : null;
  const endedBlock = ended ? (
    <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
      <AppText weight="800" size={18} style={{ color: WHITE }}>{t('callEnded')}</AppText>
      <AppText style={{ color: SOFT }}>{t('callTime')} {fmt(secs)}</AppText>
      <Row><Button title={t('callAgain')} onPress={startCall} disabled={!voiceOk} icon="call" /><LightBtn title={t('back')} onPress={leave} /></Row>
    </View>
  ) : null;

  // =====================================================  VIDEO CALL  =====================================================
  if (video) {
    return (
      <View style={{ flex: 1, backgroundColor: '#262524' }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {/* the "remote video": a full-screen animated avatar */}
        <View style={{ position: 'absolute', left: 0, top: 0, opacity: idle || connecting ? 0.55 : 1 }}>
          <Avatar variant="frame" state={avatarState} pulse={pulse} width={box.w} height={box.h} reaction={reaction} tone={tone} listenPulse={listenPulse} speechText={speaking ? spokenText : undefined} speechEnergy={rtOn && speaking ? energy : undefined} replyTone={spokenText ? replyToneFor(spokenText) : undefined} />
        </View>
        <SoftOrbs colors={['rgba(245,220,227,0.10)', 'rgba(168,184,160,0.08)', 'rgba(234,228,241,0.08)']} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 170 }} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 380 }} />
        {recognizer}

        <View style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>{topBar}</View>

        {/* "You" tile: camera is never used, so it shows an initial and a camera-off icon */}
        {active ? (
          <View accessible accessibilityLabel={`${t('callYou')} · ${t('callCameraOff')}`}
            style={{ position: 'absolute', right: 14, top: insets.top + 84, width: 92, height: 124, borderRadius: 18, backgroundColor: 'rgba(14,30,28,0.78)', alignItems: 'center', justifyContent: 'center', gap: 6,
              borderWidth: 2, borderColor: micOn ? '#E8B4C2' : 'rgba(255,255,255,0.25)' }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.onPrimary, fontSize: 20, fontWeight: '800' }}>{initial}</Text>
            </View>
            <Icon name="videocam-off-outline" size={16} color={SOFT} />
            <Text style={{ color: SOFT, fontSize: 11 }}>{t('callYou')}</Text>
          </View>
        ) : null}


        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 14, gap: 10 }}>
          {active && !connecting ? (
            <View style={{ paddingHorizontal: 14, gap: 8 }}>
              <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 14, minHeight: 34 }}>
                {micOn ? <View accessible={false} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF6B6B' }} /> : null}
                <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: WHITE, fontSize: 13, fontWeight: '700', flexShrink: 1 }}>{paused ? t('callPausedShort') : status}</Text>
                <Waveform active={listening || speaking} tone="light" height={16} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('captionsLabel')} accessibilityState={{ selected: captions }} onPress={() => setCaptions(!captions)} hitSlop={12}>
                  <Text style={{ color: captions ? WHITE : 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '800', borderWidth: 1.5, borderColor: captions ? WHITE : 'rgba(255,255,255,0.45)', borderRadius: 5, paddingHorizontal: 4 }}>CC</Text>
                </Pressable>
              </View>
              {captions && (caption || last) ? (
                <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 18, padding: 12 }}>
                  {caption ? <Text selectable style={{ color: WHITE, fontSize: 15 }}><Text style={{ fontWeight: '800' }}>{t('callYou')}: </Text>{caption}</Text>
                    : <Text selectable numberOfLines={4} style={{ color: WHITE, fontSize: 15 }}>{last!.content}</Text>}
                </View>
              ) : null}
            </View>
          ) : null}
          {endedBlock}
          {notices}
          {typingRow}
          {idle ? (
            <View style={{ paddingHorizontal: 14, gap: 8 }}>
              <AppText size={13} style={{ color: SOFT, textAlign: 'center' }}>{t('callIntro')}</AppText>
              <Button title={t('callStartVideo')} icon="videocam-outline" onPress={startCall} disabled={!voiceOk} />
              <LightBtn title={t('switchToText')} onPress={toText} />
            </View>
          ) : null}
          {active ? (
            <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(20,35,32,0.72)', borderRadius: 40, padding: 10 }}>
              <CircleBtn icon={ttsMuted ? 'volume-mute-outline' : 'volume-high-outline'} label={ttsMuted ? t('unmute') : t('mute')} onPress={toggleMute} size={52} />
              {paused ? <CircleBtn icon="mic" label={t('callTapToTalk')} onPress={resume} bg={c.primary} fg={c.onPrimary} size={58} />
                : speaking ? <CircleBtn icon="stop" label={t('stopSpeaking')} onPress={stopTalking} size={62} />
                : thinking ? <CircleBtn icon="stop" label={t('stopGenerating')} onPress={rtOn ? stopTalking : conv.cancel} size={62} />
                : <CircleBtn icon={micOn ? 'mic' : 'mic-outline'} label={t('callMicOn')} onPress={() => {}} bg={micOn ? c.primary : 'rgba(255,255,255,0.16)'} fg={micOn ? c.onPrimary : WHITE} size={62} />}
              <CircleBtn icon="keypad-outline" label={t('callKeyboard')} onPress={() => setShowTyping(!showTyping)} />
              <CircleBtn icon="chatbubble-ellipses-outline" label={t('switchToText')} onPress={toText} />
              <CircleBtn icon="call" label={t('callEnd')} onPress={endCall} bg={c.danger} fg={c.onDanger} rotate={135} />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // =====================================================  VOICE CALL  =====================================================
  const bottomReserve = (active ? 300 : 230) + (typingOpen ? 72 : 0) + (voiceNotice && language !== 'en' ? 40 : 0);
  const short = typingOpen || box.h < 700; // compact mode: fewer lines so nothing collides
  const photo = Math.max(96, Math.min(180, box.h - 70 - bottomReserve - (short ? 110 : 150)));
  return (
    <View style={{ flex: 1, backgroundColor: '#2F2A2E' }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <LinearGradient pointerEvents="none" colors={['#5A4452', '#3F4A43', '#262524']} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <SakuraPetals count={5} height={760} />
      {recognizer}
      {topBar}

      <View style={{ flex: 1, minHeight: 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 8, paddingHorizontal: 20, gap: 4 }}>
        <PulseRings active={(listening || speaking) && active} size={photo} color={speaking ? 'rgba(158,220,197,0.6)' : 'rgba(255,255,255,0.45)'}>
          <View style={{ width: photo, height: photo, borderRadius: photo / 2, overflow: 'hidden', borderWidth: 3, borderColor: 'rgba(255,255,255,0.45)', backgroundColor: '#CFE4F6' }}>
            <Avatar variant="portrait" state={avatarState} pulse={pulse} width={photo} height={photo} reaction={reaction} tone={tone} listenPulse={listenPulse} speechText={speaking ? spokenText : undefined} speechEnergy={rtOn && speaking ? energy : undefined} replyTone={spokenText ? replyToneFor(spokenText) : undefined} />
          </View>
        </PulseRings>
        <Text style={{ color: WHITE, fontSize: short ? 24 : 30, fontWeight: '800', marginTop: 12 }}>{t('appName')}</Text>
        {short ? null : <Text style={{ color: SOFT, fontSize: 14 }}>{t('callAudioSub')}</Text>}
        <Text accessibilityLiveRegion="polite" style={{ color: WHITE, fontSize: 18, fontWeight: '700', marginTop: 6, minHeight: 26 }}>
          {active ? (connecting ? status : timer) : ''}
        </Text>
        <Waveform active={active && !connecting && (listening || speaking)} tone="light" height={short ? 24 : 34} />
        <Text accessibilityLiveRegion="polite" style={{ color: SOFT, fontSize: 14, minHeight: 22, textAlign: 'center' }}>{active && !connecting ? status : ''}</Text>
        {active && !connecting && (caption || last) ? (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 18, padding: 12, alignSelf: 'stretch', marginTop: 6 }}>
            {caption
              ? <Text selectable style={{ color: WHITE, fontSize: 15, textAlign: 'center' }}>{caption}</Text>
              : <Text selectable numberOfLines={short ? 2 : 3} style={{ color: WHITE, fontSize: 15, textAlign: 'center' }}>{last!.content}</Text>}
          </View>
        ) : null}
      </View>

      <View style={{ paddingBottom: insets.bottom + 16, gap: 12 }}>
        {endedBlock}
        {notices}
        {typingRow}
        {idle ? (
          <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 20 }}>
            <AppText size={13} style={{ color: SOFT, textAlign: 'center' }}>{t('callIntro')}</AppText>
            <CircleBtn icon="call" label={t('callStartVoice')} onPress={startCall} bg="#5E8062" size={74} caption={t('callStartVoice')} />
            <LightBtn title={t('switchToText')} onPress={toText} />
          </View>
        ) : null}
        {active ? (
          <View style={{ gap: 18, alignItems: 'center' }}>
            <Row style={{ justifyContent: 'center', gap: 22, alignItems: 'flex-start' }}>
              <CircleBtn icon={ttsMuted ? 'volume-mute-outline' : 'volume-high-outline'} label={ttsMuted ? t('unmute') : t('mute')} onPress={toggleMute} size={58} caption={ttsMuted ? t('unmute') : t('mute')} />
              {paused ? <CircleBtn icon="mic" label={t('callTapToTalk')} onPress={resume} bg={c.primary} fg={c.onPrimary} size={74} caption={t('callTapToTalk')} />
                : speaking ? <CircleBtn icon="stop" label={t('stopSpeaking')} onPress={stopTalking} size={74} caption={t('stopSpeaking')} />
                : thinking ? <CircleBtn icon="stop" label={t('stopGenerating')} onPress={rtOn ? stopTalking : conv.cancel} size={74} caption={t('stopGenerating')} />
                : <CircleBtn icon={micOn ? 'mic' : 'mic-outline'} label={t('callMicOn')} onPress={() => {}} bg={micOn ? c.primary : 'rgba(255,255,255,0.16)'} fg={micOn ? c.onPrimary : WHITE} size={74} caption={micOn ? t('callMicOn') : ''} />}
              <CircleBtn icon="keypad-outline" label={t('callKeyboard')} onPress={() => setShowTyping(!showTyping)} size={58} caption={t('callKeyboard')} />
            </Row>
            <CircleBtn icon="call" label={t('callEnd')} onPress={endCall} bg={c.danger} fg={c.onDanger} size={72} rotate={135} caption={t('callEnd')} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
