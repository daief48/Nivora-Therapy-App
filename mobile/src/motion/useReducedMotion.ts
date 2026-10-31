import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSettings } from '../store/settings';

/** True when the in-app "reduce motion" setting or the OS accessibility setting asks for stillness. Every animation must offer a static fallback. */
export function useReducedMotion(): boolean {
  const app = useSettings((s) => s.reducedMotion);
  const [os, setOs] = useState(false);
  useEffect(() => {
    let live = true;
    try {
      AccessibilityInfo.isReduceMotionEnabled?.()?.then((v) => { if (live) setOs(!!v); }).catch(() => {});
      const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setOs(!!v));
      return () => { live = false; sub?.remove?.(); };
    } catch { return () => { live = false; }; }
  }, []);
  return app || os;
}
