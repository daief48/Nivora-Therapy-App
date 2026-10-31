import { useGuideFallback, useGuideSuppress } from '../guide';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import React, { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Circle, Ellipse, Rect } from 'react-native-svg';
import type { Correlation, Monthly, PatternView, PracticeBlock } from '../api/monthly';
import { useFeedT } from '../i18n/feedT';
import { useStoryT, type StoryKey } from '../i18n/storyT';
import { AnimatedNumber, FadeInUp, tapHaptic, useReducedMotion } from '../motion';
import { radius, useTheme } from '../theme';
import type { Point } from '../utils/moods';
import { asSeason, CARD, SEASON_PALETTE, shareCardHtml, shareShapes } from '../utils/shareCard';
import { ActionCard } from './ActionCard';
import { AiBadge } from './AiBadge';
import { MoodChart } from './MoodChart';
import { AppText, Button, Card } from './ui';

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** One calm, plain-language sentence for a correlation. Always "tend to", never a cause. */
export function CorrelationLine({ c }: { c: Correlation }) {
  const t = useStoryT();
  const s = c.strength === 'strong' ? t('stCorrClearly') : t('stCorrSlightly');
  const a = t(`stM_${c.a}` as StoryKey), b = t(`stM_${c.b}` as StoryKey);
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const text = c.direction === 'together' ? t('stCorrTogether', { a: cap(a), b, s }) : t('stCorrOpposite', { a, b, s });
  return (
    <View style={{ gap: 2 }}>
      <AppText>{text}</AppText>
      <AppText size={12} muted>{t('stCorrDays', { n: c.n })}</AppText>
    </View>
  );
}

/** The pattern the server built for this correlation (matched by metric pair, either order). */
export const patternFor = (patterns: PatternView[] | undefined, c: Correlation) =>
  (patterns ?? []).find((p) => p.type === 'CORRELATION' && ((p.a === c.a && p.b === c.b) || (p.a === c.b && p.b === c.a)));

/** One optional next step under a pattern. Hidden when the server has none (risk mode, suggestions off) or in risk mode. */
export function PatternStep({ pattern, riskMode }: { pattern?: PatternView; riskMode?: boolean }) {
  const f = useFeedT();
  if (!pattern || riskMode || !pattern.nextStep) return null;
  return (
    <View style={{ gap: 4 }} testID={`pattern-step-${pattern.id}`}>
      {pattern.reason ? <AppText size={12} muted accessibilityLabel={f('fdWhyA11y', { reason: pattern.reason })}>{pattern.reason}</AppText> : null}
      <ActionCard card={pattern.nextStep} compact />
    </View>
  );
}

/** Practice (breathing, grounding, thought records, sounds) as one story card. Counts and the server's line only; no improvement claims. */
export function PracticeCard({ practice }: { practice: PracticeBlock }) {
  const f = useFeedT();
  const rows: [string, number][] = [
    [f('fdPracticeBreathing', { n: practice.counts?.BREATHING ?? 0 }), practice.counts?.BREATHING ?? 0],
    [f('fdPracticeGrounding', { n: practice.counts?.GROUNDING ?? 0 }), practice.counts?.GROUNDING ?? 0],
    [f('fdPracticeThought', { n: practice.counts?.THOUGHT_RECORD ?? 0 }), practice.counts?.THOUGHT_RECORD ?? 0],
    [f('fdPracticeSounds', { n: practice.counts?.SOUNDS ?? 0 }), practice.counts?.SOUNDS ?? 0],
  ];
  return (
    <View style={{ gap: 10 }} testID="practice-card">
      <AppText size={20} weight="800" accessibilityRole="header">{f('fdPracticeTitle')}</AppText>
      {practice.total > 0 ? (
        <>
          {practice.line ? <AppText>{practice.line}</AppText> : null}
          {rows.filter(([, n]) => n > 0).map(([label]) => <AppText key={label} size={14}>{label}</AppText>)}
        </>
      ) : <AppText>{f('fdPracticeNone')}</AppText>}
      <AppText size={12} muted>{f('fdPracticeOwn')}</AppText>
    </View>
  );
}

/** Mood x sleep x Kaizen (and friends) patterns, from the API correlations only; each may carry one optional next step. */
export function CorrelationCard({ correlations, patterns, riskMode }: { correlations: Correlation[]; patterns?: PatternView[]; riskMode?: boolean }) {
  const t = useStoryT();
  return (
    <View style={{ gap: 12 }}>
      <AppText size={20} weight="800" accessibilityRole="header">{t('stCorrTitle')}</AppText>
      <AppText size={13} muted>{t('stCorrSub')}</AppText>
      {correlations.length === 0 ? <AppText>{t('stCorrNone')}</AppText> : correlations.slice(0, 3).map((c) => (
        <View key={`${c.a}-${c.b}`} style={{ gap: 6 }}>
          <CorrelationLine c={c} />
          <PatternStep pattern={patternFor(patterns, c)} riskMode={riskMode} />
        </View>
      ))}
    </View>
  );
}

/** The abstract card. Built from the aggregate `share` object only. */
export function ShareCardPreview({ share, size = 220 }: { share: Monthly['share']; size?: number }) {
  const t = useStoryT();
  const p = SEASON_PALETTE[asSeason(share.season)];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('stShareCardA11y', { season: t(`stSeason_${asSeason(share.season)}` as StoryKey), days: share.daysLogged })} style={{ alignSelf: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${CARD} ${CARD}`}>
        <Rect width={CARD} height={CARD} rx={28} fill={p.bg} />
        {shareShapes(share).map((s, i) => (s.kind === 'circle'
          ? <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} opacity={s.opacity} />
          : <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} opacity={s.opacity} transform={`rotate(${s.rotate} ${s.cx} ${s.cy})`} />))}
      </Svg>
    </View>
  );
}

function ShareCardPanel({ share }: { share: Monthly['share'] }) {
  const t = useStoryT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const caption = { title: t('stShareCardTitle'), sub: t(`stSeason_${asSeason(share.season)}` as StoryKey) };
      const html = shareCardHtml(share, caption);
      if (Platform.OS === 'web') { await Print.printAsync({ html }); return; }
      const { uri } = await Print.printToFileAsync({ html, width: CARD, height: CARD + 60 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      else setMsg(t('stShareUnavailable'));
    } catch { setMsg(t('stShareFail')); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 12 }}>
      <AppText size={20} weight="800" accessibilityRole="header">{t('stShareTitle')}</AppText>
      <ShareCardPreview share={share} />
      <AppText size={13} muted>{t('stShareBody')}</AppText>
      {msg ? <AppText size={13} accessibilityRole="alert">{msg}</AppText> : null}
      <Button title={busy ? t('stSharePreparing') : t('stShareBtn')} icon="download-outline" loading={busy} onPress={go} />
    </View>
  );
}

/** Swipeable "Your month" cards: horizontal paging, tap to advance, progress dots. */
export function MonthStory({ data }: { data: Monthly }) {
  useGuideSuppress('risk', !!data.riskMode); useGuideFallback('monthlyNarrative', data.narrative?.ai);
  const t = useStoryT();
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const ref = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const [w, setW] = useState(320);
  const [idx, setIdx] = useState(0);
  const pts: Point[] = data.series.map((d) => ({ label: d.date.slice(5), mood: d.mood, stress: d.stress, count: d.mood == null ? 0 : 1 }));
  const wk = data.bestMoodWeekday && data.lowestMoodWeekday;
  const stat = (label: string, node: React.ReactNode) => (
    <View key={label} style={{ flex: 1, minWidth: 120, gap: 2 }}>{node}<AppText size={12} muted>{label}</AppText></View>
  );
  const num = (v: number | null, f = one) => (v == null ? <AppText size={26} weight="800">–</AppText> : <AnimatedNumber value={v} format={f} style={{ fontSize: 26, color: c.text }} />);

  const cards: { key: string; node: React.ReactNode }[] = [
    { key: 'intro', node: (
      <View style={{ gap: 10 }}>
        <AppText size={13} muted>{t('stRange', { n: data.periodDays })}</AppText>
        {data.narrative ? (
          <>
            <AppText size={22} weight="800" accessibilityRole="header">{data.narrative.headline}</AppText>
            <AppText>{data.narrative.text}</AppText>
            <AiBadge ai={data.narrative.ai} />
          </>
        ) : null}
      </View>
    ) },
    { key: 'numbers', node: (
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <AnimatedNumber value={data.daysLogged} style={{ fontSize: 44, color: c.primary }} />
          <AppText muted>{t('stDaysLogged')} · {t('stOfDays', { n: data.periodDays })}</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {stat(t('stAvgMood'), num(data.averages.mood))}
          {stat(t('stAvgStress'), num(data.averages.stress))}
          {stat(t('stAvgSleep'), num(data.averages.sleepScore, (n) => String(Math.round(n))))}
          {stat(t('stKaizen'), <AnimatedNumber value={data.kaizenDone} style={{ fontSize: 26, color: c.text }} />)}
        </View>
      </View>
    ) },
    { key: 'mood', node: (
      <View style={{ gap: 8 }}>
        <AppText size={20} weight="800" accessibilityRole="header">{t('stMoodTitle')}</AppText>
        <AppText size={12} muted>{t('stMoodSub')}</AppText>
        <MoodChart points={pts} width={Math.max(240, w - 64)} height={170} />
      </View>
    ) },
    { key: 'week', node: (
      <View style={{ gap: 10 }}>
        <AppText size={20} weight="800" accessibilityRole="header">{t('stWeekTitle')}</AppText>
        <AppText>{wk ? t('stWeekBoth', { hi: t(`stDay_${data.bestMoodWeekday!.weekday}` as StoryKey), lo: t(`stDay_${data.lowestMoodWeekday!.weekday}` as StoryKey) }) : t('stWeekNone')}</AppText>
        <PatternStep pattern={(data.patterns ?? []).find((p) => p.type === 'WEEKDAY_LOW')} riskMode={data.riskMode} />
      </View>
    ) },
    { key: 'corr', node: <CorrelationCard correlations={data.correlations} patterns={data.patterns} riskMode={data.riskMode} /> },
    ...(data.practice ? [{ key: 'practice', node: <PracticeCard practice={data.practice} /> }] : []),
    { key: 'share', node: <ShareCardPanel share={data.share} /> },
  ];
  const go = (i: number) => { const n = Math.max(0, Math.min(cards.length - 1, i)); setIdx(n); ref.current?.scrollTo({ x: n * w, animated: !reduced }); };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIdx(Math.round(e.nativeEvent.contentOffset.x / w));

  return (
    <View onLayout={(e) => setW(Math.max(240, Math.round(e.nativeEvent.layout.width)))} style={{ gap: 10 }}>
      <ScrollView ref={ref as never} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onEnd} accessibilityLabel={t('stTitle')}>
        {cards.map((card, i) => (
          <Pressable key={card.key} testID={`story-card-${i}`} accessibilityLabel={t('stCardOf', { i: i + 1, n: cards.length })} accessibilityHint={i < cards.length - 1 ? t('stTapHint') : undefined}
            onPress={() => { if (i < cards.length - 1) { tapHaptic(); go(i + 1); } }} style={{ width: w }}>
            <FadeInUp>
              <Card style={{ minHeight: 300, justifyContent: 'center', borderRadius: radius.lg }}>{card.node}</Card>
            </FadeInUp>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {cards.map((card, i) => (
          <View key={card.key} testID={`story-dot-${i}`} style={{ width: i === idx ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i === idx ? c.primary : c.border }} />
        ))}
      </View>
    </View>
  );
}
