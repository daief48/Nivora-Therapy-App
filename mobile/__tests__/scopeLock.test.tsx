import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
const mockStream = jest.fn();
jest.mock('../src/api/stream', () => ({ streamMessage: (...a: unknown[]) => mockStream(...a) }));

import { ChatScreen } from '../src/screens/ChatScreen';
import { SessionLobbyScreen } from '../src/screens/SessionLobbyScreen';
import { dictionaries } from '../src/i18n';
import { bn as bnScope, en as enScope } from '../src/i18n/ext/scope';
import { bn as bnConnect, en as enConnect } from '../src/i18n/ext/connect';
import { useSettings } from '../src/store/settings';

const safe = { severity: 'NONE', crisis: false, resources: [] };
const redirect = {
  topic: 'sleep', kind: 'SLEEP', intro: 'That sounds important. Shall we come back to sleep, or open a separate section for it?',
  choices: [{ id: 'RETURN', label: 'Back to sleep' }, { id: 'SEPARATE', label: 'Open a separate section' }],
};
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>
);
const lobby = { needsIntake: false, lastSessionRecap: null, openHomework: [], planGoals: [], suggestedLengthMin: 30, guidedAck: true, continuityOptIn: true };
const topics = [{ id: 't1', kind: 'SLEEP', label: null, createdAt: '2026-01-01', sessionCount: 0, lastSessionAt: null }];

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockApi.mockClear(); mockStream.mockReset();
  mockParams = { sessionId: 's1' };
  mockHandler = (p, o) => {
    if (p === '/me') return { displayName: 'A', locale: 'en' };
    if (p === '/sessions/s1') return { id: 's1', status: 'ACTIVE', messages: [] };
    if (p === '/sessions/s1/scope-choice') return o?.body?.choice === 'SEPARATE'
      ? { scopeChoice: 'SWITCHED', action: { id: 'NEW_SECTION', kind: 'NEW_SECTION', deepLink: { route: 'SessionLobby' } } }
      : { scopeChoice: 'RETURNED', action: null };
    return new Error('unmocked ' + p);
  };
  mockStream.mockImplementation(async () => ({ message: { id: 'srv-1', role: 'assistant', content: 'I hear you.', createdAt: '' }, safety: safe, scopeRedirect: redirect }));
});

const sendOffTopic = async () => {
  await render(wrap(<ChatScreen />));
  const field = await screen.findByLabelText('Write a message…', {}, { timeout: 3000 }).catch(() => null);
  const input = field ?? screen.getByPlaceholderText(/./);
  await fireEvent.changeText(input, 'what about my taxes');
  await fireEvent.press(screen.getByRole('button', { name: /^Send/ }));
};

describe('topic-lock redirect in chat', () => {
  it('shows a gentle two-button choice and keeps typing enabled', async () => {
    await sendOffTopic();
    expect(await screen.findByText(redirect.intro)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to sleep' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open a separate section' })).toBeTruthy();
    expect(screen.getByPlaceholderText(/./).props.editable).not.toBe(false);
  });

  it('RETURN calls scope-choice and hides the card without navigating', async () => {
    await sendOffTopic();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back to sleep' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/sessions/s1/scope-choice', { method: 'POST', body: { choice: 'RETURN' } }));
    await waitFor(() => expect(screen.queryByText(redirect.intro)).toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('SEPARATE calls scope-choice and follows the deepLink to SessionLobby', async () => {
    await sendOffTopic();
    await fireEvent.press(await screen.findByRole('button', { name: 'Open a separate section' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/sessions/s1/scope-choice', { method: 'POST', body: { choice: 'SEPARATE' } }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('SessionLobby'));
  });

  it('shows no choice when the reply has no scopeRedirect', async () => {
    mockStream.mockImplementation(async () => ({ message: { id: 'srv-2', role: 'assistant', content: 'Okay.', createdAt: '' }, safety: safe }));
    await sendOffTopic();
    await screen.findByText('Okay.');
    expect(screen.queryByRole('button', { name: 'Open a separate section' })).toBeNull();
  });
});

describe('session creation with a focus goal', () => {
  const pickSleep = async () => {
    await render(wrap(<SessionLobbyScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: /Sleep/ }));
  };

  it('sends the optional goal with the topic', async () => {
    mockParams = undefined;
    mockHandler = (p) => (p === '/sessions/lobby' ? lobby : p === '/me' ? { locale: 'en' } : p === '/topics' ? topics : p === '/sessions' ? { id: 's9' } : new Error(p));
    await pickSleep();
    await fireEvent.changeText(screen.getByLabelText('What do you want to focus on?'), 'fall asleep faster');
    await fireEvent.press(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Chat', { sessionId: 's9' }));
    const call = mockApi.mock.calls.find((c) => c[0] === '/sessions' && c[1]?.method === 'POST')!;
    expect(call[1]!.body).toMatchObject({ topicId: 't1', goal: 'fall asleep faster' });
  });

  it('a crisis goal shows the crisis card and does not open a chat', async () => {
    mockParams = undefined;
    const crisisPayload = { crisis: true, safety: { severity: 'IMMINENT', crisis: true, resources: [], message: 'You are not alone.' } };
    mockHandler = (p) => (p === '/sessions/lobby' ? lobby : p === '/me' ? { locale: 'en' } : p === '/topics' ? topics : p === '/sessions' ? crisisPayload : new Error(p));
    await pickSleep();
    await fireEvent.changeText(screen.getByLabelText('What do you want to focus on?'), 'a risky goal');
    await fireEvent.press(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('You are not alone.')).toBeTruthy();
    expect(screen.getByText('You matter. Please reach out for support.')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Open emergency help' })[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
    expect(mockNavigate).not.toHaveBeenCalledWith('Chat', expect.anything());
    // the risky goal text is wiped from state and the visible field
    expect(screen.getByLabelText('What do you want to focus on?').props.value).toBe('');
    expect(screen.queryByDisplayValue('a risky goal')).toBeNull();
  });
});

describe('scope-lock strings', () => {
  const FEATS = ['cnFeat_session_scope_enrichment', 'cnFeat_session_topic_drift_check', 'cnFeat_session_scope_card'] as const;
  it('has real Bangla for every new key, with no mojibake or English placeholders', () => {
    const vals = [...Object.values(bnScope), ...FEATS.map((k) => (bnConnect as Record<string, string>)[k])];
    for (const v of vals) {
      expect(v).toMatch(/[ঀ-৿]/);
      expect(v).not.toMatch(/[�À-ÿ]/);
    }
    expect(Object.keys(bnScope)).toEqual(Object.keys(enScope));
  });
  it('en and bn expose the feature keys the privacy screen looks up', () => {
    for (const k of FEATS) { expect((enConnect as Record<string, string>)[k]).toBeTruthy(); expect((bnConnect as Record<string, string>)[k]).toBeTruthy(); }
    expect(dictionaries.bn.scopeSeparate).toBe(bnScope.scopeSeparate);
    expect(dictionaries.hi.scopeReturn).toContain('{topic}');
  });
});
