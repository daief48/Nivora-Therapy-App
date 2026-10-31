import { useGuideFeature, useGuideRiskSignal, useGuideSuppress } from '../guide';
import { useNavigation } from '@react-navigation/native';
import { useOptionalQueryClient } from '../api/optionalClient';
import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import type { AiSettings } from '../api/aiSettings';
import { dismissNudge, useTodayFeed, type FeedNudge, type FeedNudgeType, type InsightKind, type TodayFeed as Feed } from '../api/today';
import { useFeedT } from '../i18n/feedT';
import { useTH, type THKey } from '../i18n/th';
import { FadeInUp, successHaptic, tapHaptic, useReducedMotion } from '../motion';
import type { Nav } from '../navigation/types';
import { useTheme } from '../theme';
import { resolveActionLink } from '../utils/actionLink';
import { ActionCard } from './ActionCard';
import { AppText, Button, Card, IconCircle, Row, type IconName } from './ui';

type Cta = 'sleep_routine' | 'checkin' | 'weekly_review' | 'plan';
const CTA_LABEL: Record<Cta, THKey> = { sleep_routine: 'thCtaSleep', checkin: 'thCtaCheckin', weekly_review: 'thCtaReview', plan: 'thCtaPlan' };
const NUDGE_ICON: Record<FeedNudgeType, IconName> = { WIND_DOWN: 'moon-outline', MOOD_CHECKIN: 'happy-outline', WEEKLY_REVIEW: 'stats-chart-outline', MORNING_PLAN: 'sunny-outline', SESSION_INVITE: 'chatbubbles-outline' };
const INSIGHT_ICON: Record<InsightKind, IconName> = { KAIZEN_WEEK: 'leaf-outline', SLEEP_TREND: 'bed-outline', MOOD_WEEK: 'happy-outline', WEEKLY_SUMMARY: 'document-text-outline' };
const INSIGHT_TAB: Record<InsightKind, { tab: string; label: THKey }> = {
  KAIZEN_WEEK: { tab: 'KaizenTab', label: 'thCtaKaizen' },
  SLEEP_TREND: { tab: 'SleepTab', label: 'thCtaSleepTab' },
  MOOD_WEEK: { tab: 'InsightsTab', label: 'thCtaReview' },
  WEEKLY_SUMMARY: { tab: 'InsightsTab', label: 'thCtaReview' },
};

/** Maps a server CTA to an existing screen. Unknown CTAs are ignored rather than crashing. */
export function goCta(nav: Nav, cta: string, now = new Date()): void {
  switch (cta) {
    case 'sleep_routine': nav.navigate('Routine'); break;
    case 'checkin': nav.navigate('CheckIn', { kind: now.getHours() < 14 ? 'MORNING' : 'EVENING' }); break;
    case 'weekly_review': nav.navigate('Tabs', { screen: 'InsightsTab' } as never); break;
    case 'plan': nav.navigate('Plan'); break;
    default: break;
  }
}

const THRESHOLD = 90;

/** A card that can be set aside with a horizontal swipe (or the visible "Not now" button, for everyone who does not swipe). */
export function SwipeCard({ children, onDismiss, hint }: { children: React.ReactNode; onDismiss: () => void; hint: string }) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const gone = useRef(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const finish = (dir: number) => {
    if (gone.current) return;
    gone.current = true;
    successHaptic();
    if (reduced) { dismiss.current(); return; }
    Animated.timing(x, { toValue: dir * 420, duration: 200, useNativeDriver: true }).start(() => dismiss.current());
  };
  const back = () => { if (reduced) x.setValue(0); else Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(); }; // no spring-back animation under reduced motion
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_e, g) => x.setValue(g.dx),
    onPanResponderRelease: (_e, g) => {
      if (Math.abs(g.dx) > THRESHOLD || Math.abs(g.vx) > 1.2) finish(g.dx < 0 ? -1 : 1);
      else back();
    },
    onPanResponderTerminate: () => back(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [reduced]);
  const opacity = x.interpolate({ inputRange: [-240, 0, 240], outputRange: [0.2, 1, 0.2], extrapolate: 'clamp' });
  // Not made `accessible`: on iOS that would fold the card's own buttons into one element. Screen-reader users dismiss with the visible "Not now" button.
  return (
    <Animated.View {...pan.panHandlers} accessibilityHint={hint} style={{ transform: [{ translateX: x }], opacity }} testID="swipe-card"
      accessibilityActions={[{ name: 'dismiss', label: hint }]} onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'dismiss') finish(1); }}>
      {children}
    </Animated.View>
  );
}

const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

/** The "why am I seeing this" line: short, plain, no numbers (the server writes and localizes it). */
function WhyLine({ reason }: { reason?: string | null }) {
  const f = useFeedT();
  if (!reason) return null;
  return <AppText size={12} muted accessibilityLabel={f('fdWhyA11y', { reason })} testID="why-line">{reason}</AppText>;
}

/** Order used when the server sends none (older response shape): plan, nudges, suggestions, insights. */
function defaultOrder(feed: Feed): string[] {
  return ['plan', ...feed.nudges.map((n) => `nudge:${n.type}`), ...feed.suggestions.map((s) => `suggestion:${s.id}`), ...feed.insights.map((i) => `insight:${i.kind}`)];
}

/**
 * The in-app "Today" feed: cards in the server's order (a light day puts gentle ones first). Pull-based, calm, always dismissible.
 * In risk mode only the support options are shown: no plan, no task, no insight.
 */
export function TodayFeed({ feed: injected }: { feed?: Feed }) {
  const th = useTH();
  const f = useFeedT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const q = useTodayFeed();
  const qc = useOptionalQueryClient();
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const feed = injected ?? q.data;
  useGuideSuppress('risk', !!feed?.riskMode);
  useGuideRiskSignal('today', !!feed?.riskMode, true);
  useGuideFeature('invite', { enabled: !feed?.riskMode && !!feed?.nudges?.some((n) => n.type === 'SESSION_INVITE' && n.variant !== 'SUPPORT') });
  useGuideFeature('why', { enabled: !feed?.riskMode && !!(feed?.plan?.reason || feed?.nudges?.some((n) => n.reason) || feed?.insights?.some((i) => i.reason)), delayMs: 1500 });
  const hide = (key: string) => setGone((g) => ({ ...g, [key]: true }));

  const setAsideNudge = (type: FeedNudgeType) => {
    hide(`n:${type}`);
    dismissNudge(type).then(() => setNote(''), () => setNote(th('thDismissFailed')));
  };

  if (!feed) {
    return q.isError ? <AppText size={13} muted accessibilityRole="alert">{th('thFeedError')}</AppText> : null;
  }
  const risk = !!feed.riskMode;
  const snoozed = feed.snoozedUntil && new Date(feed.snoozedUntil).getTime() > Date.now() ? feed.snoozedUntil : null;
  // Quiet hours, an active snooze or suggestion level NEVER: nothing task-like or advisory, only a quiet line. Support (risk) stays.
  const never = qc?.getQueryData<AiSettings>(['ai-settings'])?.suggestionLevel === 'NEVER';
  const resting = !risk && (!!feed.quietNow || !!snoozed || never || !!feed.resting);
  const nudges = (feed.nudges ?? []).filter((n) => !gone[`n:${n.type}`] && (!risk || n.type === 'SESSION_INVITE') && (!resting || n.variant === 'SUPPORT'));
  const insights = risk || resting ? [] : (feed.insights ?? []).filter((i) => !gone[`i:${i.kind}`]);
  const plan = !risk && !resting && feed.plan && !gone.plan ? feed.plan : null;
  const suggestions = (feed.suggestions ?? []).filter((s) => (!risk && !resting) || s.crisis);
  const hint = th('thSwipeHint');
  let step = 0;
  const delay = () => Math.min(step++, 6) * 70;
  const notNow = (onPress: () => void, label?: string | null) => <Button title={label || th('thDismiss')} variant="ghost" accessibilityLabel={th('thDismissA11y')} onPress={() => { tapHaptic(); onPress(); }} />;

  const planCard = plan ? (
    <FadeInUp key="plan" delay={delay()}>
      <SwipeCard onDismiss={() => hide('plan')} hint={hint}>
        <Card style={{ gap: 8 }}>
          <Row style={{ gap: 12 }}>
            <IconCircle icon="calendar-outline" tone={1} size={44} />
            <View style={{ flex: 1 }}>
              <AppText weight="800" size={16}>{th('thPlanTitle')}</AppText>
              <AppText size={14}>{plan.focus ? th('thPlanFocus', { focus: plan.focus }) : th('thPlanNoFocus')}</AppText>
            </View>
          </Row>
          <AppText size={13} muted>{th('thPlanBed', { windDown: plan.windDownAt, bedtime: plan.tonightBedtime })}</AppText>
          <WhyLine reason={plan.reason} />
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={th('thCtaPlan')} variant="secondary" onPress={() => goCta(nav, 'plan')} />
            {notNow(() => hide('plan'))}
          </Row>
        </Card>
      </SwipeCard>
    </FadeInUp>
  ) : null;

  const nudgeCard = (n: FeedNudge) => {
    if (n.type === 'SESSION_INVITE' && n.variant === 'SUPPORT') {
      // Support is never swiped away and has no session button: Emergency, Safety plan and a trusted person stay in view.
      return (
        <FadeInUp key={`nudge:${n.type}`} delay={delay()}>
          <View testID="support-card"><Card tone="lavender" style={{ gap: 10 }}>
            <Row style={{ gap: 12 }}>
              <IconCircle icon="heart-outline" tone={0} size={44} />
              <View style={{ flex: 1 }}>
                <AppText weight="800" size={16} accessibilityRole="header">{n.title}</AppText>
                <AppText size={14}>{n.body}</AppText>
              </View>
            </Row>
            <WhyLine reason={n.reason} />
            {(n.options ?? []).map((o) => <ActionCard key={o.id} card={o} />)}
          </Card></View>
        </FadeInUp>
      );
    }
    const invite = n.type === 'SESSION_INVITE';
    const primary = invite ? n.primary : null;
    return (
      <FadeInUp key={`nudge:${n.type}`} delay={delay()}>
        <SwipeCard onDismiss={() => setAsideNudge(n.type)} hint={hint}>
          <Card tone="lavender" style={{ gap: 8 }}>
            <Row style={{ gap: 12 }}>
              <IconCircle icon={NUDGE_ICON[n.type] ?? 'leaf-outline'} tone={0} size={44} />
              <View style={{ flex: 1 }}>
                <AppText weight="800" size={16}>{n.title}</AppText>
                <AppText size={14}>{n.body}</AppText>
              </View>
            </Row>
            <WhyLine reason={n.reason} />
            <Row style={{ flexWrap: 'wrap' }}>
              {invite ? (primary?.label ? <Button title={primary.label} onPress={() => resolveActionLink(nav, primary.deepLink)} /> : null)
                : CTA_LABEL[n.cta as Cta] ? <Button title={th(CTA_LABEL[n.cta as Cta])} onPress={() => goCta(nav, n.cta)} /> : null}
              {notNow(() => setAsideNudge(n.type), invite ? n.notNowLabel : null)}
            </Row>
          </Card>
        </SwipeCard>
      </FadeInUp>
    );
  };

  const insightCard = (i: Feed['insights'][number]) => (
    <FadeInUp key={`insight:${i.kind}`} delay={delay()}>
      <SwipeCard onDismiss={() => hide(`i:${i.kind}`)} hint={hint}>
        <Card style={{ gap: 8 }}>
          <Row style={{ gap: 12 }}>
            <IconCircle icon={INSIGHT_ICON[i.kind] ?? 'sparkles-outline'} tone={2} size={44} />
            <View style={{ flex: 1 }}>
              <AppText weight="800" size={16}>{i.title}</AppText>
              <AppText size={14}>{i.body}</AppText>
            </View>
          </Row>
          <WhyLine reason={i.reason} />
          <Row style={{ flexWrap: 'wrap' }}>
            {INSIGHT_TAB[i.kind] ? <Button title={th(INSIGHT_TAB[i.kind].label)} variant="secondary" onPress={() => nav.navigate('Tabs', { screen: INSIGHT_TAB[i.kind].tab } as never)} /> : null}
            {notNow(() => hide(`i:${i.kind}`))}
          </Row>
        </Card>
      </SwipeCard>
    </FadeInUp>
  );

  // Cards keyed like the server's `order`; keys it does not mention are appended so nothing is lost.
  const nodes: Record<string, React.ReactNode> = {};
  if (planCard) nodes.plan = planCard;
  for (const n of nudges) nodes[`nudge:${n.type}`] = nudgeCard(n);
  for (const s of suggestions) nodes[`suggestion:${s.id}`] = <ActionCard key={`suggestion:${s.id}`} card={s} compact />;
  for (const i of insights) nodes[`insight:${i.kind}`] = insightCard(i);
  const wanted = feed.order?.length ? feed.order : defaultOrder(feed);
  const keys = [...wanted, ...Object.keys(nodes).filter((k) => !wanted.includes(k))].filter((k, i, all) => nodes[k] && all.indexOf(k) === i);
  const supportShown = nudges.some((n) => n.variant === 'SUPPORT') || suggestions.length > 0;

  return (
    <View style={{ gap: 12 }} testID="today-feed">
      <View>
        <AppText size={20} weight="800" accessibilityRole="header">{th('thTodayTitle')}</AppText>
        <AppText size={13} muted>{th('thTodaySub')}</AppText>
        {feed.lightDay && !risk ? <AppText size={12} muted testID="light-day">{f('fdLightDay')}</AppText> : null}
        {risk && supportShown ? <AppText size={13} muted>{f('fdSupportIntro')}</AppText> : null}
      </View>

      {keys.map((k) => nodes[k])}

      {!nudges.length && resting ? (
        <AppText size={13} muted style={{ color: c.textMuted }}>{snoozed ? th('thSnoozedUntil', { time: fmtTime(snoozed) }) : feed.quietNow ? th('thQuietNow') : th('thRestingNow')}</AppText>
      ) : null}
      {note ? <AppText size={12} muted accessibilityRole="alert">{note}</AppText> : null}
    </View>
  );
}
