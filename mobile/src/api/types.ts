export type Locale = 'en' | 'bn' | 'mixed';
export interface Me {
  id: string; email: string; locale: Locale; timezone: string; displayName: string; countryCode: string | null;
  preferences: Record<string, string | number | boolean>;
}
export interface Resource {
  countryCode: string; resourceType: string; name: string; contactDetails: string; language: string; verified: boolean;
}
export interface SafetyInfo { severity: 'NONE' | 'ELEVATED' | 'HIGH' | 'IMMINENT'; crisis: boolean; resources: Resource[] }
export interface ChatMessage {
  id: string; role: 'user' | 'assistant'; content: string; createdAt?: string; feedback?: number | null; crisis?: boolean; failed?: boolean;
}
export interface SendResult { message: { id: string; role: 'assistant'; content: string; createdAt: string }; safety: SafetyInfo }
export interface SessionItem {
  id: string; sessionType: 'TEXT' | 'VOICE'; language: Locale; status: 'ACTIVE' | 'ENDED'; startedAt: string; endedAt: string | null;
  hasSummary?: boolean; messageCount?: number;
}
export interface SessionDetail extends SessionItem { messages: ChatMessage[] }
export interface MoodEntry { id: string; moodScore: number; stressScore: number | null; note: string | null; createdAt: string; source: 'user_reported' }
export interface JournalEntry { id: string; entryType: string; content: string; createdAt: string; updatedAt: string }
export interface GoalCheckIn { id: string; progressValue: number; note: string | null; createdAt: string }
export interface Goal { id: string; title: string; status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'; targetDate: string | null; createdAt: string; checkIns: GoalCheckIn[] }
export interface Consent { id: string; consentType: string; consentVersion: string; grantedAt: string; withdrawnAt: string | null }
export interface Device { id: string; userAgent: string | null; lastActiveAt: string; current: boolean }

// ---- Nivora ----
export type CheckInKind = 'MORNING' | 'EVENING';
export interface CheckInSafety { severity: string; crisis: boolean; resources?: Resource[]; message?: string | null }
export interface CheckIn {
  id: string; kind: CheckInKind; mood: number; stress: number; energy: number; sleepQuality: string | null; rested: number | null;
  worry: string | null; note: string | null; createdAt: string; safety?: CheckInSafety;
}
export interface ScoreBreakdown { score: number; parts: Record<'duration' | 'consistency' | 'awakenings' | 'quality' | 'routine', number>; max: Record<'duration' | 'consistency' | 'awakenings' | 'quality' | 'routine', number> }
export interface SleepEntry { id: string; date: string; bedtime: string; wakeTime: string; durationMin: number; latencyMin: number; awakenings: number; rested: number; score: number; note: string | null }
export interface SleepList { entries: SleepEntry[]; breakdown: ScoreBreakdown | null }
export interface RoutineStep { id: string; at: string; kind: 'breathing' | 'reflection' | 'audio' | 'sleep'; minutes: number }
export interface Routine { desiredBedtime: string; tonightBedtime: string; steps: RoutineStep[]; stepsDone: number; stepsTotal: number }
export interface KaizenGoal { id: string; title: string; category: string; status: string; currentTarget: number; targetDirection: string | null }
export interface KaizenAction {
  id: string; goalId: string; date: string; title: string; description: string; targetValue: number; unit: string; difficulty: number; micro: boolean;
  status: 'PLANNED' | 'DONE' | 'PARTIAL' | 'SKIPPED'; difficultyFeedback: string | null; reflected: boolean; message?: string;
  feltLevel: number | null; usefulness: number | null; nextPreference: string | null;
}
export interface KaizenProgress {
  completed: number; stage: 'SEED' | 'GROWING' | 'GROWING_STRONG' | 'FLOURISHING'; restarts: number; total: number;
  week: { date: string; status: string | null }[]; consistency7: number;
}
export interface KaizenToday { needsGoal: boolean; goal: KaizenGoal | null; action: KaizenAction | null; progress: KaizenProgress }
export interface DayPoint { date: string; checkIns: number; mood: number | null; stress: number | null; energy: number | null; sleepScore: number | null; sleepHours: number | null; kaizen: string | null; micro: boolean }
export interface Trend { avg: number | null; change: number | null }
export interface Summary {
  checkInsLast7: number; mood: Trend; stress: Trend; energy: Trend;
  sleep: Trend & { avgScore: number | null; nights: number; bedtimeSpreadMin: number | null };
  kaizen: { doneLast7: number; donePrev7: number; restarts: number; totalCompleted: number };
}
export interface Plan { focus: string; kaizenActionId: string | null; bedtime: string; items: { id: string; time: string; done: boolean; title: string }[]; note: string | null }
export interface MemoryItem { id: string; text: string; source: string; createdAt: string }
