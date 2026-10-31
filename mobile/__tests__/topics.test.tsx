import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true, dispatch: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ api: (...a: [string, any]) => mockApi(...a), ApiError: class extends Error {} }));

import { SessionLobbyScreen } from '../src/screens/SessionLobbyScreen';
import { TopicsScreen } from '../src/screens/TopicsScreen';
import { useSettings } from '../src/store/settings';

const topics = [
  { id: 't1', kind: 'ADDICTION', label: null, createdAt: '2026-01-01', sessionCount: 3, lastSessionAt: '2026-02-01T10:00:00Z' },
  { id: 't2', kind: 'OTHER', label: 'Moving abroad', createdAt: '2026-01-02', sessionCount: 1, lastSessionAt: null },
];
const lobby = { needsIntake: false, lastSessionRecap: null, openHomework: [], planGoals: [], suggestedLengthMin: 30, guidedAck: true, continuityOptIn: true };
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockApi.mockClear(); mockParams = undefined;
});

describe('Topics', () => {
  it('lists one card per topic with its session count and opens the topic', async () => {
    mockHandler = (p) => (p === '/topics' ? topics : new Error(p));
    await render(wrap(<TopicsScreen />));
    expect(await screen.findByText('Addiction')).toBeTruthy();
    expect(screen.getByText(/3 sessions/)).toBeTruthy();
    expect(screen.getByText('Moving abroad')).toBeTruthy();
    expect(screen.getByText(/1 session$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Addiction/ }));
    expect(mockNavigate).toHaveBeenCalledWith('TopicSessions', { topicId: 't1' });
  });

  it('sends the chosen topic when starting a session from the lobby', async () => {
    mockHandler = (p) => (p === '/sessions/lobby' ? lobby : p === '/me' ? { locale: 'en' } : p === '/topics' ? topics : p === '/sessions' ? { id: 's9' } : new Error(p));
    await render(wrap(<SessionLobbyScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Addiction' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sessionId: 's9' }));
    const call = mockApi.mock.calls.find((c) => c[0] === '/sessions')! as any[];
    expect(call[1]!.body).toMatchObject({ topicId: 't1', lengthMin: 30, rememberThis: true });
  });

  it('starts without a topic by default', async () => {
    mockHandler = (p) => (p === '/sessions/lobby' ? lobby : p === '/me' ? { locale: 'en' } : p === '/topics' ? topics : p === '/sessions' ? { id: 's8' } : new Error(p));
    await render(wrap(<SessionLobbyScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sessionId: 's8' }));
    expect(mockApi.mock.calls.find((c) => c[0] === '/sessions')![1]!.body.topicId).toBeUndefined();
  });
});
