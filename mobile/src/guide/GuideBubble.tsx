import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avatar, type ReactionEvent } from '../components/Avatar';
import type { AvatarTone } from '../components/AvatarArt';
import { useG } from '../i18n/guideT';
import { FadeInUp, PressScale } from '../motion';
import { radius, useTheme } from '../theme';
import { getFeature, type GuideMood } from './guideContent';
import { momentSteps, type Moment } from './guideEngine';

/** Maps the guide's mood onto the existing Avatar's tone and reaction pose. No new character, no new expressions. */
export function avatarPropsFor(mood: GuideMood): { tone: AvatarTone; reactionType: ReactionEvent['type'] | null } {
  switch (mood) {
    case 'curious': return { tone: 'warm', reactionType: 'curious' };
    case 'proud': return { tone: 'cheerful', reactionType: 'joy' };
    case 'warm': return { tone: 'warm', reactionType: 'nod' };
    default: return { tone: 'warm', reactionType: null }; // calm: the resting face
  }
}

/**
 * The avatar plus a speech bubble. Presentational: the host (or a test) passes the moment and the handlers.
 * The bubble text is a polite live region; the avatar is decorative (hidden from screen readers).
 */
export function GuideBubble({ moment, onNext, onSkip, onHide, onTryIt, avatarSize = 64 }: {
  moment: Moment; onNext: () => void; onSkip: () => void; onHide: () => void; onTryIt?: () => void; avatarSize?: number;
}) {
  const { c, text } = useTheme();
  const g = useG();
  const steps = momentSteps(moment);
  const feature = getFeature(moment.featureId);
  const step = steps[Math.min(moment.step, steps.length - 1)];
  const last = moment.step >= steps.length - 1;
  const { tone, reactionType } = avatarPropsFor(step?.mood ?? 'calm');
  const reaction = useMemo<ReactionEvent | null>(() => (reactionType ? { type: reactionType, key: moment.step + 1 } : null), [reactionType, moment.step]);
  if (!step || !feature) return null;
  const showTry = last && !!onTryIt && !!feature.tryItRoute && moment.kind !== 'whatsnew';
  return (
    <FadeInUp distance={18}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
        <View accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Avatar state="idle" size={avatarSize} tone={tone} reaction={reaction} />
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text accessibilityRole="header" style={[text(13, '700'), { color: c.textMuted }]}>{g(feature.featureKey)}</Text>
          <Text accessibilityLiveRegion="polite" accessibilityLabel={`${g('gBubbleLabel')}. ${g(step.textKey)}`} style={text(15, '600')}>{g(step.textKey)}</Text>
          {steps.length > 1 ? (
            <View accessible accessibilityLabel={g('gStepOf', { n: moment.step + 1, total: steps.length })} style={{ flexDirection: 'row', gap: 6 }}>
              {steps.map((_, i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === moment.step ? c.primary : c.border }} />)}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <PressScale accessibilityRole="button" accessibilityLabel={last ? g('gDone') : g('gNext')} onPress={onNext} style={{ backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
              <Text style={[text(14, '700'), { color: c.onPrimary }]}>{last ? g('gDone') : g('gNext')}</Text>
            </PressScale>
            {showTry ? (
              <PressScale accessibilityRole="button" accessibilityLabel={g('gTryIt')} onPress={onTryIt} style={{ backgroundColor: c.lavender, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
                <Text style={[text(14, '700'), { color: c.tintFg[2] }]}>{g('gTryIt')}</Text>
              </PressScale>
            ) : null}
            {!last ? (
              <PressScale accessibilityRole="button" accessibilityLabel={g('gSkip')} onPress={onSkip} style={{ paddingHorizontal: 10, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
                <Text style={[text(14, '600'), { color: c.textMuted }]}>{g('gSkip')}</Text>
              </PressScale>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={g('gHide')} onPress={onHide} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
            <Text style={[text(12, '600'), { color: c.textMuted, textDecorationLine: 'underline' }]}>{g('gHide')}</Text>
          </Pressable>
        </View>
      </View>
    </FadeInUp>
  );
}
