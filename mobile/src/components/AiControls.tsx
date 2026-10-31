import { useGuideFeature } from '../guide';
import React, { useState } from 'react';
import { SUGGESTION_LEVELS, useAiSettings, useAnalyticsOptIn, useSaveAiSettings } from '../api/aiSettings';
import { useCn, type CnKey } from '../i18n/connectT';
import { tapHaptic } from '../motion';
import { AppText, Card, Check, Chip, ListRow, Row, SectionTitle } from './ui';

/**
 * Profile section: how often Nivora offers suggestions (stored server-side as `suggestionLevel`), the optional anonymous-counts switch,
 * and the way into "What the AI sees". Kept apart from the other rows so it can be placed as one block.
 */
export function AiControlsSection({ onOpenAiSees }: { onOpenAiSees: () => void }) {
  useGuideFeature('suggest');
  const cn = useCn();
  const q = useAiSettings();
  const save = useSaveAiSettings();
  const analytics = useAnalyticsOptIn();
  const [failed, setFailed] = useState(false);
  const s = q.data;

  const put = (patch: Parameters<typeof save.mutate>[0]) => { setFailed(false); tapHaptic(); save.mutate(patch, { onError: () => setFailed(true) }); };
  return (
    <>
      <SectionTitle>{cn('cnSuggestTitle')}</SectionTitle>
      <Card>
        <AppText size={13} muted>{cn('cnSuggestNote')}</AppText>
        {s ? (
          <>
            <Row style={{ flexWrap: 'wrap' }}>
              {SUGGESTION_LEVELS.map((l) => <Chip key={l} label={cn(`cnLevel${l}` as CnKey)} selected={s.suggestionLevel === l} onPress={() => put({ suggestionLevel: l })} />)}
            </Row>
            {s.suggestionLevel === 'NEVER' ? <AppText size={13} muted accessibilityLiveRegion="polite">{cn('cnLevelNeverNote')}</AppText> : null}
            <Check checked={analytics.value} onToggle={() => { tapHaptic(); analytics.set(!analytics.value); }} label={cn('cnAnalytics')} />
            <AppText size={12} muted>{cn('cnAnalyticsNote')}</AppText>
          </>
        ) : q.isError ? <AppText size={13} muted accessibilityRole="alert">{cn('cnSettingsFailed')}</AppText> : null}
        {failed ? <AppText size={13} accessibilityRole="alert">{cn('cnSettingsFailed')}</AppText> : null}
        <ListRow icon="eye-outline" tone={1} label={cn('cnAiSeesRow')} onPress={onOpenAiSees} />
      </Card>
    </>
  );
}
