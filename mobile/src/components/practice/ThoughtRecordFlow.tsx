import { useGuideConsent, useGuideFallback, useGuideReaction, useGuideSuppress } from '../../guide';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { isCrisis, saveThoughtRecord, suggestAlternative, type CrisisPayload, type JournalOffer } from '../../api/practice';
import { FadeInUp } from '../../motion';
import { radius, useTheme } from '../../theme';
import { AiBadge } from '../AiBadge';
import { ConsentRequiredPrompt, consentTypeOf, isConsentRequired } from '../ConsentRequired';
import { AppText, Button, Card, Field, ProgressBar, Row } from '../ui';
import { JournalOfferCard } from './JournalOfferCard';
import { CrisisSupport, PracticeDone, type Recorded } from './parts';
import { usePT } from './pt';

const STEPS = 5; // situation, thought, feeling, alternative, mood

/** 1-10 row of round buttons. */
function Scale10({ value, onChange, label }: { value: number | null; onChange: (n: number) => void; label: string }) {
  const { c, text } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => {
        const sel = value === n;
        return (
          <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`${label} ${n}`} accessibilityState={{ selected: sel, checked: sel }} onPress={() => onChange(n)}
            style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? c.primary : c.card, borderWidth: 1, borderColor: sel ? c.primary : c.border }}>
            <Text style={[text(15, '700'), { color: sel ? c.onPrimary : c.text }]}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Thought record in five calm steps. The AI helper is optional: it only offers a gentler alternative to edit or ignore, and the
 * whole flow works without it. A crisis payload (from the helper or from saving) stops the flow and nothing is stored.
 */
export function ThoughtRecordFlow({ onExit, onEmergency }: { onExit?: () => void; onEmergency?: () => void }) {
  const t = usePT();
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const [situation, setSituation] = useState('');
  const [thought, setThought] = useState('');
  const [feeling, setFeeling] = useState('');
  const [intensity, setIntensity] = useState<number | null>(null);
  const [alt, setAlt] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [helping, setHelping] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; ai: boolean } | null>(null);
  const [consentErr, setConsentErr] = useState<unknown>(null);
  useGuideConsent(consentTypeOf(consentErr), !!consentErr);
  useGuideFallback('thoughtHelp', suggestion?.ai);
  const [helpFailed, setHelpFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [recorded, setRecorded] = useState<Recorded>(null);
  const [offer, setOffer] = useState<JournalOffer | null>(null);
  const [done, setDone] = useState(false);
  const react = useGuideReaction();
  useGuideSuppress('exercise', !done && !crisis);

  const stopForCrisis = (c: CrisisPayload) => {
    setCrisis(c); setSituation(''); setThought(''); setFeeling(''); setAlt(''); setSuggestion(null); setConsentErr(null);
  };

  const help = async () => {
    setHelping(true); setHelpFailed(false); setConsentErr(null);
    try {
      const r = await suggestAlternative({ thought: thought.trim(), situation: situation.trim() || undefined });
      if (isCrisis(r)) stopForCrisis(r); else setSuggestion({ text: r.alternative, ai: r.ai });
    } catch (e) {
      if (isConsentRequired(e)) setConsentErr(e); else setHelpFailed(true);
    } finally { setHelping(false); }
  };

  const save = async () => {
    setSaving(true); setSaveFailed(false);
    const f = feeling.trim();
    const feelingText = f || intensity ? `${f}${intensity ? `${f ? ' ' : ''}(${intensity}/10)` : ''}` : undefined;
    try {
      const r = await saveThoughtRecord({
        situation: situation.trim(), thought: thought.trim(), feeling: feelingText, alternative: alt.trim() || undefined,
        moodBefore: before ?? undefined, moodAfter: after ?? undefined, save: true,
      });
      if (isCrisis(r)) { stopForCrisis(r); return; }
      setRecorded(r.kaizen); setOffer(r.journalOffer ?? null); setDone(true); react('thought', r.kaizen?.counted ? { garden: true } : undefined);
      qc.invalidateQueries({ queryKey: ['journal'] }); qc.invalidateQueries({ queryKey: ['kaizen'] }); qc.invalidateQueries({ queryKey: ['garden'] });
    } catch { setSaveFailed(true); } finally { setSaving(false); }
  };

  const again = () => {
    setI(0); setSituation(''); setThought(''); setFeeling(''); setIntensity(null); setAlt(''); setBefore(null); setAfter(null);
    setSuggestion(null); setRecorded(null); setOffer(null); setDone(false);
  };

  if (crisis) return <CrisisSupport crisis={crisis} onEmergency={onEmergency} onExit={onExit} />;
  if (done) return <PracticeDone title={t('activityDone')} note={t('prTrSaved')} recorded={recorded} onAgain={again} onExit={onExit}>{offer ? <JournalOfferCard offer={offer} /> : null}</PracticeDone>;

  const canNext = i === 0 ? situation.trim().length > 0 : i === 1 ? thought.trim().length > 0 : true;
  return (
    <Card>
      <AppText size={13} weight="700" muted>{t('stepOf', { n: i + 1, total: STEPS })}</AppText>
      <ProgressBar value={i + 1} max={STEPS} label={t('stepOf', { n: i + 1, total: STEPS })} />
      <FadeInUp key={i} style={{ gap: 12 }}>
        {i === 0 ? (
          <>
            <AppText size={20} weight="800" accessibilityRole="header">{t('prTrSituationQ')}</AppText>
            <Field label={t('prTrSituationHint')} value={situation} onChangeText={setSituation} multiline maxLength={1500} />
          </>
        ) : i === 1 ? (
          <>
            <AppText size={20} weight="800" accessibilityRole="header">{t('prTrThoughtQ')}</AppText>
            <Field label={t('prTrThoughtHint')} value={thought} onChangeText={setThought} multiline maxLength={1500} />
          </>
        ) : i === 2 ? (
          <>
            <AppText size={20} weight="800" accessibilityRole="header">{t('prTrFeelingQ')}</AppText>
            <Field label={t('prTrFeelingLabel')} value={feeling} onChangeText={setFeeling} maxLength={200} />
            <AppText weight="700" size={14}>{t('prTrIntensity', { n: intensity ?? '-' })}</AppText>
            <Scale10 value={intensity} onChange={setIntensity} label={t('prTrFeelingLabel')} />
          </>
        ) : i === 3 ? (
          <>
            <AppText size={20} weight="800" accessibilityRole="header">{t('prTrAltQ')}</AppText>
            <AppText muted size={14}>{t('prTrAltHint')}</AppText>
            <Field label={t('prTrAltLabel')} value={alt} onChangeText={setAlt} multiline maxLength={1500} />
            <Button title={helping ? t('prTrHelping') : t('prTrHelp')} variant="secondary" icon="sparkles-outline" loading={helping} onPress={help} />
            <AppText muted size={12}>{t('prTrAiOptional')}</AppText>
            {helpFailed ? <AppText size={13} accessibilityRole="alert">{t('prTrAiFailed')}</AppText> : null}
            {consentErr ? <ConsentRequiredPrompt error={consentErr} onGranted={help} onDismiss={() => setConsentErr(null)} /> : null}
            {suggestion ? (
              <Card tone="lavender">
                <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <AppText size={13} weight="700">{suggestion.ai ? t('prTrSuggestion') : t('prTrQuestion')}</AppText>
                  <AiBadge ai={suggestion.ai} />
                </Row>
                <AppText accessibilityLiveRegion="polite">{suggestion.text}</AppText>
                {suggestion.ai ? <Button title={t('prTrUse')} variant="secondary" onPress={() => setAlt(suggestion.text)} /> : null}
              </Card>
            ) : null}
          </>
        ) : (
          <>
            <AppText size={20} weight="800" accessibilityRole="header">{t('prTrMoodQ')}</AppText>
            <AppText weight="700" size={14}>{t('prTrMoodBefore')}</AppText>
            <Scale10 value={before} onChange={setBefore} label={t('prTrMoodBefore')} />
            <AppText weight="700" size={14}>{t('prTrMoodAfter')}</AppText>
            <Scale10 value={after} onChange={setAfter} label={t('prTrMoodAfter')} />
            {saveFailed ? <AppText accessibilityRole="alert" size={13}>{t('prTrSaveFailed')}</AppText> : null}
          </>
        )}
      </FadeInUp>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title={t('back')} variant="ghost" disabled={i === 0} onPress={() => setI(i - 1)} style={{ flex: 1 }} />
        {i === STEPS - 1
          ? <Button title={t('prTrSave')} onPress={save} loading={saving} disabled={!situation.trim() || !thought.trim()} style={{ flex: 2 }} />
          : <Button title={i >= 2 && !(i === 2 ? feeling.trim() || intensity : alt.trim()) ? t('skipStep') : t('next')} disabled={!canNext} onPress={() => setI(i + 1)} style={{ flex: 2 }} />}
      </Row>
      {onExit ? <Button title={t('close')} variant="ghost" onPress={onExit} /> : null}
    </Card>
  );
}
