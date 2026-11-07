import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true, dispatch: jest.fn() }),
  useRoute: () => ({ params: { sessionId: 's1' } }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: [string, any]) => mockApi(...a) }));
const mockStream = jest.fn();
jest.mock('../src/api/stream', () => ({ streamMessage: (...a: unknown[]) => mockStream(...a) }));

import { ChatScreen } from '../src/screens/ChatScreen';
import { KaizenScreen } from '../src/screens/KaizenScreen';
import { CapabilitiesCard } from '../src/components/CapabilitiesCard';
import { dictionaries } from '../src/i18n';
import { bn as bnScope, en as enScope } from '../src/i18n/ext/scope';
import { useSettings } from '../src/store/settings';

const safe = { severity: 'NONE', crisis: false, resources: [] };
const caps = { section: 'CHAT', kind: 'SLEEP', title: 'What I can do here', items: [{ id: 'a', label: 'Wind down together' }, { id: 'b', label: 'Sleep tips' }] };
const redirect = { topic: 'sleep', kind: 'SLEEP', intro: 'Back to sleep?', choices: [{ id: 'RETURN', label: 'Back to sleep' }, { id: 'SEPARATE', label: 'Separate' }] };
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>;
const reply = (extra: object, sev = 'NONE') => async () => ({ message: { id: 'srv-1', role: 'assistant', content: 'Hello.', createdAt: '' }, safety: { ...safe, severity: sev, crisis: sev === 'IMMINENT' }, ...extra });

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' } as never);
  mockNavigate.mockClear(); mockApi.mockClear(); mockStream.mockReset();
  mockHandler = (p) => {
    if (p === '/me') return { displayName: 'A', locale: 'en' };
    if (p === '/sessions/s1') return { id: 's1', status: 'ACTIVE', messages: [] };
    return new Error('unmocked ' + p);
  };
});
afterEach(() => cleanup());

const sendHi = async () => {
  await render(wrap(<ChatScreen />));
  const input = await screen.findByPlaceholderText(/./);
  await fireEvent.changeText(input, 'hi');
  await fireEvent.press(screen.getByRole('button', { name: /^Send/ }));
};

describe('chat capabilities card', () => {
  it('renders under the first reply, a chip prefills the input', async () => {
    mockStream.mockImplementation(reply({ capabilities: caps }));
    await sendHi();
    expect(await screen.findByText('What I can do here')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sleep tips'));
    expect(screen.getByPlaceholderText(/./).props.value).toBe('Sleep tips');
  });
  it('hides on scopeRedirect', async () => {
    mockStream.mockImplementation(reply({ capabilities: caps, scopeRedirect: redirect }));
    await sendHi();
    await screen.findByText('Back to sleep?');
    expect(screen.queryByText('What I can do here')).toBeNull();
  });
  it('hides on crisis', async () => {
    mockStream.mockImplementation(reply({ capabilities: caps }, 'IMMINENT'));
    await sendHi();
    await screen.findByText('Hello.');
    expect(screen.queryByText('What I can do here')).toBeNull();
  });
});

describe('section capabilities card', () => {
  it('fetches and shows the menu, and can be hidden', async () => {
    mockHandler = (p) => (p === '/actions/capabilities?section=KAIZEN' ? { ...caps, section: 'KAIZEN' } : new Error(p));
    await render(wrap(<CapabilitiesCard section="KAIZEN" />));
    expect(await screen.findByText('Wind down together')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Wind down together')).toBeNull();
  });
  it('fails silently on API error', async () => {
    mockHandler = () => new Error('boom');
    await render(wrap(<CapabilitiesCard section="SLEEP" />));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(screen.queryByTestId('capabilities-card')).toBeNull();
  });
});

describe('Kaizen guided goal flow', () => {
  let goalResponses: unknown[];
  const start = async () => {
    mockHandler = (p, o) => {
      if (p === '/kaizen/task') return { task: null, history: [], riskMode: false };
      if (p === '/kaizen/goal' && o?.method === 'POST') return goalResponses.shift();
      if (p === '/kaizen/goal') return [];
      if (p === '/kaizen/goal/templates') return [];
      return new Error('unmocked ' + p);
    };
    await render(wrap(<KaizenScreen />));
    await fireEvent.changeText(await screen.findByLabelText('What do you want to work toward?'), 'be better');
    await fireEvent.press(await screen.findByRole('button', { name: 'Break it into small steps' }));
  };
  const posts = () => mockApi.mock.calls.filter((c) => c[0] === '/kaizen/goal' && c[1]?.method === 'POST').map((c) => c[1]!.body);
  const clarify = { needsClarification: true, intro: 'Tell me a bit more', questions: ['Better how?', 'When?'], maxAnswers: 2 };
  const confirm = { needsConfirmation: true, understood: 'You want to be calmer.', goal: 'be better', answers: ['calmer'], actions: { confirm: 'Yes, go ahead', notQuite: 'Not quite' } };

  it('sends guided:true, asks questions, resubmits with answers, then confirm:true', async () => {
    goalResponses = [clarify, confirm, { id: 'g1' }];
    await start();
    expect(await screen.findByText('Tell me a bit more')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Better how?'), 'calmer');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('You want to be calmer.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, go ahead' }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(posts()).toEqual([
      { title: 'be better', guided: true },
      { title: 'be better', guided: true, answers: ['calmer'] },
      { title: 'be better', guided: true, answers: ['calmer'], confirm: true },
    ]);
    expect(await screen.findByLabelText('What do you want to work toward?')).toBeTruthy();
  });

  it('Not quite returns to editing without another request', async () => {
    goalResponses = [confirm];
    await start();
    await fireEvent.press(await screen.findByRole('button', { name: 'Not quite' }));
    expect((await screen.findByLabelText('What do you want to work toward?')).props.value).toBe('be better');
    expect(posts()).toHaveLength(1);
  });

  it('shows the crisis UI on the crisis shape', async () => {
    goalResponses = [{ crisis: true, safety: { severity: 'HIGH', crisis: true, resources: [], message: 'You matter. Help is here.' } }];
    await start();
    expect(await screen.findByTestId('crisis-notice')).toBeTruthy();
    expect(screen.getByText('You matter. Help is here.')).toBeTruthy();
  });

  it('a plain goal response still works', async () => {
    goalResponses = [{ id: 'g1', title: 'be better' }];
    await start();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((await screen.findByLabelText('What do you want to work toward?')).props.value).toBe('');
  });
});

describe('Phase 4 strings', () => {
  it('bn has the new keys as real Bangla, no mojibake', () => {
    for (const k of Object.keys(enScope) as (keyof typeof enScope)[]) {
      expect(bnScope[k]).toBeTruthy();
      expect(bnScope[k]).not.toMatch(/[ÃàâŸ�]/);
    }
    expect(bnScope.capTitle).toMatch(/[ঀ-৿]/);
    expect((dictionaries as any).bn.kzNotQuite).toBe(bnScope.kzNotQuite);
  });
});
