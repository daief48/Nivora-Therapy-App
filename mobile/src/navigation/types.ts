import type { NavigationProp } from '@react-navigation/native';

export type ExerciseKind = 'thought' | 'balanced' | 'grounding' | 'breathing' | 'gratitude' | 'daily' | 'sleep' | 'goal' | 'next';

/** Options chosen in the session lobby and sent when a guided session is created. Omitted = open-ended, remembered (legacy behaviour). */
export interface SessionOpts { lengthMin?: 0 | 15 | 30 | 45; isIntake?: boolean; rememberThis?: boolean }

export type RootParams = {
  Welcome: undefined; SignUp: undefined; SignIn: undefined; Forgot: undefined;
  Tabs: undefined;
  CheckIn: { kind: 'MORNING' | 'EVENING' };
  SessionLobby: { mode?: 'text' | 'voice' | 'video'; topicId?: string } | undefined; Topics: undefined; TopicSessions: { topicId: string }; SessionSummary: { sessionId: string }; Sessions: undefined; Plan: undefined; Schedule: undefined; GuidedIntro: { next?: 'lobby' } | undefined; SessionData: undefined;
  SafetyPlan: undefined; Programs: undefined; ProgramDay: { programId: string; day?: number }; Sounds: undefined; Garden: undefined; Export: undefined; Reminders: undefined; Security: undefined;
  SleepDiary: undefined; Routine: undefined; AudioLibrary: undefined; Memory: undefined;
  Assessments: undefined; AssessmentTake: { instrument: 'PHQ9' | 'GAD7' | 'AUDIT' };
  AssessmentResult: { instrument: 'PHQ9' | 'GAD7' | 'AUDIT'; total: number; severity: string; item9Flag?: boolean };
  Chat: { sessionId?: string; journalEntryId?: string; opts?: SessionOpts } | undefined;
  Call: { mode: 'voice' | 'video'; sessionId?: string; opts?: SessionOpts };
  History: undefined; SessionDetail: { id: string };
  Exercise: { kind: ExerciseKind };
  Wellness: undefined;
  JournalEdit: { id?: string } | undefined;
  Goals: undefined; Privacy: undefined; About: undefined;
  Emergency: undefined;
};
export type Nav = NavigationProp<RootParams>;
