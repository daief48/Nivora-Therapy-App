import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true, dispatch: mockDispatch }),
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

import { SessionBar } from '../src/components/SessionBar';
import { useSettings } from '../src/store/settings';
import { ChatScreen } from '../src/screens/ChatScreen';
import { NewSessionProgramScreen } from '../src/screens/NewSessionProgramScreen';
import { SessionProgramDetailScreen } from '../src/screens/SessionProgramDetailScreen';
import { SessionProgramsListScreen } from '../src/screens/SessionProgramsListScreen';

const apiError = (code: string, details?: object) => Object.assign(new Error(code), { code, status: 409, details });
const prog = (over: object = {}) => ({
  id: 'p1', title: 'Calmer evenings', goal: 'Sleep more calmly', topic: { id: 't1', kind: 'SLEEP', label: null }, status: 'ACTIVE',
  plannedDays: 14, dailyMinutes: 30, reminderTimeMin: null, completedSittings: 2, currentDay: 3, progressPct: 14,
  todayState: 'READY', nextAvailableAt: null, lastSittingAt: new Date().toISOString(), moodTrend: [], startedAt: new Date().toISOString(),
  activeSittingId: null, completedAt: null, ...over,
});
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>
);
const routes = (over: Record<string, unknown> = {}): Handler => (p, o) => {
  if (p in over) { const v = over[p]; return typeof v === 'function' ? (v as Handler)(p, o) : v; }
  if (p === '/me') return { displayName: 'A', locale: 'en' };
  if (p === '/session-programs') return o?.method === 'POST' ? prog() : [];
  if (p === '/therapy/sessions') return [];
  if (p === '/topics') return [{ id: 't1', kind: 'SLEEP', label: null, createdAt: '', sessionCount: 0, lastSessionAt: null }];
  return new Error('unmocked ' + p);
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockDispatch.mockClear(); mockApi.mockClear(); mockParams = undefined;
  useSettings.setState({ sittingModes: {} });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockHandler = routes();
});
afterEach(() => alertSpy.mockRestore());

describe('Sessions tab (programs list)', () => {
  it('lists programs with topic, day count and a start button, and offers no standalone chat, voice or video entry', async () => {
    mockHandler = routes({ '/session-programs': [prog({ availableModes: ['TEXT', 'VOICE', 'VIDEO'] })] });
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByText('Calmer evenings')).toBeTruthy();
    expect(screen.getByText('Day 3 of 14')).toBeTruthy();
    expect(screen.getByLabelText('Topic: Sleep')).toBeTruthy();
    expect(screen.getByLabelText('2 of 14 sittings done')).toBeTruthy();
    for (const name of [/Text chat/, /Voice/, /Video/, /Talk to Nivora/]) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('Call', expect.anything());
    expect(mockNavigate).not.toHaveBeenCalledWith('Chat', expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Create a new session program' }));
    expect(mockNavigate).toHaveBeenCalledWith('NewProgram');
  });

  it('shows an empty state and keeps earlier standalone sessions under "Earlier sessions"', async () => {
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByText('No sessions yet')).toBeTruthy();
    expect(screen.queryByText('Earlier sessions')).toBeNull();
    mockHandler = routes({
      '/therapy/sessions': [
        { sessionId: 'old1', startedAt: new Date().toISOString(), summary: 'We talked about work.', programId: null },
        { sessionId: 'sit1', startedAt: new Date().toISOString(), summary: 'A sitting', programId: 'p1', dayNumber: 1 },
      ],
    });
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByText('Earlier sessions')).toBeTruthy();
    expect(screen.getByText('We talked about work.')).toBeTruthy();
    expect(screen.queryByText('A sitting')).toBeNull();
  });

  it('welcomes people back gently after a few days away, with no streak wording', async () => {
    mockHandler = routes({ '/session-programs': [prog({ lastSittingAt: new Date(Date.now() - 5 * 86_400_000).toISOString() })] });
    await render(wrap(<SessionProgramsListScreen />));
    expect(await screen.findByText(/Welcome back/)).toBeTruthy();
    expect(screen.queryByText(/streak/i)).toBeNull();
  });

  it('starts today\'s sitting and opens the chat with the sitting id', async () => {
    mockHandler = routes({
      '/session-programs': [prog()],
      '/session-programs/p1/sittings': { sittingId: 's9', dayNumber: 3, plannedMinutes: 30, isIntake: false, intakePart: null, endsAt: new Date().toISOString(), sessionType: 'TEXT' },
    });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Start today's sitting/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's9', programId: 'p1' }));
    const post = mockApi.mock.calls.find((c) => c[0] === '/session-programs/p1/sittings')!;
    expect(post[1]!.method).toBe('POST');
    expect(post[1]!.body.language).toBe('en');
    expect(post[1]!.body.mode).toBe('TEXT');
  });

  it('DONE_TODAY disables Start and shows when the next sitting opens', async () => {
    mockHandler = routes({ '/session-programs': [prog({ todayState: 'DONE_TODAY', nextAvailableAt: new Date(Date.now() + 3_600_000).toISOString() })] });
    await render(wrap(<SessionProgramsListScreen />));
    const btn = await screen.findByRole('button', { name: 'Done for today' });
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Start today's sitting/ })).toBeNull();
    expect(screen.getByText(/Next sitting from/)).toBeTruthy();
    await fireEvent.press(btn);
    expect(mockApi.mock.calls.some((c) => String(c[0]).endsWith('/sittings'))).toBe(false);
  });

  it('handles 409 ALREADY_DONE_TODAY with a friendly message, and resumes on SITTING_ALREADY_ACTIVE', async () => {
    mockHandler = routes({
      '/session-programs': [prog()],
      '/session-programs/p1/sittings': () => apiError('ALREADY_DONE_TODAY', { nextAvailableAt: new Date(Date.now() + 3_600_000).toISOString() }),
    });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Start today's sitting/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(String(alertSpy.mock.calls[0]![0])).toMatch(/already had today's sitting.*Next sitting from/);

    alertSpy.mockClear();
    mockHandler = routes({ '/session-programs': [prog()], '/session-programs/p1/sittings': () => apiError('SITTING_ALREADY_ACTIVE', { sittingId: 's7' }) });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Start today's sitting/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's7', programId: 'p1' }));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('explains MODE_DISABLED kindly', async () => {
    mockHandler = routes({ '/session-programs': [prog()], '/session-programs/p1/sittings': () => Object.assign(apiError('MODE_DISABLED'), { status: 400 }) });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Start today's sitting/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Voice and video are not available. Text sittings are.'));
  });

  it('is translated in Bangla, Hindi and Nepali', async () => {
    mockHandler = routes({ '/session-programs': [prog()] });
    for (const [lang, title] of [['bn', 'আপনার সেশন'], ['hi', 'आपके सेशन'], ['ne', 'तपाईंका सेसनहरू']] as const) {
      useSettings.setState({ uiLang: lang });
      await render(wrap(<SessionProgramsListScreen />));
      expect((await screen.findAllByText(title)).length).toBeGreaterThan(0);
    }
  });
});

describe('Sitting mode picker', () => {
  const started = (over: object = {}) => ({ sittingId: 's9', dayNumber: 3, plannedMinutes: 30, isIntake: false, intakePart: null, endsAt: new Date().toISOString(), sessionType: 'TEXT', mode: 'TEXT', ...over });
  const START = { name: /Start today's sitting/ };
  const bodyOf = (path: string) => mockApi.mock.calls.filter((c) => c[0] === path && c[1]?.method === 'POST').map((c) => c[1]!.body);
  const withModes = (modes: string[], over: object = {}) => prog({ availableModes: modes, ...over });

  it('is skipped when only text is available', async () => {
    mockHandler = routes({ '/session-programs': [withModes(['TEXT'])], '/session-programs/p1/sittings': started() });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    expect(screen.queryByText('How would you like to talk today?')).toBeNull();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's9', programId: 'p1' }));
    expect(bodyOf('/session-programs/p1/sittings')[0]).toEqual({ language: 'en', mode: 'TEXT' });
  });

  it('shows exactly the available modes with icons-and-labels, and starts nothing until one is chosen', async () => {
    mockHandler = routes({ '/session-programs': [withModes(['TEXT', 'VOICE'])], '/session-programs/p1/sittings': started() });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    expect(screen.getByText('How would you like to talk today?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Text. Write what is on your mind' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voice. Talk out loud' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Video\./ })).toBeNull();
    expect(bodyOf('/session-programs/p1/sittings')).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('How would you like to talk today?')).toBeNull();
    expect(bodyOf('/session-programs/p1/sittings')).toEqual([]);
  });

  it('sends the chosen mode and opens the call for voice, with the sitting id', async () => {
    mockHandler = routes({ '/session-programs': [withModes(['TEXT', 'VOICE', 'VIDEO'])], '/session-programs/p1/sittings': started({ mode: 'VOICE', sessionType: 'VOICE' }) });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    await fireEvent.press(screen.getByRole('button', { name: /^Voice\./ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Call', { mode: 'voice', sittingId: 's9', programId: 'p1' }));
    expect(bodyOf('/session-programs/p1/sittings')[0]).toEqual({ language: 'en', mode: 'VOICE' });
    expect(mockNavigate).not.toHaveBeenCalledWith('Chat', expect.anything());
  });

  it('opens the video call for video, and the chat for text', async () => {
    mockHandler = routes({ '/session-programs': [withModes(['TEXT', 'VOICE', 'VIDEO'])], '/session-programs/p1/sittings': started({ mode: 'VIDEO' }) });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    await fireEvent.press(screen.getByRole('button', { name: /^Video\./ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Call', { mode: 'video', sittingId: 's9', programId: 'p1' }));
    expect(bodyOf('/session-programs/p1/sittings')[0].mode).toBe('VIDEO');

    mockNavigate.mockClear();
    mockHandler = routes({ '/session-programs': [withModes(['TEXT', 'VOICE', 'VIDEO'])], '/session-programs/p1/sittings': started() });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press((await screen.findAllByRole('button', START)).pop()!);
    await fireEvent.press(screen.getAllByRole('button', { name: /^Text\./ }).pop()!);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's9', programId: 'p1' }));
  });

  it('remembers the choice for that program', async () => {
    mockHandler = routes({ '/session-programs': [withModes(['TEXT', 'VOICE'])], '/session-programs/p1/sittings': started({ mode: 'VOICE' }) });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    expect(screen.getByRole('button', { name: /^Text./ }).props.accessibilityState.selected).toBe(true); // default is text
    await fireEvent.press(screen.getByRole('button', { name: /^Voice./ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Call', expect.anything()));
    expect(useSettings.getState().sittingModes).toEqual({ p1: 'VOICE' });
  });

  it('highlights the remembered choice the next time the picker opens', async () => {
    useSettings.setState({ sittingModes: { p1: 'VOICE' } });
    mockHandler = routes({ '/session-programs': [withModes(['TEXT', 'VOICE'])] });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    expect(screen.getByRole('button', { name: /^Voice./ }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: /^Text./ }).props.accessibilityState.selected).toBe(false);
  });

  it('falls back to text with a kind message when the server turns the chosen mode off', async () => {
    let n = 0;
    mockHandler = routes({
      '/session-programs': [withModes(['TEXT', 'VOICE'])],
      '/session-programs/p1/sittings': () => (n++ === 0 ? Object.assign(apiError('MODE_DISABLED'), { status: 400 }) : started()),
    });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    await fireEvent.press(screen.getByRole('button', { name: /^Voice\./ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Voice and video are not available. Text sittings are.'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sittingId: 's9', programId: 'p1' }));
    expect(bodyOf('/session-programs/p1/sittings').map((b) => b.mode)).toEqual(['VOICE', 'TEXT']);
    expect(mockNavigate).not.toHaveBeenCalledWith('Call', expect.anything());
  });

  it('also asks when resuming an open sitting, tells the server about the mode, then opens the call', async () => {
    mockHandler = routes({
      '/session-programs': [withModes(['TEXT', 'VOICE'], { todayState: 'IN_PROGRESS', activeSittingId: 's5' })],
      '/session-programs/p1/sittings/s5/mode': { mode: 'VOICE' },
    });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Continue sitting/ }));
    expect(screen.getByText('How would you like to talk today?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Voice\./ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Call', { mode: 'voice', sittingId: 's5', programId: 'p1' }));
    expect(bodyOf('/session-programs/p1/sittings/s5/mode')).toEqual([{ mode: 'VOICE' }]);
    expect(bodyOf('/session-programs/p1/sittings')).toEqual([]);
  });

  it('resumes through SITTING_ALREADY_ACTIVE in the chosen mode', async () => {
    mockHandler = routes({
      '/session-programs': [withModes(['TEXT', 'VIDEO'])],
      '/session-programs/p1/sittings': () => apiError('SITTING_ALREADY_ACTIVE', { sittingId: 's7' }),
      '/session-programs/p1/sittings/s7/mode': { mode: 'VIDEO' },
    });
    await render(wrap(<SessionProgramsListScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    await fireEvent.press(screen.getByRole('button', { name: /^Video\./ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Call', { mode: 'video', sittingId: 's7', programId: 'p1' }));
    expect(bodyOf('/session-programs/p1/sittings/s7/mode')).toEqual([{ mode: 'VIDEO' }]);
  });

  it('shows the picker on the program detail screen too', async () => {
    mockParams = { programId: 'p1' };
    mockHandler = routes({ '/session-programs/p1': { ...prog({ availableModes: ['TEXT', 'VOICE'] }), timeline: [], themes: [], openHomework: [], planGoals: [] } });
    await render(wrap(<SessionProgramDetailScreen />));
    await fireEvent.press(await screen.findByRole('button', START));
    expect(screen.getByRole('button', { name: /^Voice\./ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Video\./ })).toBeNull();
  });
});

describe('New session wizard', () => {
  it('validates each step before moving on, then creates the program', async () => {
    mockHandler = routes();
    await render(wrap(<NewSessionProgramScreen />));
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Choose a topic to continue.')).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sleep' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Give your session a short name to continue.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Session name'), '  Calmer evenings ');
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    // days stay within 3..60
    for (let i = 0; i < 20; i++) await fireEvent.press(screen.getByRole('button', { name: 'Number of days −' }));
    expect(screen.getByText('3')).toBeTruthy();
    for (let i = 0; i < 70; i++) await fireEvent.press(screen.getByRole('button', { name: 'Number of days +' }));
    expect(screen.getByText('60')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '14 days' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));

    await fireEvent.press(screen.getByRole('button', { name: '40 min' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    await fireEvent.press(screen.getByRole('button', { name: '19:00' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Create session' }));

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'ProgramDetail', params: { programId: 'p1' } }));
    const post = mockApi.mock.calls.find((c) => c[0] === '/session-programs' && c[1]?.method === 'POST')!;
    expect(post[1]!.body).toEqual({ topicId: 't1', title: 'Calmer evenings', plannedDays: 14, dailyMinutes: 40, reminderTimeMin: 1140 });
  });
});

describe('Session program detail', () => {
  const detail = () => ({
    ...prog({ moodTrend: [{ day: 1, moodBefore: 4, moodAfter: 6 }, { day: 2, moodBefore: 5, moodAfter: 7 }] }),
    timeline: [
      { dayNumber: 1, date: new Date().toISOString(), status: 'DONE', sittingId: 'sit1', durationMin: 28, moodBefore: 4, moodAfter: 6, shortSummary: 'We found a wind-down routine.' },
      { dayNumber: 2, date: null, status: 'TODAY', sittingId: null, durationMin: null, moodBefore: null, moodAfter: null, shortSummary: null },
      { dayNumber: 3, date: null, status: 'UPCOMING', sittingId: null, durationMin: null, moodBefore: null, moodAfter: null, shortSummary: null },
    ],
    themes: ['sleep'], openHomework: [{ id: 'h1', title: 'Wind-down walk' }], planGoals: [{ id: 'g1', title: 'Sleep more calmly' }],
  });

  it('shows the timeline, themes, homework and goals, and opens a finished sitting', async () => {
    mockParams = { programId: 'p1' };
    mockHandler = routes({ '/session-programs/p1': detail() });
    await render(wrap(<SessionProgramDetailScreen />));
    expect(await screen.findByRole('button', { name: /Day 1, done/ })).toBeTruthy();
    expect(screen.getByLabelText('Day 2, today')).toBeTruthy();
    expect(screen.getByLabelText('Day 3, coming up')).toBeTruthy();
    expect(screen.getByText('sleep')).toBeTruthy();
    expect(screen.getByText('Wind-down walk')).toBeTruthy();
    expect(screen.getAllByText('Sleep more calmly').length).toBe(2);
    await fireEvent.press(screen.getByRole('button', { name: /Day 1, done/ }));
    expect(mockNavigate).toHaveBeenCalledWith('SessionSummary', { sessionId: 'sit1', programId: 'p1' });
    await fireEvent.press(screen.getByText('Done'));
    await waitFor(() => expect(mockApi.mock.calls.some((c) => c[0] === '/therapy/homework/h1/complete')).toBe(true));
  });

  it('pauses, and deletes only after confirming', async () => {
    mockParams = { programId: 'p1' };
    mockHandler = routes({ '/session-programs/p1': (_p: string, o?: { method?: string }) => (o?.method ? {} : detail()) });
    await render(wrap(<SessionProgramDetailScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Pause for now' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/session-programs/p1', { method: 'PATCH', body: { status: 'PAUSED' } }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete this session' }));
    expect(alertSpy).toHaveBeenCalledWith('Delete this session?', expect.any(String), expect.any(Array));
    expect(mockApi.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);
    await act(async () => { alertSpy.mock.calls[0]![2].find((b: any) => b.style === 'destructive').onPress(); });
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/session-programs/p1', { method: 'DELETE' }));
  });
});

describe('Sitting screen', () => {
  const conv = (over: object = {}) => ({
    sessionId: 's1', messages: [], busy: false, ended: false, errorKey: null, errorCode: null, cancelledText: null, reconnecting: false,
    loadingHistory: false, historyError: null, refetchHistory: jest.fn(), send: jest.fn(), cancel: jest.fn(), retry: jest.fn(), finish: jest.fn(async () => {}), remove: jest.fn(),
    ...over,
  });
  const state = (over: object) => ({ phase: 'CORE', elapsedMin: 10, remainingMin: 20, phaseHint: 'hintCore', isIntake: false, moodBefore: null, ...over });

  beforeEach(() => { mockParams = { sittingId: 's1', programId: 'p1' }; mockConv = conv(); });

  it('counts down from the server remaining time and gives a soft notice at one minute', async () => {
    jest.useFakeTimers();
    try {
      mockHandler = routes({ '/sessions/s1/state': state({ remainingSec: 62, endsAt: new Date(Date.now() + 62_000).toISOString() }) });
      await render(wrap(<ChatScreen />));
      expect(await screen.findByLabelText(/1:02 left/)).toBeTruthy();
      expect(screen.queryByText(/About a minute left/)).toBeNull();
      await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
      expect(screen.getByLabelText(/0:59 left/)).toBeTruthy();
      expect(screen.getByText(/About a minute left/)).toBeTruthy();
    } finally { jest.useRealTimers(); }
  });

  it('offers the summary when time is up without cutting the person off', async () => {
    mockHandler = routes({ '/sessions/s1/state': state({ remainingSec: 0, endsAt: new Date(Date.now() - 1000).toISOString() }) });
    await render(wrap(<ChatScreen />));
    expect(await screen.findByText(/Our time for today is up/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'See summary' }));
    expect(mockDispatch).toHaveBeenCalledWith({ name: 'SessionSummary', params: { sessionId: 's1', programId: 'p1' } });
    expect(screen.getByRole('button', { name: 'Emergency help' })).toBeTruthy();
  });

  it('opens the summary automatically on 409 SITTING_TIME_UP', async () => {
    mockHandler = routes({ '/sessions/s1/state': state({}) });
    mockConv = conv({ errorCode: 'SITTING_TIME_UP', ended: true });
    await render(wrap(<ChatScreen />));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'SessionSummary', params: { sessionId: 's1', programId: 'p1' } }));
  });

  it('has no voice or video shortcut when the program only allows text', async () => {
    mockHandler = routes({ '/sessions/s1/state': state({}), '/session-programs/p1': { ...prog(), availableModes: ['TEXT'] } });
    await render(wrap(<ChatScreen />));
    await waitFor(() => expect(mockApi.mock.calls.some((c) => c[0] === '/session-programs/p1')).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Switch to voice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to video' })).toBeNull();
  });

  it('offers switching to voice (and video) only for the modes the program allows, using the mode endpoint then opening the call', async () => {
    mockHandler = routes({
      '/sessions/s1/state': state({}),
      '/session-programs/p1': { ...prog(), availableModes: ['TEXT', 'VOICE'] },
      '/session-programs/p1/sittings/s1/mode': { mode: 'VOICE' },
    });
    await render(wrap(<ChatScreen />));
    expect(screen.queryByRole('button', { name: 'Switch to video' })).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Switch to voice' }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'Call', params: { mode: 'voice', sittingId: 's1', programId: 'p1' } }));
    const post = mockApi.mock.calls.find((c) => c[0] === '/session-programs/p1/sittings/s1/mode')!;
    expect(post[1]).toEqual({ method: 'POST', body: { mode: 'VOICE' } });
  });

  it('switches to the video call when video is available', async () => {
    mockHandler = routes({
      '/sessions/s1/state': state({}),
      '/session-programs/p1': { ...prog(), availableModes: ['TEXT', 'VOICE', 'VIDEO'] },
      '/session-programs/p1/sittings/s1/mode': { mode: 'VIDEO' },
    });
    await render(wrap(<ChatScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Switch to video' }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'Call', params: { mode: 'video', sittingId: 's1', programId: 'p1' } }));
  });

  it('stays in the chat and explains kindly when the server refuses the switch', async () => {
    mockHandler = routes({
      '/sessions/s1/state': state({}),
      '/session-programs/p1': { ...prog(), availableModes: ['TEXT', 'VOICE'] },
      '/session-programs/p1/sittings/s1/mode': () => Object.assign(apiError('MODE_DISABLED'), { status: 400 }),
    });
    await render(wrap(<ChatScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Switch to voice' }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Voice and video are not available. Text sittings are.'));
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Call' }));
  });
});

describe('SessionBar countdown', () => {
  it('falls back to endsAt when remainingSec is absent', async () => {
    mockHandler = () => ({ phase: 'CORE', elapsedMin: 5, remainingMin: null, phaseHint: 'hintCore', isIntake: false, moodBefore: null, endsAt: new Date(Date.now() + 125_000).toISOString() });
    await render(wrap(<SessionBar sessionId="s1" />));
    expect(await screen.findByLabelText(/2:0\d left/)).toBeTruthy();
  });
});
