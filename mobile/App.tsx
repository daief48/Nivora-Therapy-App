import { createNavigationContainerRef, DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NotoSansBengali_400Regular, NotoSansBengali_500Medium, NotoSansBengali_700Bold } from '@expo-google-fonts/noto-sans-bengali';
import { NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari';
import { NotoSerifJP_600SemiBold } from '@expo-google-fonts/noto-serif-jp';
import { NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold, NunitoSans_800ExtraBold } from '@expo-google-fonts/nunito-sans';
import { useFonts } from 'expo-font';
import { Blossom, SakuraPetals } from './src/components/sakura';
import { useT } from './src/i18n';
import { api, ApiError } from './src/api/client';
import { persistOptions } from './src/api/offline';
import { LockGate } from './src/components/LockGate';
import { rescheduleAll } from './src/utils/reminders';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/store/auth';
import { useSettings } from './src/store/settings';
import { useTheme } from './src/theme';
import { GuideHost, SuggestionBridge } from './src/guide';

const navRef = createNavigationContainerRef<any>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Do not hammer the server for client errors; retry transient/network failures twice.
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

function Splash() {
  const { c, text } = useTheme();
  const t = useT();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <SakuraPetals count={6} height={700} />
      <Blossom size={72} deep />
      <Text style={[text(38, '800'), { color: c.primary, letterSpacing: 1 }]}>Nivora</Text>
      <Text style={[text(16), { color: c.textMuted }]}>{t('peace')}</Text>
    </View>
  );
}

function Root() {
  const { c, isDark } = useTheme();
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  const hydrated = useHydrated();
  const set = useSettings((s) => s.set);
  const [minSplash, setMinSplash] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  const syncRoute = () => setRouteName(navRef.isReady() ? navRef.getCurrentRoute()?.name : undefined);
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  // Opening the app re-arms the single gentle-return reminder and applies the reminder settings.
  useEffect(() => {
    const touch = () => { useSettings.getState().set({ lastOpenAt: Date.now() }); void rescheduleAll(useSettings.getState(), tRef.current); };
    touch();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') touch(); });
    return () => sub.remove();
  }, []);
  // Fonts are decoration: if they fail to load the system fonts are used instead of blocking the app.
  const [fontsLoaded, fontError] = useFonts({ NotoSerifJP_600SemiBold, NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold, NunitoSans_800ExtraBold, NotoSansBengali_400Regular, NotoSansBengali_500Medium, NotoSansBengali_700Bold, NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_700Bold });

  useEffect(() => { void bootstrap(); const id = setTimeout(() => setMinSplash(true), 700); return () => clearTimeout(id); }, [bootstrap]);
  // Honour the OS "reduce motion" preference as the default; the in-app switch can still override it.
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (on) set({ reducedMotion: true }); }).catch(() => {}); }, [set]);
  useEffect(() => { if (status === 'out') queryClient.clear(); }, [status]);
  // "Today" (check-ins, Kaizen, sleep) follows the phone's own timezone.
  useEffect(() => {
    if (status !== 'in') return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) api('/me', { method: 'PATCH', body: { timezone } }).catch(() => {});
  }, [status]);

  if (status === 'loading' || !hydrated || !minSplash || !(fontsLoaded || fontError)) return <Splash />;
  const base = isDark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer ref={navRef} onReady={syncRoute} onStateChange={syncRoute} theme={{ ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, primary: c.primary, border: c.border } }}>
      <RootNavigator />
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {status === 'in' ? <SuggestionBridge /> : null}
      <GuideHost enabled={status === 'in'} routeName={routeName} onNavigate={(name, params) => { if (navRef.isReady()) navRef.navigate(name, params); }} onEmergency={() => { if (navRef.isReady()) navRef.navigate('Emergency'); }} />
    </NavigationContainer>
  );
}

function useHydrated() {
  const [h, setH] = useState(useSettings.persist.hasHydrated());
  useEffect(() => useSettings.persist.onFinishHydration(() => setH(true)), []);
  return h;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <LockGate>
          <Root />
        </LockGate>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
