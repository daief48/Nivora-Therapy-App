import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { type ReachContact, useReachOut } from '../api/actions';
import { AppText, Button, Card, Chip, EmptyState, ErrorState, Field, Hero, Loading, Row, Screen, SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useAT } from '../i18n/actionsT';
import { copyText } from '../utils/copyText';

const fill = (s: string, name: string) => s.replace(/\{name\}/g, name);

/**
 * REACH_OUT: pick someone you trust, start from a gentle draft, change it, then copy it or share it with the system share sheet.
 * Nothing is ever sent by the app. With `support: true` it is presented as reaching out to someone you trust, with their phone number shown.
 */
export function ActionReachOutScreen() {
  const t = useT();
  const at = useAT();
  const nav = useNavigation<any>();
  const support = !!(useRoute().params as { support?: boolean } | undefined)?.support;
  const q = useReachOut();
  const [who, setWho] = useState<ReachContact | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState<'copied' | 'manual' | null>(null);

  const contacts = q.data?.contacts ?? [];
  useEffect(() => { if (!who && contacts.length === 1) setWho(contacts[0]!); }, [contacts, who]);
  const drafts = who ? (who.drafts?.length ? who.drafts : (q.data?.templates ?? []).map((s) => fill(s, who.name))) : [];
  useEffect(() => { if (who) { setText(drafts[0] ?? ''); setNote(null); } }, [who]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError) return <Screen><ErrorState error={q.error} onRetry={() => { void q.refetch(); }} /></Screen>;

  const title = support ? at('arSupportTitle') : at('arTitle');
  const copy = async () => { setNote((await copyText(text)) ? 'copied' : 'manual'); };
  const share = async () => { try { await Share.share({ message: text }); } catch { /* the sheet was closed or is unavailable: nothing was sent */ } };

  return (
    <Screen>
      <Hero>
        <AppText size={24} weight="800" accessibilityRole="header">{title}</AppText>
        <AppText size={14}>{support ? at('arSupportIntro') : at('arIntro')}</AppText>
      </Hero>

      {!contacts.length ? (
        <>
          <EmptyState icon="people-outline" body={at('arNoContacts')} />
          <Button title={at('arAddPeople')} onPress={() => nav.navigate('SafetyPlan')} />
        </>
      ) : (
        <>
          <SectionTitle>{at('arPick')}</SectionTitle>
          <Row style={{ flexWrap: 'wrap' }}>
            {contacts.map((c) => <Chip key={c.id} label={c.relation ? `${c.name} · ${c.relation}` : c.name} selected={who?.id === c.id} onPress={() => setWho(c)} />)}
          </Row>
          {who ? (
            <Card>
              {support && who.phone ? <AppText size={20} weight="700" selectable>{at('arPhone', { phone: who.phone })}</AppText> : null}
              {drafts.length > 1 ? (
                <>
                  <AppText size={14} muted>{at('arStart')}</AppText>
                  <Row style={{ flexWrap: 'wrap' }}>{drafts.map((d, i) => <Chip key={i} label={`${i + 1}`} selected={text === d} onPress={() => setText(d)} />)}</Row>
                </>
              ) : null}
              <Field label={at('arDraft')} value={text} onChangeText={(v) => { setText(v); setNote(null); }} multiline style={{ minHeight: 120 }} accessibilityLabel={at('arDraft')} />
              <Row style={{ flexWrap: 'wrap' }}>
                <Button title={at('arCopy')} variant="secondary" onPress={() => { void copy(); }} disabled={!text.trim()} />
                <Button title={at('arShare')} onPress={() => { void share(); }} disabled={!text.trim()} />
              </Row>
              {note ? <AppText size={13} accessibilityLiveRegion="polite">{note === 'copied' ? at('arCopied') : at('arCopyManual')}</AppText> : null}
            </Card>
          ) : null}
          <AppText size={13} muted>{at('arNotSent')}</AppText>
        </>
      )}
      {support ? <Button title={at('arEmergency')} variant="danger" onPress={() => nav.navigate('Emergency')} /> : null}
      <Button title={t('back')} variant="ghost" onPress={() => nav.goBack()} />
    </Screen>
  );
}
