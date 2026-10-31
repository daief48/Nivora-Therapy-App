import { useGuideFeature } from '../guide';
import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useAiData, type AiData } from '../api/aiSettings';
import { api } from '../api/client';
import { useConsents, useInvalidatingMutation } from '../api/hooks';
import { cnKeyFor, useCn } from '../i18n/connectT';
import type { Nav } from '../navigation/types';
import { AppText, Button, Card, QueryBoundary, Row, Screen, SectionTitle } from '../components/ui';

/** Readable fallback for a server key we have no line for (a new key never breaks the page). */
const humanize = (k: string) => { const s = k.replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * "What the AI sees": which permission covers which data, what uses an AI model and what is plain built-in rules, and what is never
 * sent. Built over GET /privacy/ai-data; every key is mapped to a plain line here (the server sends keys, not text).
 */
export function AiSeesScreen() {
  useGuideFeature('aiSees');
  const cn = useCn();
  const nav = useNavigation<Nav>();
  const q = useAiData();
  const consents = useConsents();
  const keys = [['consents'], ['privacy-ai-data']];
  const grant = useInvalidatingMutation((type: string) => api('/consents', { method: 'POST', body: { consentType: type } }), keys);
  const withdraw = useInvalidatingMutation((id: string) => api(`/consents/${id}`, { method: 'DELETE' }), keys);
  const [failed, setFailed] = useState(false);

  const dataLine = (k: string) => { const key = cnKeyFor('cnData_', k); return key ? cn(key) : cn('cnAiOther'); };
  const featLine = (k: string) => { const key = cnKeyFor('cnFeat_', k); return key ? cn(key) : humanize(k); };
  const neverLine = (k: string) => { const key = cnKeyFor('cnNever_', k); return key ? cn(key) : humanize(k); };
  const consentLine = (k: string) => { const key = cnKeyFor('cnConsent_', k); return key ? cn(key) : humanize(k); };

  const toggle = (type: string, granted: boolean) => {
    setFailed(false);
    if (granted) {
      const row = consents.data?.find((r) => r.consentType === type && !r.withdrawnAt);
      if (!row) { setFailed(true); return; }
      withdraw.mutate(row.id, { onError: () => setFailed(true) });
    } else grant.mutate(type, { onError: () => setFailed(true) });
  };

  const render = (d: AiData) => {
    const feats = d.features ?? [];
    const model = feats.filter((f) => f.usesModel);
    const rules = feats.filter((f) => !f.usesModel);
    const featureRow = (f: AiData['features'][number]) => {
      const blocked = f.allowed === false && !!f.consent && f.consent !== 'BASE';
      return (
        <View key={f.key} style={{ gap: 2 }}>
          <AppText>{featLine(f.key)}</AppText>
          {blocked ? <AppText size={12} muted>{cn('cnAiNeeds')}</AppText> : null}
        </View>
      );
    };
    return (
      <>
        <AppText muted>{cn('cnAiIntro')}</AppText>

        <SectionTitle>{cn('cnAiConsents')}</SectionTitle>
        {(d.consents ?? []).map((c) => {
          const covers = Array.from(new Set((c.covers ?? []).map(dataLine)));
          return (
            <Card key={c.type} style={{ gap: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <AppText weight="800" style={{ flex: 1 }}>{consentLine(c.type)}</AppText>
                <AppText size={13} weight="700" muted>{c.granted ? cn('cnAiOn') : cn('cnAiOff')}</AppText>
              </Row>
              {covers.length ? (
                <View style={{ gap: 2 }}>
                  <AppText size={12} weight="700" muted>{cn('cnAiCovers')}</AppText>
                  {covers.map((l) => <AppText key={l} size={14}>{`• ${l}`}</AppText>)}
                </View>
              ) : null}
              {(c.features ?? []).length ? <AppText size={12} muted>{Array.from(new Set(c.features.map(featLine))).join(', ')}</AppText> : null}
              <Button title={c.granted ? cn('cnAiTurnOff') : cn('cnAiTurnOn')} variant={c.granted ? 'ghost' : 'secondary'}
                accessibilityLabel={`${consentLine(c.type)}: ${c.granted ? cn('cnAiTurnOff') : cn('cnAiTurnOn')}`}
                loading={grant.isPending || withdraw.isPending} onPress={() => toggle(c.type, c.granted)} />
            </Card>
          );
        })}
        {failed ? <AppText size={13} accessibilityRole="alert">{cn('cnSettingsFailed')}</AppText> : null}

        <SectionTitle>{cn('cnAiModel')}</SectionTitle>
        <Card style={{ gap: 10 }}>{model.map(featureRow)}</Card>

        <SectionTitle>{cn('cnAiRules')}</SectionTitle>
        <Card style={{ gap: 10 }}>{rules.map(featureRow)}</Card>

        <SectionTitle>{cn('cnAiNever')}</SectionTitle>
        <Card style={{ gap: 6 }}>{(d.neverSent ?? []).map((k) => <AppText key={k}>{`• ${neverLine(k)}`}</AppText>)}</Card>

        <Button title={cn('cnAiPrivacy')} variant="secondary" icon="shield-checkmark-outline" onPress={() => nav.navigate('Privacy')} />
      </>
    );
  };

  return (
    <Screen>
      <AppText size={24} weight="800" accessibilityRole="header">{cn('cnAiTitle')}</AppText>
      <QueryBoundary q={q}>{render}</QueryBoundary>
    </Screen>
  );
}
