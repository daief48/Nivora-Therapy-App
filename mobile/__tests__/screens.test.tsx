import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
let mockParams: any = undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => ({ record: jest.fn(), stop: jest.fn(), uri: null }),
}));
let mockSessions: any = { isLoading: false, isError: false, data: [] };
const mockMutate = jest.fn(async () => ({}));
jest.mock('../src/api/hooks', () => ({
  useSessions: () => mockSessions,
  useConsents: () => ({ data: [] }),
  useMoods: () => ({ isLoading: false, isError: false, data: [], error: null, refetch: jest.fn() }),
  useGoals: () => ({ isLoading: false, isError: false, data: [], error: null, refetch: jest.fn() }),
  useInvalidatingMutation: () => ({ mutateAsync: mockMutate, mutate: jest.fn(), isPending: false }),
  errorMessageKey: () => 'errorTitle',
}));

import { ExerciseScreen } from '../src/screens/ExerciseScreen';
import { JournalEditScreen } from '../src/screens/JournalScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { useSettings } from '../src/store/settings';

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockMutate.mockClear(); mockParams = undefined;
  mockSessions = { isLoading: false, isError: false, data: [] };
});

describe('Progress tab', () => {
  it('switches between mood and goals', async () => {
    await render(wrap(<ProgressScreen />));
    expect(screen.getByRole('tab', { name: 'Mood', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save check-in' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Goals' }));
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeTruthy();
    expect(screen.getByText('No goals yet. Add one when you are ready.')).toBeTruthy();
  });
});

describe('Journal editor', () => {
  it('offers a writing prompt that can be inserted, and marks the entry private', async () => {
    await render(wrap(<JournalEditScreen />));
    expect(screen.getByText('Private · encrypted')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use this prompt' }));
    expect(screen.getByLabelText('Write freely…').props.value).toMatch(/\?/);
  });
});

describe('Guided exercises', () => {
  it('grounding shows step progress and moves through the five senses', async () => {
    mockParams = { kind: 'grounding' };
    await render(wrap(<ExerciseScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Begin' }));
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    expect(screen.getByText('5 things you can see')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
  });

  it('a thought record is one question per step, skippable, and nothing is saved if left empty', async () => {
    mockParams = { kind: 'gratitude' };
    await render(wrap(<ExerciseScreen />));
    expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Well done. That is enough for now.')).toBeTruthy();
  });

  it('saves to the journal only after the user writes something and confirms', async () => {
    mockParams = { kind: 'gratitude' };
    await render(wrap(<ExerciseScreen />));
    await fireEvent.changeText(screen.getByLabelText(/What is one thing that went okay/), 'a warm cup of tea');
    await fireEvent.press(screen.getByRole('button', { name: 'Save to my journal' }));
    expect(mockMutate).toHaveBeenCalledWith(expect.stringContaining('a warm cup of tea'));
  });
});
