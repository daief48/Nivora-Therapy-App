import React, { useState } from 'react';
import { api } from '../api/client';
import { useInvalidatingMutation } from '../api/hooks';
import { useT, type StringKey } from '../i18n';
import { AppText, Button, Card, Row } from './ui';

const WHAT: Record<string, StringKey> = {
  AGE_18_PLUS: 'crWhatAge', AI_DISCLOSURE: 'crWhatAi', PRIVACY: 'crWhatPrivacy',
  JOURNAL_AI_SHARING: 'crWhatShare', WELLNESS_AI_SHARING: 'crWhatWellness', HEALTH_IMPORT: 'crWhatHealth',
};

/** True for the API's structured 403 (`code: 'CONSENT_REQUIRED'`; matched case-insensitively). */
export function isConsentRequired(e: unknown): boolean {
  return String((e as { code?: unknown })?.code ?? '').toUpperCase() === 'CONSENT_REQUIRED';
}

/** The consent type named by the error (`details.consentType`), if any. */
export function consentTypeOf(e: unknown): string | null {
  const d = (e as { details?: { consentType?: unknown } })?.details;
  return typeof d?.consentType === 'string' ? d.consentType : null;
}

/**
 * Friendly prompt for a `consent_required` API error. Offers to grant the missing consent and then calls `onGranted`
 * (typically a retry). Renders nothing for any other error, so it can sit under any failed request.
 */
export function ConsentRequiredPrompt({ error, onGranted, onDismiss }: { error: unknown; onGranted?: () => void; onDismiss?: () => void }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const type = consentTypeOf(error);
  const grant = useInvalidatingMutation((consentType: string) => api('/consents', { method: 'POST', body: { consentType } }), [['consents']]);
  if (!isConsentRequired(error)) return null;
  const what = type && WHAT[type] ? t(WHAT[type]) : null;
  const allow = async () => {
    setFailed(false);
    if (!type) { onGranted?.(); return; }
    try { await grant.mutateAsync(type); onGranted?.(); } catch { setFailed(true); }
  };
  return (
    <Card tone="lavender" accessibilityRole="alert">
      <AppText size={17} weight="700">{t('crTitle')}</AppText>
      <AppText muted>{what ? t('crBodyFor', { what }) : t('crBody')}</AppText>
      {failed ? <AppText size={13} accessibilityRole="alert">{t('crFailed')}</AppText> : null}
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title={t('crAllow')} onPress={allow} loading={grant.isPending} icon="checkmark" />
        {onDismiss ? <Button title={t('crNotNow')} variant="ghost" onPress={onDismiss} /> : null}
      </Row>
    </Card>
  );
}
