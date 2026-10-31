import React, { useCallback, useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useG } from '../i18n/guideT';
import { PressScale } from '../motion';
import { radius, useTheme } from '../theme';
import { GuideBubble } from './GuideBubble';
import { GuideReaction } from './GuideReaction';
import { GuideSpotlight } from './GuideSpotlight';
import { getFeature } from './guideContent';
import { momentSteps, useGuide } from './guideEngine';

/** Routes where the guide never appears: crisis, calls, and the sign-in/onboarding flow. */
export const GUIDE_BLOCKED_ROUTES = ['Emergency', 'SafetyPlan', 'Call', 'Welcome', 'SignUp', 'SignIn', 'Forgot'];

/**
 * Mount once, as the LAST child inside the navigator container (so it draws above screens). Renders the current guide moment or reaction.
 * - `enabled`: false while signed out / onboarding.
 * - `routeName`: current route name (from navigationRef.getCurrentRoute()?.name); blocked routes hide the guide.
 * - `onNavigate`: opens a tryItRoute; `onEmergency`: opens the Emergency screen. While a moment is showing, the host draws its own
 *   "Emergency help" button above everything so help is never covered by the bubble.
 */
export function GuideHost({ enabled = true, routeName, onNavigate, onEmergency }: {
  enabled?: boolean; routeName?: string; onNavigate?: (name: string, params?: Record<string, unknown>) => void; onEmergency?: () => void;
}) {
  const moment = useGuide((s) => s.current);
  const reaction = useGuide((s) => s.reaction);
  const { next, skip, dismissForever, clearReaction } = useGuide.getState();
  const { c, text } = useTheme();
  const g = useG();
  const insets = useSafeAreaInsets();
  const blocked = !enabled || (!!routeName && GUIDE_BLOCKED_ROUTES.includes(routeName));
  const tryIt = useCallback(() => {
    const m = useGuide.getState().current;
    const route = m ? getFeature(m.featureId)?.tryItRoute : undefined;
    useGuide.getState().skip();
    if (route && onNavigate) onNavigate(route.name, route.params);
  }, [onNavigate]);
  useEffect(() => { useGuide.getState().setHostBlocked(blocked); }, [blocked]);
  useEffect(() => () => useGuide.getState().setHostBlocked(false), []);
  if (blocked || (!moment && !reaction)) return null;
  const steps = moment ? momentSteps(moment) : [];
  const step = moment ? steps[Math.min(moment.step, steps.length - 1)] : undefined;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}>
      {moment ? (
        <GuideSpotlight key={`${moment.featureId}:${moment.step}`} targetId={step?.targetRef}>
          <GuideBubble moment={moment} onNext={next} onSkip={skip} onHide={dismissForever} onTryIt={onNavigate ? tryIt : undefined} />
        </GuideSpotlight>
      ) : reaction ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + (Platform.OS === 'web' ? 16 : 72) }}>
          <GuideReaction key={reaction.key} textKey={reaction.textKey} onDone={clearReaction} />
        </View>
      ) : null}
      {moment && onEmergency ? (
        <PressScale
          accessibilityRole="button" accessibilityLabel={g('gEmergency')} onPress={() => { useGuide.getState().skip(); onEmergency(); }}
          style={{ position: 'absolute', top: Math.max(insets.top, 8) + 4, right: 12, minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: c.danger }}
        >
          <Text style={[text(13, '700'), { color: c.onDanger }]}>{g('gEmergency')}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}
