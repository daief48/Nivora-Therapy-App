import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { savePreferences, usePreferences, useTherapyMutation } from '../api/sessions';
import { Blossom } from '../components/sakura';
import { AppText, Button, Card, Hero, IconCircle, Row, Screen, type IconName } from '../components/ui';
import { useT, type StringKey } from '../i18n';
import type { Nav, RootParams } from '../navigation/types';
import { useTheme } from '../theme';

/** One calm screen: what guided sessions are and are not, what is remembered, and the (default OFF) continuity choice. */
export function GuidedIntroScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootParams, 'GuidedIntro'>>();
  const q = usePreferences();
  const [cont, setCont] = useState(false);
  useEffect(() => { if (q.data) setCont(!!q.data.continuityOptIn); }, [q.data]);
  const acked = !!q.data?.guidedAck;
  const save = useTherapyMutation<void>(async () => {
    await savePreferences({ continuityOptIn: cont, qualityReviewOptIn: !!q.data?.qualityReviewOptIn, guidedAck: true });
  });
  const go = async () => {
    try {
      await save.mutateAsync();
      if (route.params?.next === 'lobby' || !acked) { if (nav.canGoBack()) nav.goBack(); else nav.navigate('SessionLobby'); }
      else Alert.alert(t('sessIntroSaved'));
    } catch { Alert.alert(t('errorTitle')); }
  };

  const blocks: { icon: IconName; tone: 0 | 1 | 2 | 3; title: StringKey; body: StringKey }[] = [
    { icon: 'chatbubble-ellipses-outline', tone: 0, title: 'sessIntroIsTitle', body: 'sessIntroIs' },
    { icon: 'information-circle-outline', tone: 3, title: 'sessIntroIsNotTitle', body: 'sessIntroIsNot' },
    { icon: 'lock-closed-outline', tone: 1, title: 'sessIntroMemTitle', body: 'sessIntroMem' },
  ];

  return (
    <Screen>
      <Hero>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 6, paddingRight: 8 }}>
            <AppText size={24} weight="800" accessibilityRole="header" style={{ color: c.onHero }}>{t('sessIntroTitle')}</AppText>
            <AppText size={14} style={{ color: c.onHeroMuted }}>{t('sessIntroLead')}</AppText>
          </View>
          <Blossom size={56} />
        </Row>
      </Hero>
      {/* preferences are optional to load: if they fail we still show the defaults (continuity off) */}
      <>
            {blocks.map((b) => (
              <Card key={b.title}>
                <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                  <IconCircle icon={b.icon} tone={b.tone} size={44} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <AppText size={17} weight="800" accessibilityRole="header">{t(b.title)}</AppText>
                    <AppText size={14} muted>{t(b.body)}</AppText>
                  </View>
                </Row>
              </Card>
            ))}
            <Card tone="lavender">
              <AppText size={17} weight="800" accessibilityRole="header">{t('sessIntroContTitle')}</AppText>
              <AppText size={14} muted>{t('sessIntroContBody')}</AppText>
              <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
                <AppText weight="700" style={{ flex: 1 }}>{t('sessIntroContSwitch')}</AppText>
                <Switch value={cont} onValueChange={setCont} accessibilityLabel={t('sessIntroContSwitch')} trackColor={{ true: c.primary, false: c.border }} />
              </Row>
            </Card>
            <AppText size={13} muted style={{ textAlign: 'center' }}>{t('sessAiNote')}</AppText>
            <Button title={acked ? t('sessIntroSave') : t('sessIntroAck')} onPress={go} loading={save.isPending} />
            <Button title={t('emergency')} icon="medkit-outline" variant="danger" onPress={() => nav.navigate('Emergency')} />
      </>
    </Screen>
  );
}
