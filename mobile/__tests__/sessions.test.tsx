import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true, dispatch: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ api: (...a: [string, any]) => mockApi(...a), ApiError: class extends Error {} }));

import { SessionBar } from '../src/components/SessionBar';
import { PlanScreen } from '../src/screens/PlanScreen';
import { SessionLobbyScreen } from '../src/screens/SessionLobbyScreen';
import { SessionSummaryScreen } from '../src/screens/SessionSummaryScreen';
import { useSettings } from '../src/store/settings';

const lobby = (over: object = {}) => ({
  needsIntake: false, lastSessionRecap: 'We talked about sleep.', openHomework: [{ id: 'h1', title: 'Wind-down walk' }],
  planGoals: [{ id: 'g1', title: 'Sleep more calmly' }], suggestedLengthMin: 30, guidedAck: true, continuityOptIn: true, ...over,
});
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockApi.mockClear(); mockParams = undefined;
  mockHandler = (path) => (path === '/me' ? { displayName: 'A', locale: 'en' } : new Error('unmocked ' + path));
});

describe('Session lobby', () => {
  it('shows the intake variant for a first session and says it is an AI companion', async () => {
    mockHandler = (p, o) => (p === '/sessions/lobby' ? lobby({ needsIntake: true, planGoals: [], openHomework: [], lastSessionRecap: null }) : p === '/me' ? { locale: 'en' } : o);
    await render(wrap(<SessionLobbyScreen />));
    expect(await screen.findByText("Let's get to know you")).toBeTruthy();
    expect(screen.getByText('First session')).toBeTruthy();
    expect(screen.getByText(/AI companion/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start getting to know each other' })).toBeTruthy();
  });

  it('creates the session with the chosen length, memory choice and mood, then opens the chat', async () => {
    mockHandler = (p, o) => (p === '/sessions/lobby' ? lobby() : p === '/me' ? { locale: 'en' } : p === '/sessions' ? { id: 's1' } : new Error(p + o?.method));
    await render(wrap(<SessionLobbyScreen />));
    expect(await screen.findByText('We talked about sleep.')).toBeTruthy();
    expect(screen.getByText('Sleep more calmly')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '45 min' }));
    await fireEvent(screen.getByLabelText("Don't remember this session"), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sessionId: 's1' }));
    const call = mockApi.mock.calls.find((c) => c[0] === '/sessions' && c[1]?.method === 'POST')!;
    expect(call[1]!.body).toMatchObject({ sessionType: 'TEXT', lengthMin: 45, isIntake: false, rememberThis: false });
    expect(call[1]!.body.moodBefore).toBeUndefined();
  });

  it('has no voice or video choice, hides the recap when continuity is off, and starts a text chat', async () => {
    mockHandler = (p) => (p === '/sessions/lobby' ? lobby({ continuityOptIn: false }) : p === '/me' ? { locale: 'en' } : { id: 's2' });
    await render(wrap(<SessionLobbyScreen />));
    expect(await screen.findByText(/Recall of earlier sessions is off/)).toBeTruthy();
    expect(screen.queryByText('We talked about sleep.')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Video' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Voice' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sessionId: 's2' }));
  });

  it('sends people to the introduction first when it has not been acknowledged', async () => {
    mockHandler = (p) => (p === '/sessions/lobby' ? lobby({ guidedAck: false }) : { locale: 'en' });
    await render(wrap(<SessionLobbyScreen />));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('GuidedIntro', { next: 'lobby' }));
  });
});

describe('Session summary', () => {
  const detail = (over: object = {}) => ({
    sessionId: 's1', startedAt: new Date().toISOString(), endedAt: null, sessionType: 'TEXT', lengthMin: 30, isIntake: false, moodBefore: 4, moodAfter: null,
    themes: [], summary: null, homeworkCount: 0, finalized: true, note: null, homework: [], ...over,
  });

  it('shows a soft preparing message while the note is not ready, then the summary once it is', async () => {
    jest.useFakeTimers();
    try {
      mockParams = { sessionId: 's1' };
      let n = 0;
      mockHandler = () => (++n < 2 ? detail() : detail({ note: { summary: 'You found a calmer evening routine.', keyInsights: ['Small steps help'], themes: ['sleep'] }, homework: [{ id: 'h9', title: 'Stretch for two minutes', status: 'ASSIGNED' }] }));
      await render(wrap(<SessionSummaryScreen />));
      expect(await screen.findByText('Preparing your summary. This can take a moment.')).toBeTruthy();
      await act(async () => { await jest.advanceTimersByTimeAsync(3100); });
      expect(await screen.findByText('You found a calmer evening routine.')).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Stretch for two minutes' })).toBeTruthy();
      expect(screen.getByText('Small steps help')).toBeTruthy();
    } finally { jest.useRealTimers(); }
  });

  it('says plainly when a session was not remembered', async () => {
    mockParams = { sessionId: 's1' };
    mockHandler = () => detail({ rememberThis: false });
    await render(wrap(<SessionSummaryScreen />));
    expect(await screen.findByText('This session was not remembered. Nothing was saved, as you asked.')).toBeTruthy();
    expect(screen.queryByText('How are you feeling now?')).toBeNull();
  });
});

describe('SessionBar', () => {
  it('renders nothing without a session id', async () => {
    const { toJSON } = await render(wrap(<SessionBar />));
    expect(toJSON()).toBeNull();
  });

  it('shows elapsed and remaining time with a gentle hint', async () => {
    mockHandler = () => ({ phase: 'CORE', elapsedMin: 12.4, remainingMin: 17.6, phaseHint: 'hintCore', isIntake: false, moodBefore: null });
    await render(wrap(<SessionBar sessionId="s1" />));
    expect(await screen.findByLabelText(/12 min so far · about 18 min left/)).toBeTruthy();
    expect(screen.getByText(/Exploring together/)).toBeTruthy();
  });

  it('hides itself when the request fails', async () => {
    mockHandler = () => new Error('boom');
    const { toJSON } = await render(wrap(<SessionBar sessionId="s1" />));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(toJSON()).toBeNull();
  });
});

describe('Plan', () => {
  it('lets the user edit a goal and saves a new version with PUT', async () => {
    const plan = { goals: [{ id: 'g1', title: 'Sleep better' }], focusAreas: ['sleep'], approach: 'MIXED', pace: 'GENTLE', tone: 'WARM', language: 'en' };
    mockHandler = (p, o) => (p === '/therapy/plan' ? (o?.method === 'PUT' ? {} : { plan, version: 2, history: [] }) : { locale: 'en' });
    await render(wrap(<PlanScreen />));
    expect(await screen.findByText(/only shapes how sessions go/)).toBeTruthy();
    const input = await screen.findByDisplayValue('Sleep better');
    await fireEvent.changeText(input, 'Sleep better and worry less');
    await fireEvent.press(screen.getByRole('tab', { name: 'Steady' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(mockApi.mock.calls.some((c) => c[0] === '/therapy/plan' && c[1]?.method === 'PUT')).toBe(true));
    const put = mockApi.mock.calls.find((c) => c[0] === '/therapy/plan' && c[1]?.method === 'PUT')!;
    expect(put[1]!.body.goals[0].title).toBe('Sleep better and worry less');
    expect(put[1]!.body.pace).toBe('STEADY');
  });
});
