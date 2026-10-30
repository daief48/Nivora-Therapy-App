import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../components/Avatar';
import { Logo, SoftOrbs } from '../../components/Brand';
import { BlossomBranch, SakuraPetals } from '../../components/sakura';
import { AppText, Button, Chip, Icon, Row } from '../../components/ui';
import { useT, type StringKey } from '../../i18n';
import type { Nav } from '../../navigation/types';
import { useSettings } from '../../store/settings';
import { layout, useTheme } from '../../theme';

const PAGES: [StringKey, StringKey][] = [['onboard1Title', 'onboard1Body'], ['onboard2Title', 'onboard2Body'], ['onboard3Title', 'onboard3Body']];

export function WelcomeScreen() {
  const t = useT();
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const { uiLang, set } = useSettings();
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient pointerEvents="none" colors={[c.bgTop, c.bg]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <SoftOrbs colors={['rgba(245,220,227,0.55)', 'rgba(168,184,160,0.10)', 'rgba(234,228,241,0.55)']} />
      <SakuraPetals count={7} height={760} />
      <BlossomBranch width={170} />
      <View style={{ flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: 20, gap: 16 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row>
            <Chip label="English" selected={uiLang === 'en'} onPress={() => set({ uiLang: 'en' })} />
            <Chip label="বাংলা" selected={uiLang === 'bn'} onPress={() => set({ uiLang: 'bn' })} />
          </Row>
          <Pressable accessibilityRole="button" accessibilityLabel={t('emergency')} onPress={() => nav.navigate('Emergency')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.danger, borderRadius: 999, minHeight: 44, paddingHorizontal: 14 }}>
            <Icon name="medkit-outline" size={18} color={c.onDanger} />
            <AppText size={14} weight="800" style={{ color: c.onDanger }}>{t('emergency')}</AppText>
          </Pressable>
        </Row>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Avatar state="idle" size={170} />
          <Row style={{ gap: 10 }}><Logo size={42} /><AppText size={38} weight="800" style={{ color: c.primary, letterSpacing: 1 }}>{t('appName')}</AppText></Row>
          <AppText muted style={{ textAlign: 'center' }}>{t('tagline')}</AppText>
          <AppText size={20} weight="700" style={{ color: c.accent, textAlign: 'center' }}>{t('peace')}</AppText>
        </View>

        <View style={{ gap: 8, minHeight: 140 }} accessibilityLiveRegion="polite">
          <AppText size={22} weight="800" style={{ textAlign: 'center' }}>{t(PAGES[page]![0])}</AppText>
          <AppText style={{ textAlign: 'center' }} muted>{t(PAGES[page]![1])}</AppText>
        </View>
        <Row style={{ justifyContent: 'center' }}>
          {PAGES.map((_, i) => <View key={i} style={{ width: i === page ? 26 : 9, height: 9, borderRadius: 5, backgroundColor: i === page ? c.primary : c.border }} />)}
        </Row>
        {last
          ? <Button title={t('getStarted')} onPress={() => nav.navigate('SignUp')} />
          : <Button title={t('next')} onPress={() => setPage(page + 1)} />}
        <Button title={t('haveAccount')} variant="ghost" onPress={() => nav.navigate('SignIn')} />
      </View>
    </SafeAreaView>
  );
}
