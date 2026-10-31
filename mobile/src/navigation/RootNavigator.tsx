import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, useWindowDimensions } from 'react-native';
import { Icon, type IconName } from '../components/ui';
import { useT } from '../i18n';
import { useTH } from '../i18n/th';
import { HealthSyncScreen } from '../screens/HealthSyncScreen';
import { GuidedIntroScreen } from '../screens/GuidedIntroScreen';
import { PlanScreen } from '../screens/PlanScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { SessionDataScreen } from '../screens/SessionDataScreen';
import { SessionLobbyScreen } from '../screens/SessionLobbyScreen';
import { SessionSummaryScreen } from '../screens/SessionSummaryScreen';
import { SessionsScreen } from '../screens/SessionsScreen';
import { TopicsScreen } from '../screens/TopicsScreen';
import { TopicSessionsScreen } from '../screens/TopicSessionsScreen';
import { ExportScreen } from '../screens/ExportScreen';
import { GardenScreen } from '../screens/GardenScreen';
import { ProgramDayScreen } from '../screens/ProgramDayScreen';
import { ProgramsScreen } from '../screens/ProgramsScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { SafetyPlanScreen } from '../screens/SafetyPlanScreen';
import { SecurityScreen } from '../screens/SecurityScreen';
import { SoundsScreen } from '../screens/SoundsScreen';
import { CheckInScreen } from '../screens/CheckInScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { KaizenScreen } from '../screens/KaizenScreen';
import { MemoryScreen } from '../screens/MemoryScreen';
import { AssessmentsScreen } from '../screens/AssessmentsScreen';
import { AssessmentTakeScreen } from '../screens/AssessmentTakeScreen';
import { AssessmentResultScreen } from '../screens/AssessmentResultScreen';
import { AudioLibraryScreen, RoutineScreen, SleepDiaryScreen, SleepScreen } from '../screens/SleepScreens';
import { ActivitiesScreen } from '../screens/ActivitiesScreen';
import { NewSessionProgramScreen } from '../screens/NewSessionProgramScreen';
import { SessionProgramDetailScreen } from '../screens/SessionProgramDetailScreen';
import { SessionProgramsListScreen } from '../screens/SessionProgramsListScreen';
import { CallScreen } from '../screens/CallScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { EmergencyScreen } from '../screens/EmergencyScreen';
import { ExerciseScreen } from '../screens/ExerciseScreen';
import { GoalsScreen } from '../screens/GoalsScreen';
import { HistoryScreen, SessionDetailScreen } from '../screens/HistoryScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { JournalEditScreen } from '../screens/JournalScreen';
import { PrivacyScreen } from '../screens/PrivacyScreen';
import { AboutScreen, SettingsScreen } from '../screens/SettingsScreen';
import { ForgotScreen } from '../screens/auth/ForgotScreen';
import { SignInScreen } from '../screens/auth/SignInScreen';
import { SignUpScreen } from '../screens/auth/SignUpScreen';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { fontFor, layout, useTheme } from '../theme';
import type { RootParams } from './types';

const Stack = createNativeStackNavigator<RootParams>();

/** Consistent round back button for every header, with a safe fallback when there is no history (e.g. a refreshed web page). */
export function BackButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={onPress} hitSlop={8}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border, marginLeft: 8, marginRight: 6 }}>
      <Icon name="chevron-back" size={22} color={c.text} />
    </Pressable>
  );
}
const Tab = createBottomTabNavigator();

function Tabs() {
  const t = useT();
  const { c, lang } = useTheme();
  const { width } = useWindowDimensions();
  const reduced = useSettings((s) => s.reducedMotion);
  const wide = width >= layout.wideBreakpoint; // desktop web: sidebar instead of bottom bar
  const icon = (outline: IconName, filled: IconName) => ({ focused, color }: { focused: boolean; color: string }) => (
    <Icon name={focused ? filled : outline} size={24} color={color} />
  );
  return (
    <Tab.Navigator
      screenOptions={({ navigation, route }) => ({
        animation: reduced ? 'none' : 'fade',
        headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false, headerTintColor: c.text, headerTitleStyle: { fontFamily: fontFor(lang, 20, '700'), fontSize: 19 },
        headerLeft: route.name === 'HomeTab' ? undefined : () => <BackButton onPress={() => navigation.navigate('HomeTab')} />,
        tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fontFor(lang, 11, '700') },
        ...(wide
          ? { tabBarPosition: 'left' as const, tabBarVariant: 'material' as const, tabBarStyle: { backgroundColor: c.card, borderRightColor: c.border }, headerShown: false }
          : { tabBarStyle: { backgroundColor: c.card, borderTopWidth: 0, height: 72, paddingTop: 6, paddingBottom: 8, boxShadow: '0 -8px 26px rgba(120,84,96,0.10)' } }),
      })}>
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: t('appName'), tabBarLabel: t('tabHome'), tabBarIcon: icon('home-outline', 'home'), headerShown: false }} />
      <Tab.Screen name="SessionsTab" component={SessionProgramsListScreen} options={{ title: t('spTitle'), tabBarLabel: t('spTab'), tabBarIcon: icon('calendar-outline', 'calendar-outline') }} />
      <Tab.Screen name="SleepTab" component={SleepScreen} options={{ title: t('sleepTitle'), tabBarLabel: t('tabSleep'), tabBarIcon: icon('moon-outline', 'moon-outline') }} />
      <Tab.Screen name="KaizenTab" component={KaizenScreen} options={{ title: t('kzTitle'), tabBarLabel: t('tabKaizen'), tabBarIcon: icon('leaf-outline', 'leaf-outline') }} />
      <Tab.Screen name="InsightsTab" component={InsightsScreen} options={{ title: t('inTitle'), tabBarLabel: t('tabInsights'), tabBarIcon: icon('stats-chart-outline', 'stats-chart') }} />
      <Tab.Screen name="ProfileTab" component={SettingsScreen} options={{ title: t('profileTitle'), tabBarLabel: t('tabProfile'), tabBarIcon: icon('person-outline', 'person') }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const t = useT();
  const th = useTH();
  const { c, lang } = useTheme();
  const reduced = useSettings((s) => s.reducedMotion);
  const status = useAuth((s) => s.status);
  return (
    <Stack.Navigator screenOptions={({ navigation }) => ({ animation: reduced ? 'none' : 'slide_from_right', animationDuration: 300, gestureEnabled: true, fullScreenGestureEnabled: true, headerBackVisible: false, headerLeft: () => <BackButton onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate(status === 'in' ? 'Tabs' : 'Welcome'))} />, headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false, headerTintColor: c.text, headerTitleStyle: { fontFamily: fontFor(lang, 20, '700'), fontSize: 19 }, contentStyle: { backgroundColor: c.bg }, headerBackTitle: t('back') })}>
      {status === 'in' ? (
        <>
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={{ title: t('spSittingTitle') }} />
          <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false }} />
          <Stack.Screen name="NewProgram" component={NewSessionProgramScreen} options={{ title: t('spWizTitle') }} />
          <Stack.Screen name="ProgramDetail" component={SessionProgramDetailScreen} options={{ title: t('spTitle') }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: t('historyTitle') }} />
          <Stack.Screen name="SessionDetail" component={SessionDetailScreen} options={{ title: t('chatTitle') }} />
          <Stack.Screen name="Wellness" component={ActivitiesScreen} options={{ title: t('wellnessTitle') }} />
          <Stack.Screen name="Exercise" component={ExerciseScreen} options={{ title: t('wellnessTitle') }} />
          <Stack.Screen name="JournalEdit" component={JournalEditScreen} options={{ title: t('journalTitle') }} />
          <Stack.Screen name="CheckIn" component={CheckInScreen} options={({ route }) => ({ title: t(route.params.kind === 'MORNING' ? 'ciMorningTitle' : 'ciEveningTitle') })} />
          <Stack.Screen name="SessionLobby" component={SessionLobbyScreen} options={{ title: t('rowSessions') }} />
          <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} options={{ title: t('rowSessions') }} />
          <Stack.Screen name="Sessions" component={SessionsScreen} options={{ title: t('rowSessions') }} />
          <Stack.Screen name="Topics" component={TopicsScreen} options={{ title: t('topicsTitle') }} />
          <Stack.Screen name="TopicSessions" component={TopicSessionsScreen} options={{ title: t('topicsTitle') }} />
          <Stack.Screen name="Plan" component={PlanScreen} options={{ title: t('rowPlan') }} />
          <Stack.Screen name="HealthSync" component={HealthSyncScreen} options={{ title: th('thHealthTitle') }} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} options={{ title: t('rowSchedule') }} />
          <Stack.Screen name="GuidedIntro" component={GuidedIntroScreen} options={{ title: t('rowGuidedIntro') }} />
          <Stack.Screen name="SessionData" component={SessionDataScreen} options={{ title: t('rowSessionData') }} />
          <Stack.Screen name="SafetyPlan" component={SafetyPlanScreen} options={{ title: t('rowSafetyPlan') }} />
          <Stack.Screen name="Programs" component={ProgramsScreen} options={{ title: t('tilePrograms') }} />
          <Stack.Screen name="ProgramDay" component={ProgramDayScreen} options={{ title: t('tilePrograms') }} />
          <Stack.Screen name="Sounds" component={SoundsScreen} options={{ title: t('tileSounds') }} />
          <Stack.Screen name="Garden" component={GardenScreen} options={{ title: t('rowGarden') }} />
          <Stack.Screen name="Export" component={ExportScreen} options={{ title: t('rowExport') }} />
          <Stack.Screen name="Reminders" component={RemindersScreen} options={{ title: t('rowReminders') }} />
          <Stack.Screen name="Security" component={SecurityScreen} options={{ title: t('rowSecurity') }} />
          <Stack.Screen name="SleepDiary" component={SleepDiaryScreen} options={{ title: t('diaryTitle') }} />
          <Stack.Screen name="Routine" component={RoutineScreen} options={{ title: t('routineTitle') }} />
          <Stack.Screen name="AudioLibrary" component={AudioLibraryScreen} options={{ title: t('audioTitle') }} />
          <Stack.Screen name="Memory" component={MemoryScreen} options={{ title: t('memTitle') }} />
          <Stack.Screen name="Assessments" component={AssessmentsScreen} options={{ title: t('asTitle') }} />
          <Stack.Screen name="AssessmentTake" component={AssessmentTakeScreen} options={{ title: t('asTitle') }} />
          <Stack.Screen name="AssessmentResult" component={AssessmentResultScreen} options={{ title: t('asResultTitle') }} />
          <Stack.Screen name="Goals" component={GoalsScreen} options={{ title: t('goalsHeader') }} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: t('privacy') }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ title: t('aboutNivora') }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false, animation: reduced ? 'none' : 'fade' }} />
          <Stack.Screen name="SignUp" component={SignUpScreen} options={{ title: t('signUp') }} />
          <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: t('signIn') }} />
          <Stack.Screen name="Forgot" component={ForgotScreen} options={{ title: t('resetTitle') }} />
        </>
      )}
      <Stack.Screen name="Emergency" component={EmergencyScreen} options={{ title: t('emergency'), presentation: 'modal', animation: reduced ? 'none' : 'fade_from_bottom' }} />
    </Stack.Navigator>
  );
}
