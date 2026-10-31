import React from 'react';
import { GuideBubble } from './GuideBubble';
import { GuideSpotlight } from './GuideSpotlight';
import { useGuide } from './guideEngine';

/**
 * First-run "meet Nivora" (4 steps: who I am, where things are, how to get help fast, how to change or silence me). Fully skippable.
 * It is an ordinary guide moment with featureId "tour"; GuideHost renders it. Offered once, from useGuideFeature("home").
 * This component exists for tests and for any screen that wants to embed the tour directly.
 */
export function GuideTour() {
  const m = useGuide((s) => s.current);
  const { next, skip, dismissForever } = useGuide.getState();
  if (!m || m.featureId !== 'tour') return null;
  return <GuideSpotlight><GuideBubble moment={m} onNext={next} onSkip={skip} onHide={dismissForever} /></GuideSpotlight>;
}
