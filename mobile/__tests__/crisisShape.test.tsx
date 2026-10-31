import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: [string, any]) => mockApi(...a) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: undefined }),
}));
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => ({ record: jest.fn(), stop: jest.fn(), uri: null }),
}));

import { ApiError } from '../src/api/client';
import { isAlreadyCompleted, isCrisisShape, noteCrisis } from '../src/api/crisisShape';
import { useAnalyticsOptIn } from '../src/api/aiSettings';
import { TodayFeed } from '../src/components/TodayFeed';
import { resetGuideForTests, useGuide } from '../src/guide/guideEngine';
import { bn, en, hi, ne } from '../src/i18n/ext/crisisshape';
import { JournalEditScreen } from '../src/screens/JournalScreen';
import { KaizenScreen } from '../src/screens/KaizenScreen';
import { MoodPanel } from '../src/screens/MoodScreen';
import { SleepDiaryScreen } from '../src/screens/SleepScreens';
import { useSettings } from '../src/store/settings';

const safety = { severity: 'HIGH', crisis: true, resources: [{ name: 'Local line', contactDetails: '999' }], message: 'You are not alone. Please reach out now.' };
const crisisBody = { crisis: true, entry: null, emotions: null, safety };
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

beforeEach(() => {
  resetGuideForTests();
  useSettings.setState({ reducedMotion: true, uiLang: 'en', analyticsOptIn: false } as never);
  mockNavigate.mockClear(); mockGoBack.mockClear(); mockApi.mockClear();
  mockHandler = () => null;
});

describe('crisis shape helpers', () => {
  it('recognises the shape tolerantly and raises the sticky guide risk signal', () => {
    expect(isCrisisShape(null)).toBe(false);
    expect(isCrisisShape({ id: 'x', crisis: false })).toBe(false);
    expect(noteCrisis({ score: 80 })).toBeNull();
    expect(useGuide.getState().riskSources.textsave).toBeFalsy();
    const c = noteCrisis({ crisis: true, safety: { message: 'm' } });
    expect(c?.safety.resources).toEqual([]);
    expect(useGuide.getState().riskSources.textsave).toBe(true);
  });
  it('knows ALREADY_COMPLETED', () => {
    expect(isAlreadyCompleted(new ApiError(409, 'ALREADY_COMPLETED', 'x'))).toBe(true);
    expect(isAlreadyCompleted(new Error('x'))).toBe(false);
  });
  it('has every string in all four languages', () => {
    for (const d of [bn, hi, ne]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
  });
});

describe('journal text save in the crisis shape', () => {
  it('shows support, keeps the draft, never goes back, and Emergency works', async () => {
    mockHandler = (path, opts) => (path === '/journal' && opts?.method === 'POST' ? crisisBody : null);
    await render(wrap(<JournalEditScreen />));
    await fireEvent.changeText(await screen.findByLabelText('Write freely…'), 'my private words');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('You are not alone. Please reach out now.')).toBeTruthy();
    expect(screen.getByText('999')).toBeTruthy();
    expect(screen.getByDisplayValue('my private words')).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(useGuide.getState().riskSources.textsave).toBe(true);
    await fireEvent.press(screen.getByText('Emergency help'));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
    await fireEvent.press(screen.getByText('Keep writing'));
    expect(screen.queryByTestId('crisis-notice')).toBeNull();
    expect(screen.getByDisplayValue('my private words')).toBeTruthy();
  });
  it('a normal save still goes back', async () => {
    mockHandler = (path, opts) => (path === '/journal' && opts?.method === 'POST' ? { crisis: false, entry: { id: 'e1' } } : null);
    await render(wrap(<JournalEditScreen />));
    await fireEvent.changeText(await screen.findByLabelText('Write freely…'), 'hello');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });
});

describe('mood and sleep notes in the crisis shape', () => {
  it('mood: keeps the note, no saved message', async () => {
    mockHandler = (path, opts) => (path === '/moods' && opts?.method === 'POST' ? { crisis: true, safety } : path.startsWith('/moods') ? [] : null);
    await render(wrap(<MoodPanel />));
    await fireEvent.changeText(screen.getByLabelText('Note (optional, private)'), 'heavy note');
    // pick a mood so Save is enabled
    const buttons = screen.getAllByRole('button');
    await fireEvent.press(buttons.find((b) => /3/.test(String(b.props.accessibilityLabel ?? ''))) ?? buttons[2]!);
    await fireEvent.press(screen.getByText('Save check-in'));
    expect(await screen.findByText('You are not alone. Please reach out now.')).toBeTruthy();
    expect(screen.queryByText('Saved. Thank you for checking in.')).toBeNull();
    expect(screen.getByDisplayValue('heavy note')).toBeTruthy();
    expect(useGuide.getState().riskSources.textsave).toBe(true);
  });
  it('sleep diary: shows support instead of the score and keeps the note', async () => {
    mockHandler = (path, opts) => (path === '/sleep' && opts?.method === 'POST' ? { crisis: true, safety } : null);
    await render(wrap(<SleepDiaryScreen />));
    await fireEvent.changeText(screen.getByLabelText('Note (optional)'), 'dark thoughts');
    await fireEvent.press(screen.getByText('Save sleep entry'));
    expect(await screen.findByText('You are not alone. Please reach out now.')).toBeTruthy();
    expect(screen.queryByText('Saved. Your sleep score is ready.')).toBeNull();
    expect(screen.getByDisplayValue('dark thoughts')).toBeTruthy();
  });
});

const kz = (over: Record<string, unknown> = {}) => ({
  needsGoal: false, goal: { id: 'g1', title: 'Move a little', category: 'SHORT_WALK' },
  action: { id: 'a1', goalId: 'g1', date: '2026-11-01', title: 'Stretch for 2 minutes', description: 'Easy.', targetValue: 2, unit: 'minutes', difficulty: 1, micro: false, status: 'PLANNED', difficultyFeedback: null, reflected: false, feltLevel: null, usefulness: null, nextPreference: null },
  progress: { completed: 3, stage: 'SEED', restarts: 0, total: 3, week: [], consistency7: 0 }, ...over,
});

describe('kaizen', () => {
  it('riskMode with action:null shows support options, not the first-goal prompt', async () => {
    mockHandler = (path) => (path === '/kaizen/today' ? { action: null, extras: [], riskMode: true, needsGoal: false, goal: null, progress: null } : null);
    await render(wrap(<KaizenScreen />));
    expect(await screen.findByTestId('support-options')).toBeTruthy();
    expect(screen.queryByText('Stretch for 2 minutes')).toBeNull();
  });
  it('409 ALREADY_COMPLETED on skip is a quiet no-op that refetches', async () => {
    mockHandler = (path, opts) => {
      if (path === '/kaizen/today') return kz();
      if (path === '/kaizen/actions/a1/complete') return new ApiError(409, 'ALREADY_COMPLETED', 'This step is already done');
      return opts?.method ? {} : null;
    };
    await render(wrap(<KaizenScreen />));
    await fireEvent.press(await screen.findByText('Not today'));
    const today = () => mockApi.mock.calls.filter((c) => c[0] === '/kaizen/today').length;
    await waitFor(() => expect(today()).toBeGreaterThan(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('a completion answered in the crisis shape shows support, not a success message', async () => {
    mockHandler = (path, opts) => {
      if (path === '/kaizen/today') return kz();
      if (path === '/kaizen/actions/a1/complete') return { crisis: true, safety };
      return opts?.method ? {} : null;
    };
    await render(wrap(<KaizenScreen />));
    await fireEvent.press(await screen.findByText('Not today'));
    expect(await screen.findByText('You are not alone. Please reach out now.')).toBeTruthy();
    expect(screen.queryByText('Step recorded')).toBeNull();
  });
});

describe('today feed resting flag', () => {
  it('honours the server resting flag even when quietNow is false', async () => {
    mockHandler = (path) => (path === '/today/feed' ? {
      date: '2026-11-01', quietNow: false, resting: true, snoozedUntil: null, plan: { focus: 'Stretch NOW', kaizenActionId: 'a1', tonightBedtime: '22:30', windDownAt: '21:45', morningCheckInDone: false },
      nudges: [], insights: [{ kind: 'SLEEP_TREND', title: 'Insight shown?', body: 'x', value: 1, reason: null }], lightDay: false, riskMode: false, order: [], suggestions: [],
    } : null);
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('Suggestions are resting. Nothing is needed from you.')).toBeTruthy();
    expect(screen.queryByText('Insight shown?')).toBeNull();
    expect(screen.queryByText('Stretch NOW')).toBeNull();
  });
});

describe('analytics opt-in writes both', () => {
  function Probe() {
    const a = useAnalyticsOptIn();
    const { Pressable, Text } = require('react-native');
    return <><Text>{`value:${a.value}`}</Text><Pressable accessibilityRole="button" onPress={() => a.set(!a.value)}><Text>toggle</Text></Pressable></>;
  }
  it('sets the local setting and PUTs /me/ai-settings; the server value is the source of truth', async () => {
    mockHandler = (path, opts) => (path === '/me/ai-settings' ? { suggestionLevel: 'SOMETIMES', analyticsOptIn: opts?.method === 'PUT' ? opts.body.analyticsOptIn : false } : null);
    useSettings.setState({ analyticsOptIn: true } as never); // local says on, server says off: server wins
    await render(wrap(<Probe />));
    await screen.findByText('value:false');
    await fireEvent.press(screen.getByText('toggle'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/me/ai-settings', { method: 'PUT', body: { analyticsOptIn: true } }));
    expect(useSettings.getState().analyticsOptIn).toBe(true);
    await screen.findByText('value:true');
  });
});
