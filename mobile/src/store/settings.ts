import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';
export type UiLang = 'en' | 'bn' | 'hi' | 'ne';

export interface SettingsState {
  theme: ThemeMode;
  fontScale: 1 | 1.15 | 1.3;
  reducedMotion: boolean;
  uiLang: UiLang;
  ttsMuted: boolean;
  /** Use server-made neural speech (much clearer Bangla) instead of the phone's built-in voice. */
  naturalVoice: boolean;
  reminderEnabled: boolean;
  reminderHour: number;
  onboarded: boolean;
  /** Engagement reminders; times are minutes since midnight. */
  remMorningOn: boolean; remMorningAt: number;
  remEveningOn: boolean; remEveningAt: number;
  remBedOn: boolean; remBedAt: number;
  quietOn: boolean; quietStart: number; quietEnd: number;
  gentleReturn: boolean;
  /** Epoch ms of the last app open (for the gentle-return notice). */
  lastOpenAt: number;
  /** App lock (the passcode hash itself lives in secure-store, never here). */
  lockEnabled: boolean;
  /** Seconds in background before locking: 0, 30, 60 or 300. */
  lockAfter: number;
  /** Anonymous usage analytics; off until the user explicitly opts in. */
  analyticsOptIn: boolean;
  /** Last way a sitting was held, per program id. Missing = text. */
  sittingModes: Record<string, 'TEXT' | 'VOICE' | 'VIDEO'>;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system', fontScale: 1, reducedMotion: false, uiLang: 'en', ttsMuted: false, naturalVoice: true,
      reminderEnabled: false, reminderHour: 20, onboarded: false, analyticsOptIn: false, sittingModes: {},
      remMorningOn: false, remMorningAt: 8 * 60, remEveningOn: false, remEveningAt: 20 * 60, remBedOn: false, remBedAt: 22 * 60,
      quietOn: false, quietStart: 22 * 60, quietEnd: 7 * 60, gentleReturn: false, lastOpenAt: 0, lockEnabled: false, lockAfter: 30,
      set: (patch) => set(patch),
    }),
    {
      name: 'settings-v1', storage: createJSONStorage(() => AsyncStorage), version: 2,
      // v2: the 3-day return notice is off unless the person turns it on themselves (it used to be on by default).
      migrate: (state, version) => (version < 2 ? { ...(state as object), gentleReturn: false } : state) as SettingsState,
    },
  ),
);
