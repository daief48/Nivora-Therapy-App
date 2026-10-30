import React, { useEffect, useId, useRef, useState } from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';
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
const POSE_KEYS: (keyof Pose)[] = ['smile', 'brow', 'lookX', 'lookY', 'tilt', 'nod', 'joy', 'blush', 'mouthO', 'wide', 'sparkle'];

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
function useFrame(state: AvatarState, reduced: boolean, pulse: number, reaction: ReactionEvent | null, tone: AvatarTone, listenPulse: number): Frame {
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
    let mouth = 0, target = 0, nextTarget = 0, nextBlink = Date.now() / 1000 + 2.5, blinkStart = -1;
    const id = setInterval(() => {
      const now = Date.now() / 1000;
      const s = stateRef.current;
      if (blinkStart < 0 && now > nextBlink) { blinkStart = now; nextBlink = now + 2.5 + Math.random() * 3.5; }
      let blink = 1;
      if (blinkStart >= 0) { const d = (now - blinkStart) / 0.2; if (d >= 1) blinkStart = -1; else blink = Math.abs(d * 2 - 1); }
      if (s === 'speaking') {
        if (now > nextTarget) { target = 0.15 + Math.random() * 0.85; nextTarget = now + 0.08 + Math.random() * 0.08; }
        if (pulseRef.current !== lastPulse.current) { lastPulse.current = pulseRef.current; target = 1; } // word-boundary beat
      } else target = 0;
      mouth += (target - mouth) * 0.5;

      let pose = expression(s, now, toneRef.current);
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
        breathe: (Math.sin(now * 1.1) + 1) / 2, blink, mouth, ring: s === 'listening' ? (now % 1.4) / 1.4 : 0,
        twinkle: (Math.sin(now * 0.8) + 1) / 2, ...cur,
      });
    }, 50);
    return () => clearInterval(id);
  }, [reduced, state, tone, reaction]);
  return f;
}

/**
 * Animated portrait of the AI companion: an original illustrated princess character (see AvatarArt).
 * It is an illustration, not a real person. It never looks at the user's face; reactions come from the words the user
 * said or typed (see utils/reaction). Mouth movement is basic: a randomised open/close cycle plus a beat on each word
 * boundary the TTS engine reports, not phoneme-accurate lip-sync.
 */
export function Avatar({ state, size = 200, pulse = 0, variant = 'portrait', width, height, reaction = null, tone = 'warm', listenPulse = 0 }: {
  state: AvatarState; size?: number; pulse?: number; variant?: 'portrait' | 'frame'; width?: number; height?: number;
  reaction?: ReactionEvent | null; tone?: AvatarTone; listenPulse?: number;
}) {
  const { isDark } = useTheme();
  const t = useT();
  const reduced = useSettings((s) => s.reducedMotion);
  const f = useFrame(state, reduced, pulse, reaction, tone, listenPulse);
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
