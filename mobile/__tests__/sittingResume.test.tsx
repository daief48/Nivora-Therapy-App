import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

// Pause / resume of a program sitting: leaving only pauses, the card says "Continue · N min left", finishing early is deliberate.
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockGoBack = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true, dispatch: mockDispatch }),
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

let mockConv: any;
jest.mock('../src/hooks/useConversation', () => ({ useConversation: () => mockConv }));

import { ChatScreen } from '../src/screens/ChatScreen';
import { SessionProgramDetailScreen } from '../src/screens/SessionProgramDetailScreen';
import { SessionProgramsListScreen } from '../src/screens/SessionProgramsListScreen';
import { useSettings } from '../src/store/settings';

const apiError = (code: string, details?: object) => Object.assign(new Error(code), { code, status: 409, details });
const prog = (over: object = {}) => ({
  id: 'p1', title: 'Calmer evenings', goal: null, topic: { id: 't1', kind: 'SLEEP', label: null }, status: 'ACTIVE',
  plannedDays: 14, dailyMinutes: 30, reminderTimeMin: null, completedSittings: 2, currentDay: 3, progressPct: 14,
  todayState: 'READY', nextAvailableAt: null, lastSittingAt: new Date().toISOString(), moodTrend: [], startedAt: new Date().toISOString(),
  activeSittingId: null, completedAt: null, ...over,
});
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>;
const state = (over: object = {}) => ({ phase: 'CORE', elapsedMin: 7, remainingMin: 23, phaseHint: 'hintCore', isIntake: false, moodBefore: null, remainingSec: 1380, endsAt: null, ...over });
const paused = { id: 's1', status: 'ACTIVE', paused: true, remainingSec: 1380, noteReady: false, summaryCreated: false };
const routes = (over: Record<string, unknown> = {}): Handler => (p, o) => {
  if (p in over) { const v = over[p]; return typeof v === 'function' ? (v as Handler)(p, o) : v; }
  if (p === '/me') return { displayName: 'A', locale: 'en' };
  if (p === '/sessions/s1/state') return state();
  if (p === '/session-programs') return [];
  return new Error('unmocked ' + p);
};
const conv = (over: object = {}) => ({
  sessionId: 's1', messages: [{ id: 'm1', role: 'user', content: 'hello again' }], busy: false, ended: false, errorKey: null, errorCode: null, cancelledText: null, reconnecting: false,
  crisisResources: null, loadingHistory: false, historyError: null, refetchHistory: jest.fn(), send: jest.fn(), cancel: jest.fn(), retry: jest.fn(), finish: jest.fn(async () => {}), remove: jest.fn(),
  ...over,
});
const endCalls = () => mockApi.mock.calls.filter((c) => /\/end$/.test(String(c[0])));

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en', sittingModes: {} });
  [mockNavigate, mockDispatch, mockGoBack, mockApi].forEach((m) => m.mockClear());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockParams = { sittingId: 's1', programId: 'p1' };
  mockConv = conv();
  mockHandler = routes({ '/sessions/s1/end': paused });
});
afterEach(() => alertSpy.mockRestore());

describe('Chat: leaving a sitting early only pauses it', () => {
  it('Pause for now asks the server not to force, then opens the program page with the minutes left, never the summary', async () => {
    await render(wrap(<ChatScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Pause for now/ }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
    expect(endCalls()[0]![1]!.body).toEqual({ summarize: false, force: false });
    expect(mockDispatch).toHaveBeenCalledWith({ name: 'ProgramDetail', params: { programId: 'p1', paused: true, savedMin: 23 } });
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'SessionSummary' }));
    expect(mockConv.finish).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('still leaves when the end request fails (best effort)', async () => {
    mockHandler = routes({ '/sessions/s1/end': () => new Error('offline') });
    await render(wrap(<ChatScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Pause for now/ }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
    const call = mockDispatch.mock.calls[0]![0];
    expect(call.name).toBe('ProgramDetail');
    expect(call.params).toMatchObject({ programId: 'p1', paused: true });
  });

  it('if the server did close the sitting (time used up) the summary opens, as that really is finished', async () => {
    mockHandler = routes({ '/sessions/s1/end': { id: 's1', status: 'ENDED', paused: false, remainingSec: 0 } });
    await render(wrap(<ChatScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Pause for now/ }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'SessionSummary', params: { sessionId: 's1', programId: 'p1' } }));
  });

  it("Finish today's sitting now needs a confirmation, then ends with force=true and opens the summary", async () => {
    await render(wrap(<ChatScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: "Finish today's sitting now" }));
    expect(mockConv.finish).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Finish today's sitting?", expect.stringMatching(/marked as done even though there is time left/), expect.any(Array));
    await act(async () => { alertSpy.mock.calls[0]![2].find((b: any) => b.text === 'Finish now').onPress(); });
    expect(mockConv.finish).toHaveBeenCalledWith(true, true);
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'SessionSummary', params: { sessionId: 's1', programId: 'p1' } }));
  });

  it('the back button (unmounting) neither ends nor force-ends the sitting', async () => {
    const view = await render(wrap(<ChatScreen />));
    await screen.findByRole('button', { name: /Pause for now/ });
    await view.unmount();
    expect(mockConv.finish).not.toHaveBeenCalled();
    expect(endCalls()).toEqual([]);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('a distressed person keeps the plain End flow: no pause button, End session works with no extra friction', async () => {
    mockConv = conv({ crisisResources: [{ id: 'r1' }] });
    await render(wrap(<ChatScreen />));
    expect(screen.queryByRole('button', { name: /Pause for now/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'End session' }));
    expect(alertSpy).toHaveBeenCalledWith('End session', expect.any(String), expect.any(Array));
    await act(async () => { alertSpy.mock.calls[0]![2].find((b: any) => b.text === 'End and summarize').onPress(); });
    expect(mockConv.finish).toHaveBeenCalledWith(true);
  });

  it('a resumed sitting shows the earlier messages and a Welcome back line with the minutes left', async () => {
    mockParams = { sittingId: 's1', programId: 'p1', resumed: true };
    await render(wrap(<ChatScreen />));
    expect(await screen.findByText('Welcome back · 23 min left')).toBeTruthy();
    expect(screen.getByText('hello again')).toBeTruthy();
  });
});

describe('Program cards and detail', () => {
  it('after a pause the card says "Continue · N min left" with the minutes used, and never "Done for today"', async () => {
    mockHandler = routes({ '/session-programs': [prog({ todayState: 'IN_PROGRESS', activeSittingId: 's1', remainingSec: 1380, usedMinutes: 7 })] });
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByRole('button', { name: /Continue · 23 min left/ })).toBeTruthy();
    expect(screen.getByText('7 of 30 min used today')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done for today' })).toBeNull();
  });

  it('IN_PROGRESS without the new fields (older server) falls back to the plain Continue label', async () => {
    mockHandler = routes({ '/session-programs': [prog({ todayState: 'IN_PROGRESS', activeSittingId: 's1' })] });
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByRole('button', { name: /Continue sitting/ })).toBeTruthy();
  });

  it('Done for today appears only when the server says DONE_TODAY', async () => {
    mockHandler = routes({ '/session-programs': [prog({ todayState: 'DONE_TODAY', usedMinutes: 30, nextAvailableAt: new Date(Date.now() + 3_600_000).toISOString() })] });
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByRole('button', { name: 'Done for today' })).toBeTruthy();
  });

  it("the detail page shows the saved line after a pause, and the used minutes on today's timeline row", async () => {
    mockParams = { programId: 'p1', paused: true, savedMin: 23 };
    mockHandler = routes({
      '/session-programs/p1': { ...prog({ todayState: 'IN_PROGRESS', activeSittingId: 's1', remainingSec: 1380, usedMinutes: 7 }), openHomework: [], planGoals: [], themes: [],
        timeline: [{ dayNumber: 3, date: null, status: 'TODAY', sittingId: 's1', durationMin: null, usedMinutes: 7, moodBefore: null, moodAfter: null, shortSummary: null }] },
    });
    await render(wrap(<SessionProgramDetailScreen />));
    expect(await screen.findByText('Saved. 23 min left today, continue anytime.')).toBeTruthy();
    expect(screen.getAllByText('7 of 30 min used today').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Continue · 23 min left/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done for today' })).toBeNull();
  });

  it('starting with resumed:true opens the same sitting in the chat marked as resumed', async () => {
    mockHandler = routes({
      '/session-programs': [prog()],
      '/session-programs/p1/sittings': { sittingId: 's1', dayNumber: 3, plannedMinutes: 30, isIntake: false, intakePart: null, endsAt: new Date().toISOString(), sessionType: 'TEXT', mode: 'TEXT', resumed: true },
    });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Start today's sitting/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's1', programId: 'p1', resumed: true }));
  });

  it('the legacy 409 SITTING_ALREADY_ACTIVE still resumes the existing sitting', async () => {
    mockHandler = routes({ '/session-programs': [prog()], '/session-programs/p1/sittings': () => apiError('SITTING_ALREADY_ACTIVE', { sittingId: 's7' }) });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Start today's sitting/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's7', programId: 'p1', resumed: true }));
  });
});
