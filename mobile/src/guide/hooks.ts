import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useG } from '../i18n/guideT';
import { useSettings } from '../store/settings';
import { speak, stopSpeaking } from '../utils/speech';
import { consentGuideId, type ReactionKind } from './guideContent';
import { isQuietNow, suggestNever, useGuide, type SuppressReason } from './guideEngine';

/**
 * Screens call this on focus to trigger their one-time intro (or a one-step "What is new" when the feature changed).
 * `enabled:false` waits (e.g. until data has loaded or a consent prompt is visible). Returns `replay` for a custom "What is this?" control.
 * The home screen also offers the first-run tour here, before its own intro.
 */
/** useFocusEffect, but tolerant of a missing navigation context (isolated component renders): then it behaves like a plain mount effect. */
function useFocusSafe(cb: () => void | (() => void)) {
  try { useFocusEffect(cb); } catch { // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(cb, [cb]);
  }
}

export function useGuideFeature(featureId: string, opts: { enabled?: boolean; delayMs?: number } = {}) {
  const { enabled = true, delayMs = 700 } = opts;
  useFocusSafe(useCallback(() => {
    if (!enabled) return undefined;
    const id = setTimeout(() => {
      const g = useGuide.getState();
      if (featureId === 'home' && g.seen.tour === undefined && g.request('tour', featureId)) return;
      g.request(featureId);
    }, delayMs);
    return () => { clearTimeout(id); useGuide.getState().leave(featureId); };
  }, [featureId, enabled, delayMs]));
  return { replay: useCallback(() => useGuide.getState().replay(featureId), [featureId]) };
}

/** Explains a consent prompt in one line while it is visible. Pass the prompt's error/consent type; no-op for consents the guide does not cover. */
export function useGuideConsent(consentType: string | null | undefined, visible: boolean) {
  const id = consentGuideId(consentType);
  useGuideFeature(id ?? 'consentJournal', { enabled: !!id && visible, delayMs: 300 });
}

/** First time a feature returns `ai:false`, gently explains that this suggestion is a simple built-in one. `featureKey` is any stable name, e.g. "sleepCoach". */
export function useGuideFallback(featureKey: string, ai: boolean | undefined) {
  useEffect(() => {
    if (ai === false) useGuide.getState().requestFallback(featureKey);
    return () => useGuide.getState().leave('fallback');
  }, [featureKey, ai]);
}

/** Registers a busy/safety state with the guide while `active` is true: 'risk' (crisis resources shown), 'call', 'recording', 'exercise', 'emergency'. */
export function useGuideSuppress(reason: SuppressReason, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    useGuide.getState().setSuppressed(reason, true);
    return () => useGuide.getState().setSuppressed(reason, false);
  }, [reason, active]);
}

/** Returns `react(kind, {garden})`; call it only after something was COMPLETED (never on failures or skips). */
export function useGuideReaction() {
  return useCallback((kind: ReactionKind, opts?: { garden?: boolean }) => useGuide.getState().react(kind, opts), []);
}

/**
 * Opt-in read-aloud of a short "why" line. Does nothing unless the user turned on "Read reasons aloud", voice is not muted,
 * and the guide may appear (not off, not quiet, not suppressed). Returns a function plus a stopper.
 */
export function useGuideReadAloud() {
  const lang = useSettings((s) => s.uiLang);
  return useCallback((text: string) => {
    const g = useGuide.getState();
    const muted = useSettings.getState().ttsMuted;
    if (!g.readAloud || muted || g.guideLevel === 'Off' || g.dismissedForever || suggestNever() || isQuietNow() || Object.values(g.suppressed).some((n) => (n ?? 0) > 0)) return false;
    void speak(text, lang, {}).catch(() => {});
    return true;
  }, [lang]);
}
export const stopGuideReadAloud = () => { try { stopSpeaking(); } catch { /* ignore */ } };

// ---- coach-mark targets ----
type ViewNode = React.ComponentRef<typeof View>;
type Ref = React.RefObject<ViewNode | null>;
const targets = new Map<string, Ref>();

/** Attach to the element a guide step points at: `<View ref={useGuideTarget('home.checkin')} collapsable={false}>`. */
export function useGuideTarget(id: string): React.RefObject<ViewNode | null> {
  const ref = useRef<ViewNode>(null);
  useEffect(() => { targets.set(id, ref); return () => { if (targets.get(id) === ref) targets.delete(id); }; }, [id]);
  return ref;
}

export interface Rect { x: number; y: number; width: number; height: number }
/** Measures a registered target in window coordinates; resolves null when it is missing, off-screen or cannot be measured (web, unmounted). */
export function measureTarget(id: string | undefined): Promise<Rect | null> {
  return new Promise((resolve) => {
    const node = id ? targets.get(id)?.current : null;
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), 400);
    try {
      node.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        resolve(width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y) ? { x, y, width, height } : null);
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
}
