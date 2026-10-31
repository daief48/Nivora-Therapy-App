import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useSettings } from '../store/settings';
import { track } from '../utils/analytics';
import { getFeature, REACTION_TEXT, type GuideStep, type ReactionKind } from './guideContent';
import type { GKey } from '../i18n/guideT';

/**
 * Nivora Guide engine: rule-based, no model call. Decides WHEN a tip may appear; the content lives in guideContent.
 * Hard rules: never while a safety/call/recording/exercise reason is active, never in quiet mode, at most 1 moment per app session and 2 per day,
 * a feature intro at most once (replay on tap is always allowed, except under a safety suppression).
 */
export type GuideLevel = 'Full' | 'Hints' | 'Off';
/** Why the guide must stay hidden. 'risk' = crisis resources / risk signals shown; the others are busy states reported by screens via useGuideSuppress. */
export type SuppressReason = 'risk' | 'call' | 'recording' | 'exercise' | 'emergency';
export type MomentKind = 'intro' | 'whatsnew' | 'replay' | 'tour';

export interface Moment { featureId: string; kind: MomentKind; step: number; /** screen that asked for it; leaving that screen closes the moment */ owner: string }
export interface ReactionMoment { key: number; textKey: GKey; garden: boolean }

export const DAILY_CAP = 2;
export const SESSION_CAP = 1;
export const REACTIONS_PER_DAY = 3;

export interface GuideState {
  // persisted
  seen: Record<string, number>;
  fallbackSeen: Record<string, boolean>;
  dismissedForever: boolean;
  lastShownAt: number;
  snoozedUntil: number;
  guideLevel: GuideLevel;
  day: string;
  shownToday: number;
  reactionsToday: number;
  readAloud: boolean;
  /** Mirror of the server's AI suggestion level (OFTEN|SOMETIMES|RARELY|NEVER); SOMETIMES until loaded. */
  suggestionLevel: string;
  // runtime only
  current: Moment | null;
  reaction: ReactionMoment | null;
  sessionShown: number;
  suppressed: Partial<Record<SuppressReason, number>>;
  // actions
  request: (featureId: string, owner?: string) => boolean;
  requestFallback: (featureKey: string, owner?: string) => boolean;
  replay: (featureId: string, owner?: string) => boolean;
  next: () => void;
  skip: () => void;
  dismissForever: () => void;
  snooze: (ms: number) => void;
  leave: (owner: string) => void;
  setLevel: (l: GuideLevel) => void;
  setReadAloud: (on: boolean) => void;
  setSuggestionLevel: (level: string) => void;
  resetTips: () => void;
  setSuppressed: (reason: SuppressReason, on: boolean) => void;
  react: (kind: ReactionKind, opts?: { garden?: boolean }) => boolean;
  clearReaction: () => void;
}

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const minutesOfDay = (t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const inQuiet = (m: number, start: number, end: number) => (start === end ? false : start < end ? m >= start && m < end : m >= start || m < end);

/** True while the user's quiet hours are on and now is inside them. */
export function isQuietNow(now = Date.now()): boolean {
  const s = useSettings.getState();
  return !!s.quietOn && inQuiet(minutesOfDay(now), s.quietStart, s.quietEnd);
}
/**
 * "How much should Nivora suggest?" = Never. The setting is added by another agent; its field name is not final, so we read the likely ones.
 * With Never the guide never appears on its own (only on a tap of the "What is this?" chip).
 */
export function suggestNever(): boolean {
  const v = useGuide.getState().suggestionLevel;
  return typeof v === 'string' && v.toLowerCase() === 'never';
}

const isSuppressed = (s: Pick<GuideState, 'suppressed'>) => Object.values(s.suppressed).some((n) => (n ?? 0) > 0);

/** Pure-ish gate for an automatic (not tap-triggered) moment. */
export function autoAllowed(s: GuideState, opts: { contextual?: boolean; kind: MomentKind }, now = Date.now()): boolean {
  if (isSuppressed(s) || s.current) return false;
  if (s.guideLevel === 'Off' || s.dismissedForever) return false;
  if (s.guideLevel === 'Hints' && !opts.contextual && opts.kind !== 'whatsnew') return false;
  if (suggestNever() || isQuietNow(now) || s.snoozedUntil > now) return false;
  if (opts.kind === 'tour') return true; // the first-run welcome is exempt from the caps (still obeys everything above)
  const today = s.day === dayKey(now) ? s.shownToday : 0;
  return today < DAILY_CAP && s.sessionShown < SESSION_CAP;
}

export function momentSteps(m: Moment): GuideStep[] {
  const f = getFeature(m.featureId);
  if (!f) return [];
  if (m.kind === 'whatsnew' && f.whatsNewKey) return [{ textKey: f.whatsNewKey, mood: 'warm' }];
  return f.steps;
}

// AsyncStorage that never throws: a failed read/write must not crash the app, it only means tips are not remembered.
const safeStorage = {
  getItem: async (k: string) => { try { return await AsyncStorage.getItem(k); } catch { return null; } },
  setItem: async (k: string, v: string) => { try { await AsyncStorage.setItem(k, v); } catch { /* ignore */ } },
  removeItem: async (k: string) => { try { await AsyncStorage.removeItem(k); } catch { /* ignore */ } },
};

let reactionKey = 0;

export const useGuide = create<GuideState>()(
  persist(
    (set, get) => {
      const noteShown = (featureId: string, kind: MomentKind, counted: boolean, now: number) => {
        const s = get();
        const today = dayKey(now);
        set(counted ? { lastShownAt: now, day: today, reactionsToday: s.day === today ? s.reactionsToday : 0, shownToday: (s.day === today ? s.shownToday : 0) + 1, sessionShown: s.sessionShown + (kind === 'tour' ? 0 : 1) } : { lastShownAt: now });
        track('guide_shown', { featureId });
      };
      const close = (event: 'guide_skipped' | 'guide_completed') => {
        const c = get().current;
        if (!c) return;
        set({ current: null });
        track(event, { featureId: c.featureId });
      };
      return {
        seen: {}, fallbackSeen: {}, dismissedForever: false, lastShownAt: 0, snoozedUntil: 0, guideLevel: 'Full', day: '', shownToday: 0, reactionsToday: 0, readAloud: false, suggestionLevel: 'SOMETIMES',
        current: null, reaction: null, sessionShown: 0, suppressed: {},

        request: (featureId, owner = featureId) => {
          const f = getFeature(featureId);
          const s = get();
          if (!f) return false;
          const v = s.seen[featureId];
          const kind: MomentKind = featureId === 'tour' ? 'tour' : v === undefined ? 'intro' : v < f.version && f.whatsNewKey ? 'whatsnew' : 'intro';
          if (v !== undefined && !(kind === 'whatsnew')) return false; // already seen this version
          if (!autoAllowed(s, { contextual: f.contextual, kind })) return false;
          const now = Date.now();
          set({ current: { featureId, kind, step: 0, owner }, seen: { ...s.seen, [featureId]: f.version }, reaction: null });
          noteShown(featureId, kind, true, now);
          return true;
        },
        requestFallback: (featureKey, owner = 'fallback') => {
          const s = get();
          if (s.fallbackSeen[featureKey] || !autoAllowed(s, { contextual: true, kind: 'intro' })) return false;
          const now = Date.now();
          set({ current: { featureId: 'fallback', kind: 'intro', step: 0, owner }, fallbackSeen: { ...s.fallbackSeen, [featureKey]: true }, reaction: null });
          noteShown('fallback', 'intro', true, now);
          return true;
        },
        // A tap on the "What is this?" chip or "Replay the tour": always allowed, except under a safety/busy suppression. Does not count toward caps.
        replay: (featureId, owner = featureId) => {
          const s = get();
          if (!getFeature(featureId) || isSuppressed(s)) return false;
          set({ current: { featureId, kind: featureId === 'tour' ? 'tour' : 'replay', step: 0, owner }, reaction: null });
          noteShown(featureId, 'replay', false, Date.now());
          return true;
        },
        next: () => {
          const c = get().current;
          if (!c) return;
          if (c.step + 1 < momentSteps(c).length) set({ current: { ...c, step: c.step + 1 } });
          else close('guide_completed');
        },
        skip: () => close('guide_skipped'),
        dismissForever: () => { close('guide_skipped'); set({ dismissedForever: true, guideLevel: 'Off', reaction: null }); },
        snooze: (ms) => { close('guide_skipped'); set({ snoozedUntil: Date.now() + ms }); },
        leave: (owner) => { const c = get().current; if (c && c.owner === owner) set({ current: null }); },
        setLevel: (guideLevel) => set({ guideLevel, dismissedForever: false, ...(guideLevel === 'Off' ? { current: null, reaction: null } : {}) }),
        setReadAloud: (readAloud) => set({ readAloud }),
        setSuggestionLevel: (suggestionLevel) => set({ suggestionLevel }),
        resetTips: () => set({ seen: {}, fallbackSeen: {}, dismissedForever: false, snoozedUntil: 0, shownToday: 0, reactionsToday: 0, day: '', sessionShown: 0, guideLevel: get().guideLevel === 'Off' ? 'Full' : get().guideLevel }),
        setSuppressed: (reason, on) => {
          const s = get();
          const n = Math.max(0, (s.suppressed[reason] ?? 0) + (on ? 1 : -1));
          set({ suppressed: { ...s.suppressed, [reason]: n }, ...(on ? { current: null, reaction: null } : {}) }); // a busy/crisis state closes whatever is showing
        },
        // A tiny, optional reaction after something was COMPLETED. Callers only invoke it on success, so it never appears for failures or skipped days.
        react: (kind, opts) => {
          const s = get();
          const now = Date.now();
          if (isSuppressed(s) || s.current || s.guideLevel === 'Off' || s.dismissedForever || suggestNever() || isQuietNow(now)) return false;
          const today = dayKey(now);
          const n = s.day === today ? s.reactionsToday : 0;
          if (n >= REACTIONS_PER_DAY) return false;
          set({ reaction: { key: ++reactionKey, textKey: opts?.garden ? 'gReactGarden' : REACTION_TEXT[kind], garden: !!opts?.garden }, reactionsToday: n + 1, day: today, shownToday: s.day === today ? s.shownToday : 0 });
          return true;
        },
        clearReaction: () => set({ reaction: null }),
      };
    },
    {
      name: 'guide-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ seen: s.seen, fallbackSeen: s.fallbackSeen, dismissedForever: s.dismissedForever, lastShownAt: s.lastShownAt, snoozedUntil: s.snoozedUntil, guideLevel: s.guideLevel, suggestionLevel: s.suggestionLevel, day: s.day, shownToday: s.shownToday, reactionsToday: s.reactionsToday, readAloud: s.readAloud }),
    },
  ),
);

/** Test helper: clears runtime state and optionally persisted state. */
export function resetGuideForTests(patch: Partial<GuideState> = {}) {
  useGuide.setState({ seen: {}, fallbackSeen: {}, dismissedForever: false, lastShownAt: 0, snoozedUntil: 0, guideLevel: 'Full', day: '', shownToday: 0, reactionsToday: 0, readAloud: false, suggestionLevel: 'SOMETIMES', current: null, reaction: null, sessionShown: 0, suppressed: {}, ...patch });
}
