import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';
export type UiLang = 'en' | 'bn';

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
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system', fontScale: 1, reducedMotion: false, uiLang: 'en', ttsMuted: false, naturalVoice: true,
      reminderEnabled: false, reminderHour: 20, onboarded: false,
      set: (patch) => set(patch),
    }),
    { name: 'settings-v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
