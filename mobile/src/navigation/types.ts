import type { NavigationProp } from '@react-navigation/native';

export type ExerciseKind = 'thought' | 'balanced' | 'grounding' | 'breathing' | 'gratitude' | 'daily' | 'sleep' | 'goal' | 'next';

export type RootParams = {
  Welcome: undefined; SignUp: undefined; SignIn: undefined; Forgot: undefined;
  Tabs: undefined;
  CheckIn: { kind: 'MORNING' | 'EVENING' };
  SafetyPlan: undefined; Programs: undefined; ProgramDay: { programId: string; day?: number }; Sounds: undefined; Garden: undefined; Export: undefined; Reminders: undefined; Security: undefined;
  SleepDiary: undefined; Routine: undefined; AudioLibrary: undefined; Memory: undefined;
  Chat: { sessionId?: string; journalEntryId?: string } | undefined;
  Call: { mode: 'voice' | 'video'; sessionId?: string };
  History: undefined; SessionDetail: { id: string };
  Exercise: { kind: ExerciseKind };
  Wellness: undefined;
  JournalEdit: { id?: string } | undefined;
  Goals: undefined; Privacy: undefined; About: undefined;
  Emergency: undefined;
};
export type Nav = NavigationProp<RootParams>;
