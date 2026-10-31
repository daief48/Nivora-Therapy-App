import React, { useEffect, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from '../motion';
import { measureTarget, type Rect } from './hooks';

const PAD = 6;
const DIM = 'rgba(20,20,20,0.35)';

/**
 * Coach mark: softly dims the screen around a registered target (see useGuideTarget) and shows `children` (the bubble) above or below it.
 * Falls back to a centred bubble with no cut-out when the target cannot be measured, on web, or under reduced motion.
 * Every dim piece has pointerEvents="none", so it never blocks a touch: the screen stays usable and Skip/Emergency stay tappable.
 */
export function GuideSpotlight({ targetId, children }: { targetId?: string; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const { width: W, height: H } = useWindowDimensions();
  const [rect, setRect] = useState<Rect | null | undefined>(undefined); // undefined = still measuring
  const canPoint = Platform.OS !== 'web' && !reduced && !!targetId;
  useEffect(() => {
    let live = true;
    if (!canPoint) { setRect(null); return undefined; }
    setRect(undefined);
    void measureTarget(targetId).then((r) => { if (live) setRect(r); });
    return () => { live = false; };
  }, [canPoint, targetId]);

  if (rect === undefined) return null; // measuring (a few ms); nothing flashes
  if (!rect) {
    return (
      <View testID="guide-centered" pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 16 }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(20,20,20,0.12)' }} />
        {children}
      </View>
    );
  }
  const hole = { x: Math.max(0, rect.x - PAD), y: Math.max(0, rect.y - PAD), w: rect.width + PAD * 2, h: rect.height + PAD * 2 };
  const below = rect.y + rect.height / 2 < H / 2; // target in the top half: bubble below it
  return (
    <View testID="guide-spot" pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: hole.y, backgroundColor: DIM }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: hole.y + hole.h, bottom: 0, backgroundColor: DIM }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: hole.x, top: hole.y, height: hole.h, backgroundColor: DIM }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: hole.x + hole.w, right: 0, top: hole.y, height: hole.h, backgroundColor: DIM }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: hole.x, top: hole.y, width: Math.min(hole.w, W), height: hole.h, borderRadius: 16, borderWidth: 2, borderColor: '#FFFFFF' }} />
      <View pointerEvents="box-none" style={[{ position: 'absolute', left: 16, right: 16 }, below ? { top: Math.min(hole.y + hole.h + 12, H - 220) } : { bottom: Math.max(H - hole.y + 12, 16) }]}>{children}</View>
    </View>
  );
}
