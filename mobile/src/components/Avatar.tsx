import React, { useEffect, useId, useRef, useState } from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
import { createLipSync, nextBlinkDelay } from '../utils/lipsync';
import type { ReplyTone } from '../utils/reaction';
import {
  AvatarArt, expression, reactionPose, staticFrame,
  type AvatarReaction, type AvatarState, type AvatarTone, type Frame, type Pose,
} from './AvatarArt';

export type { AvatarState, AvatarReaction, AvatarTone };

/** Tiny still portrait used as Nivora's identity mark (chat messages). Rendered once, never animated. */
export const AvatarMini = React.memo(function AvatarMini({ size = 24 }: { size?: number }) {
  const { isDark } = useTheme();
  const uid = `mini${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const colors = isDark ? { plateA: '#2C4A6E', plateB: '#192C47', ring: '#9ED6F2', danger: '#FF8A80' } : { plateA: '#EAF5FF', plateB: '#B7D5F0', ring: '#2F8FB8', danger: '#B3261E' };
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <AvatarArt f={staticFrame('idle')} state="idle" uid={uid} width={size} height={size} colors={colors} />
    </View>
  );
});
export interface ReactionEvent { type: AvatarReaction; key: number }

const REACTION_SECONDS = 2.4;
const POSE_KEYS: (keyof Pose)[] = ['smile', 'brow', 'lookX', 'lookY', 'tilt', 'nod', 'joy', 'blush', 'mouthO', 'wide', 'lid', 'sparkle'];

/** Blends a reaction pose over the base expression. env 0..1 fades it in and out. */
function blend(base: Pose, pose: Partial<Pose>, env: number): Pose {
  const out = { ...base };
  for (const k of POSE_KEYS) if (pose[k] !== undefined) out[k] = base[k] + (pose[k]! - base[k]) * env;
  return out;
}

/**
 * Drives the avatar at ~20 fps with plain numbers (identical on native and web). With reduced motion on there is no animation loop:
 * the avatar shows a still pose per state, and a still reaction pose for a couple of seconds.
 */
function useFrame(state: AvatarState, reduced: boolean, pulse: number, reaction: ReactionEvent | null, tone: AvatarTone, listenPulse: number, lip: ReturnType<typeof createLipSync>, neutral: boolean): Frame {
  const [f, setF] = useState<Frame>(() => staticFrame(state, tone));
  const stateRef = useRef(state); stateRef.current = state;
  const toneRef = useRef(tone); toneRef.current = tone;
  const pulseRef = useRef(pulse); pulseRef.current = pulse;
  const lastPulse = useRef(pulse);
  const reactRef = useRef<{ type: AvatarReaction; start: number } | null>(null);
  const lastReactKey = useRef<number | null>(null);
  const nodStart = useRef(-10);
  const curRef = useRef<Pose | null>(null); // the pose currently shown; eased toward the target each tick
  const lastListen = useRef(listenPulse);
  const neutralRef = useRef(neutral); neutralRef.current = neutral;

  // A new reaction event starts the reaction clock.
  useEffect(() => {
    if (!reaction || reaction.key === lastReactKey.current) return;
    lastReactKey.current = reaction.key;
    reactRef.current = { type: reaction.type, start: Date.now() / 1000 };
  }, [reaction]);
  // Each new chunk of what the user is saying makes her give a small "I'm listening" nod.
  useEffect(() => { if (listenPulse !== lastListen.current) { lastListen.current = listenPulse; nodStart.current = Date.now() / 1000; } }, [listenPulse]);

  useEffect(() => {
    if (reduced) {
      const base = { ...staticFrame(state, tone) };
      if (reaction && state !== 'speaking') {
        const { nod: _n, sparkle: _s, ...still } = reactionPose(reaction.type, 0);
        setF({ ...base, ...blend(expression(state, 0, tone), { ...still, sparkle: 0 }, 1) });
        const id = setTimeout(() => setF(staticFrame(stateRef.current, toneRef.current)), REACTION_SECONDS * 1000);
        return () => clearTimeout(id);
      }
      setF(base);
      return;
    }
    let mouth = 0, round = 0, target = 0, nextTarget = 0, nextBlink = Date.now() / 1000 + nextBlinkDelay(), blinkStart = -1;
    const id = setInterval(() => {
      const now = Date.now() / 1000;
      const s = stateRef.current;
      if (blinkStart < 0 && now > nextBlink) { blinkStart = now; nextBlink = now + nextBlinkDelay(); }
      let blink = 1;
      if (blinkStart >= 0) { const d = (now - blinkStart) / 0.2; if (d >= 1) blinkStart = -1; else blink = Math.abs(d * 2 - 1); }
      const lf = s === 'speaking' ? lip.step(now) : null;
      if (lf && lf.source !== 'none') { // amplitude or text-timed lip-sync (already attack/release smoothed)
        mouth = lf.mouth; round += ((lf.round && lf.mouth > 0.2 ? 1 : 0) - round) * 0.35;
      } else {
        round += (0 - round) * 0.35;
      if (s === 'speaking') {
        if (now > nextTarget) { target = 0.15 + Math.random() * 0.85; nextTarget = now + 0.08 + Math.random() * 0.08; }
        if (pulseRef.current !== lastPulse.current) { lastPulse.current = pulseRef.current; target = 1; } // word-boundary beat
      } else target = 0;
      mouth += (target - mouth) * 0.5;
      }

      let pose = expression(s, now, toneRef.current);
      if (s === 'speaking' && neutralRef.current) { pose.smile *= 0.6; pose.brow *= 0.5; pose.blush *= 0.6; } // plain information: a calmer face
      // idle micro-movements: slow gaze drift, tiny head sway, breathing lift of the head (never on the 'thinking' look)
      if (s !== 'thinking') { pose.lookX += Math.sin(now * 0.37) * 0.5 + Math.sin(now * 0.91) * 0.2; pose.lookY += Math.sin(now * 0.29) * 0.3; }
      pose.tilt += Math.sin(now * 0.45) * 0.7; pose.nod += Math.sin(now * 1.3) * 0.25;
      // reaction to what the user just said (fades out as soon as she starts speaking)
      const r = reactRef.current;
      if (r) {
        const dt = now - r.start;
        if (dt > REACTION_SECONDS) reactRef.current = null;
        else if (s !== 'speaking') {
          const env = dt < 0.25 ? dt / 0.25 : dt < REACTION_SECONDS - 0.6 ? 1 : (REACTION_SECONDS - dt) / 0.6;
          pose = blend(pose, reactionPose(r.type, dt), Math.max(0, Math.min(1, env)));
        }
      }
      // small nods while the user is talking
      if (s === 'listening') { const nd = now - nodStart.current; if (nd < 0.4) pose.nod += Math.sin((nd / 0.4) * Math.PI) * 2.6; }

      const cur = (curRef.current ??= { ...pose });
      for (const k of POSE_KEYS) cur[k] += (pose[k] - cur[k]) * (k === 'nod' ? 0.55 : 0.28); // ~0.2 s ease, so expressions glide instead of snapping
      setF({
        breathe: (Math.sin(now * 1.3) + 1) / 2, blink, mouth, round, ring: s === 'listening' ? (now % 1.4) / 1.4 : 0,
        twinkle: (Math.sin(now * 0.8) + 1) / 2, ...cur,
      });
    }, 50);
    return () => clearInterval(id);
  }, [reduced, state, tone, reaction, lip]);
  return f;
}

/**
 * Animated portrait of the AI companion: an original illustrated princess character (see AvatarArt).
 * It is an illustration, not a real person. It never looks at the user's face; reactions come from the words the user
 * said or typed (see utils/reaction). Mouth movement is a lip-sync ANIMATION, not phoneme-accurate: amplitude-driven when audio
 * energy is supplied, else timed from the spoken text (utils/lipsync), else a randomised cycle plus word-boundary beats.
 *
 * Optional props (all backwards compatible; CallScreen may pass them later):
 *  - speechText?: string       the reply being spoken. Starts text-timed syllable movement when state becomes 'speaking'.
 *  - speechEnergy?: number     0..1 audio level of the AI voice, pushed whenever it changes. Takes priority over speechText while fresh (<250 ms).
 *  - amplitudeSource?: (push: (v: number) => void) => () => void   subscribe-style alternative to speechEnergy; returns an unsubscribe.
 *  - replyTone?: 'warm' | 'concerned' | 'encouraging' | 'neutral'  from replyToneFor(reply). Overrides `tone` when given
 *                              (encouraging -> cheerful face, neutral -> calm, reduced smile). Crisis wording => 'concerned', never a smile.
 * Reduced motion: no animation loop at all (still pose per state), so none of the above moves the face.
 */
export function Avatar({ state, size = 200, pulse = 0, variant = 'portrait', width, height, reaction = null, tone = 'warm', listenPulse = 0, speechText, speechEnergy, amplitudeSource, replyTone }: {
  state: AvatarState; size?: number; pulse?: number; variant?: 'portrait' | 'frame'; width?: number; height?: number;
  reaction?: ReactionEvent | null; tone?: AvatarTone; listenPulse?: number;
  speechText?: string; speechEnergy?: number; amplitudeSource?: (push: (v: number) => void) => () => void; replyTone?: ReplyTone;
}) {
  const { isDark } = useTheme();
  const t = useT();
  const reduced = useSettings((s) => s.reducedMotion);
  const lip = useRef(createLipSync()).current;
  const effTone: AvatarTone = replyTone ? (replyTone === 'concerned' ? 'concerned' : replyTone === 'encouraging' ? 'cheerful' : 'warm') : tone;
  useEffect(() => { if (state === 'speaking' && speechText) lip.speakText(speechText, Date.now() / 1000); else if (state !== 'speaking') lip.reset(); }, [state, speechText, lip]);
  useEffect(() => { if (speechEnergy !== undefined) lip.pushEnergy(speechEnergy, Date.now() / 1000); }, [speechEnergy, lip]);
  useEffect(() => (amplitudeSource ? amplitudeSource((v) => lip.pushEnergy(v, Date.now() / 1000)) : undefined), [amplitudeSource, lip]);
  const f = useFrame(state, reduced, pulse, reaction, effTone, listenPulse, lip, replyTone === 'neutral');
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const label = { idle: 'avatarIdle', listening: 'avatarListening', thinking: 'avatarThinking', speaking: 'avatarSpeaking', error: 'avatarError' }[state] as
    'avatarIdle' | 'avatarListening' | 'avatarThinking' | 'avatarSpeaking' | 'avatarError';
  const colors = variant === 'frame'
    ? { plateA: '#4B86BD', plateB: '#16355E', ring: '#CDEBFF', danger: '#FF8A80' }
    : isDark ? { plateA: '#2C4A6E', plateB: '#192C47', ring: '#9ED6F2', danger: '#FF8A80' } : { plateA: '#EAF5FF', plateB: '#B7D5F0', ring: '#2F8FB8', danger: '#B3261E' };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${t('avatarNote')} ${t(label)}`} style={{ width: width ?? size, height: height ?? size * 1.1 }}>
      <AvatarArt f={f} state={state} uid={uid} variant={variant} width={width ?? size} height={height ?? size * 1.1} colors={colors} />
    </View>
  );
}
