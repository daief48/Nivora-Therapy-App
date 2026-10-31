import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSettings } from '../store/settings';

/** Last known OS value, shared by every caller so only the very first read has to wait. `null` = not resolved yet. */
let osCache: boolean | null = null;

/**
 * True when the in-app "reduce motion" setting or the OS accessibility setting asks for stillness. Every animation must offer a static fallback.
 * The in-app setting is read synchronously from the store, and the OS answer is cached across mounts so only the very first mount waits for it.
 */
export function useReducedMotion(): boolean {
  const app = useSettings((s) => s.reducedMotion);
  const [os, setOs] = useState<boolean>(osCache ?? false);
  useEffect(() => {
    let live = true;
    const set = (v: boolean) => { osCache = v; if (live) setOs(v); };
    try {
      const p = AccessibilityInfo.isReduceMotionEnabled?.();
      if (p && typeof p.then === 'function') p.then((v) => set(!!v)).catch(() => set(false));
      else set(false);
      const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => set(!!v));
      return () => { live = false; sub?.remove?.(); };
    } catch { set(false); return () => { live = false; }; }
  }, []);
  return app || os;
}

/** Test helper: forget the cached OS value. */
export function resetReducedMotionCacheForTests() { osCache = null; }
