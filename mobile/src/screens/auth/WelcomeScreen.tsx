import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../components/Avatar';
import { Logo, SoftOrbs } from '../../components/Brand';
import { BlossomBranch, SakuraPetals } from '../../components/sakura';
import { AppText, Button, Icon, IconCircle, type IconName } from '../../components/ui';
import { AiDisclosure } from '../../components/AiBadge';
import { useT, type StringKey } from '../../i18n';
import type { Nav } from '../../navigation/types';
import { useSettings, type UiLang } from '../../store/settings';
import { layout, radius, useTheme } from '../../theme';

const PAGES: { title: StringKey; body: StringKey; icon: IconName; tone: 0 | 1 | 2 }[] = [
  { title: 'onboard1Title', body: 'onboard1Body', icon: 'leaf-outline', tone: 1 },
  { title: 'onboard2Title', body: 'onboard2Body', icon: 'sparkles-outline', tone: 0 },
  { title: 'onboard3Title', body: 'onboard3Body', icon: 'moon-outline', tone: 2 },
];
const LANGS: { id: UiLang; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'bn', label: 'বাংলা' }, { id: 'hi', label: 'हिन्दी' }, { id: 'ne', label: 'नेपाली' },
];

/** Welcome: a calm "garden window" hero, one onboarding card at a time, compact language menu. Scrolls instead of overlapping on small screens. */
export function WelcomeScreen() {
  const t = useT();
  const { c, shadow } = useTheme();
  const nav = useNavigation<Nav>();
  const { height } = useWindowDimensions();
  const { uiLang, set } = useSettings();
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState(false);
  const last = page === PAGES.length - 1;
  const p = PAGES[page]!;
  const avatar = Math.max(110, Math.min(160, Math.round(height * 0.2)));
  const current = LANGS.find((l) => l.id === uiLang)?.label ?? 'English';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient pointerEvents="none" colors={[c.bgTop, c.bg, c.bg]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <SoftOrbs colors={['rgba(245,220,227,0.55)', 'rgba(168,184,160,0.08)', 'rgba(234,228,241,0.5)']} />
      <SakuraPetals count={7} height={Math.max(520, height)} />

      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ flexGrow: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, gap: 18 }}>
          {/* top bar: compact language menu + emergency icon */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {page > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => setPage(page - 1)} hitSlop={8}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
                <Icon name="chevron-back" size={22} color={c.text} />
              </Pressable>
            ) : null}
            <View>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('language')}: ${current}`} accessibilityState={{ expanded: menu }} onPress={() => setMenu(!menu)}
                style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }, shadow('sm')]}>
                <Icon name="language" size={18} color={c.primary} />
                <AppText size={14} weight="700">{current}</AppText>
                <Icon name={menu ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
              </Pressable>
              {menu ? (
                <View style={[{ position: 'absolute', top: 50, left: 0, minWidth: 170, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: 6 }, shadow('lg')]}>
                  {LANGS.map((l) => (
                    <Pressable key={l.id} accessibilityRole="button" accessibilityState={{ selected: l.id === uiLang }} onPress={() => { set({ uiLang: l.id }); setMenu(false); }}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: l.id === uiLang ? c.lavender : 'transparent' }}>
                      <AppText weight={l.id === uiLang ? '800' : '600'}>{l.label}</AppText>
                      {l.id === uiLang ? <Icon name="checkmark" size={18} color={c.primary} /> : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('emergency')} onPress={() => nav.navigate('Emergency')}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger }}>
              <Icon name="medkit-outline" size={20} color={c.onDanger} />
            </Pressable>
          </View>

          {/* hero: arched garden window with the companion */}
          <View style={{ alignItems: 'center', gap: 14 }}>
            <View style={[{ width: avatar + 56, height: avatar + 72, borderTopLeftRadius: (avatar + 56) / 2, borderTopRightRadius: (avatar + 56) / 2, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 18 }, shadow('lg')]}>
              <LinearGradient colors={[c.heroA, c.heroB]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
              <SakuraPetals count={4} height={avatar + 72} />
              <BlossomBranch width={96} />
              <Avatar state="idle" size={avatar} />
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Logo size={38} />
                <AppText size={38} weight="800" style={{ color: c.primary, letterSpacing: 1.5 }}>{t('appName')}</AppText>
              </View>
              <AppText size={20} weight="700" style={{ color: c.accent, textAlign: 'center' }}>{t('peace')}</AppText>
              <AppText size={13} muted style={{ textAlign: 'center', paddingHorizontal: 12 }}>{t('tagline')}</AppText>
              <AiDisclosure style={{ justifyContent: 'center', paddingHorizontal: 12 }} />
            </View>
          </View>

          {/* onboarding card */}
          <View accessibilityLiveRegion="polite" style={[{ backgroundColor: c.card, borderRadius: radius.xl, padding: 20, gap: 10, alignItems: 'center', borderWidth: 1, borderColor: c.border }, shadow('md')]}>
            <IconCircle icon={p.icon} tone={p.tone} size={52} />
            <AppText size={22} weight="800" style={{ textAlign: 'center' }}>{t(p.title)}</AppText>
            <AppText muted style={{ textAlign: 'center' }}>{t(p.body)}</AppText>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              {PAGES.map((_, i) => (
                <Pressable key={i} accessibilityRole="button" accessibilityLabel={`${i + 1}/${PAGES.length}`} hitSlop={8} onPress={() => setPage(i)}
                  style={{ width: i === page ? 26 : 9, height: 9, borderRadius: 5, backgroundColor: i === page ? c.primary : c.border }} />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            {last
              ? <Button title={t('getStarted')} icon="leaf-outline" onPress={() => nav.navigate('SignUp')} />
              : <Button title={t('next')} onPress={() => setPage(page + 1)} />}
            <Button title={t('haveAccount')} variant="ghost" onPress={() => nav.navigate('SignIn')} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
