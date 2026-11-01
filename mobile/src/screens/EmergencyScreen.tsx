import { useGuideSuppress } from '../guide';
import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useCrisisResources, useMe } from '../api/hooks';
import { PeopleITrust, useTrustedContacts } from '../components/TrustedPeople';
import type { Nav } from '../navigation/types';
import { AppText, Button, Card, Field, Loading, Row, Screen, useOnline } from '../components/ui';
import { useT } from '../i18n';
import { useAuth } from '../store/auth';
import { HeartbeatHeroCard } from '../components/emergency/HeartbeatHeroCard';
import { CalmAnchorBreather } from '../components/emergency/CalmAnchorBreather';
import { GroundingExercise54321 } from '../components/emergency/GroundingExercise54321';
import { SafetyChainCaller } from '../components/emergency/SafetyChainCaller';
import { MicroSafetyContract } from '../components/emergency/MicroSafetyContract';

const dialable = (s: string) => /^[+\d][\d\s\-()]{1,20}$/.test(s);

/** Works signed-out and offline: the guidance text is static; stored numbers load when online. */
export function EmergencyScreen() {
  useGuideSuppress('emergency');
  const t = useT();
  const nav = useNavigation<Nav>();
  const signedIn = useAuth((s) => s.status === 'in');
  const me = useMe();
  const online = useOnline();
  const [input, setInput] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [showBreather, setShowBreather] = useState(false);
  const [showGrounding, setShowGrounding] = useState(false);
  const [showChain, setShowChain] = useState(false);
  const effective = country ?? (signedIn ? me.data?.countryCode ?? null : null);
  const res = useCrisisResources(effective);
  const contactsQuery = useTrustedContacts();
  const contacts = contactsQuery.data ?? [];

  return (
    <Screen>
      {/* ── Phase 1: Heartbeat Hero Card ── */}
      <HeartbeatHeroCard online={online} />

      {/* ── Immediate Somatic Anchors (100% Offline) ── */}
      <Row style={{ gap: 10, marginVertical: 4 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={t('emBreatheButton')}
            variant="secondary"
            onPress={() => setShowBreather(true)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={t('emGroundingButton')}
            variant="secondary"
            onPress={() => setShowGrounding(true)}
          />
        </View>
      </Row>

      {/* ── Phase 2: Micro Safety Contract ── */}
      <MicroSafetyContract />

      <Card style={{ gap: 6 }}>
        <AppText>{t('emergencyIntro')}</AppText>
        <AppText weight="600">{t('emergencyTrusted')}</AppText>
      </Card>

      {signedIn ? (
        <>
          <PeopleITrust onAdd={() => nav.navigate('SafetyPlan')} />
          <Row style={{ gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t('emChainButton')}
                variant="primary"
                onPress={() => setShowChain(true)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('safetyOpenPlan')}
                variant="secondary"
                onPress={() => nav.navigate('SafetyPlan')}
              />
            </View>
          </Row>
        </>
      ) : null}
      <Field label={t('emergencyCountry')} value={input} onChangeText={(v) => setInput(v.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase())} autoCapitalize="characters" maxLength={2} />
      <Button title={t('emergencyLookup')} disabled={input.length !== 2} onPress={() => setCountry(input)} />
      {effective && res.isLoading ? <Loading /> : null}
      {effective && res.data ? (
        res.data.resources.length === 0 ? <AppText>{t('emergencyNone')}</AppText> : (
          res.data.resources.map((r) => (
            <Card key={`${r.resourceType}-${r.name}`}>
              <AppText weight="700">{r.name}</AppText>
              <AppText size={22} weight="700">{r.contactDetails}</AppText>
              <AppText size={13} muted>{r.verified ? t('emergencyVerified') : t('emergencyUnverified')}</AppText>
              {r.verified && (r as { sourceUrl?: string | null }).sourceUrl ? (
                <Button title={t('safetyOpenSource')} variant="ghost" onPress={() => Linking.openURL((r as { sourceUrl?: string | null }).sourceUrl as string)} />
              ) : null}
              {dialable(r.contactDetails) ? (
                <Row><Button title={`${t('callNumber')} ${r.contactDetails}`} variant="danger" onPress={() => Linking.openURL(`tel:${r.contactDetails.replace(/\s/g, '')}`)} /></Row>
              ) : null}
            </Card>
          ))
        )
      ) : null}
      {effective && res.isError ? <AppText>{t('errorNetwork')}</AppText> : null}

      {/* ── Phase 1 & 2 Modals ── */}
      <CalmAnchorBreather
        visible={showBreather}
        onClose={() => setShowBreather(false)}
      />
      <GroundingExercise54321
        visible={showGrounding}
        onClose={() => setShowGrounding(false)}
      />
      <SafetyChainCaller
        visible={showChain}
        contacts={contacts}
        onClose={() => setShowChain(false)}
        onAddPerson={() => nav.navigate('SafetyPlan')}
      />
    </Screen>
  );
}
