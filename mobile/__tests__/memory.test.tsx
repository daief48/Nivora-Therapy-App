import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ api: (...a: unknown[]) => mockApi(...a), ApiError: class extends Error {} }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }), useRoute: () => ({ params: undefined }) }));
const ok = (data: unknown) => ({ isLoading: false, isError: false, error: null, data, refetch: jest.fn() });
jest.mock('../src/api/hooks', () => ({ useConsents: () => ok([]), useDevices: () => ok([]), useInvalidatingMutation: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false }) }));
const mockSignIn = jest.fn(async () => {});
jest.mock('../src/store/auth', () => ({ useAuth: (sel: (s: unknown) => unknown) => sel({ signInWith: mockSignIn }) }));

import { MemoryScreen } from '../src/screens/MemoryScreen';
import { PrivacyScreen } from '../src/screens/PrivacyScreen';
import { SignUpScreen } from '../src/screens/auth/SignUpScreen';
import { useSettings } from '../src/store/settings';

let calls: { path: string; method: string; body?: any }[] = [];
let prefs: Record<string, unknown> = {};
const wrap = (el: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  calls = []; prefs = {}; mockNavigate.mockClear(); mockSignIn.mockClear();
  mockApi.mockImplementation(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ path, method, body: opts.body });
    if (method === 'GET' && path === '/therapy/preferences') return prefs;
    if (method === 'GET' && path === '/therapy/memory-overview') {
      return { pinned: [{ id: 'p1', text: 'Works night shifts' }], recent: [{ id: 'r1', text: 'Slept badly this week' }], themes: [{ id: 't1', label: 'sleep', count: 4 }], counts: { session: 2, user: 1, notes: 1 } };
    }
    if (method === 'GET' && path.startsWith('/memories')) return [{ id: 'u1', text: 'My exam is on Friday', source: 'USER', createdAt: '2026-10-01T10:00:00Z' }];
    if (method === 'PUT' && path === '/therapy/preferences') return opts.body;
    if (path === '/auth/register') return { accessToken: 'a', refreshToken: 'b' };
    return undefined;
  });
});

const pressAlertButton = (label: string) => {
  const spy = jest.spyOn(Alert, 'alert');
  return {
    run: () => {
      const buttons = spy.mock.calls[spy.mock.calls.length - 1]![2]!;
      buttons.find((b) => b.text === label)!.onPress!();
    },
  };
};

describe('SignUpScreen memory consent', () => {
  const fill = async () => {
    await wrap(<SignUpScreen />);
    await fireEvent.changeText(screen.getByLabelText('What should I call you?'), 'Ayesha');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'a@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'a-long-password');
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getAllByRole('checkbox')[i]!);
  };

  it('is pre-ticked and sends rememberSessions true', async () => {
    await fill();
    expect(screen.getByRole('checkbox', { name: /remember our conversations/ }).props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/register')).toBeTruthy());
    expect(calls.find((c) => c.path === '/auth/register')!.body.rememberSessions).toBe(true);
  });

  it('sends rememberSessions false when unticked and can expand Learn more', async () => {
    await fill();
    await fireEvent.press(screen.getByRole('checkbox', { name: /remember our conversations/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Learn more' }));
    expect(screen.getByText(/Messages that look like a crisis/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/register')).toBeTruthy());
    expect(calls.find((c) => c.path === '/auth/register')!.body.rememberSessions).toBe(false);
  });
});

describe('MemoryScreen', () => {
  it('lists the sections and the default-ON switch when nothing was stored', async () => {
    await wrap(<MemoryScreen />);
    expect(await screen.findByText('Works night shifts')).toBeTruthy();
    for (const s of ['About you', 'Recent', 'Themes', 'Things you asked me to remember']) expect(screen.getByText(s)).toBeTruthy();
    expect(screen.getByText('sleep · 4')).toBeTruthy();
    expect(screen.getByText('My exam is on Friday')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Remember our conversations' }).props.value).toBe(true);
  });

  it('shows the honest empty state', async () => {
    mockApi.mockImplementation(async (path: string) => (path === '/therapy/memory-overview' ? {} : path.startsWith('/memories') ? [] : {}));
    await wrap(<MemoryScreen />);
    expect(await screen.findByText(/Nothing yet\. After your first conversations/)).toBeTruthy();
  });

  it('turns memory off with a calm note', async () => {
    await wrap(<MemoryScreen />);
    await fireEvent(await screen.findByRole('switch', { name: 'Remember our conversations' }), 'valueChange', false);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body.continuityOptIn).toBe(false));
  });

  it('edits a memory inline with PATCH', async () => {
    await wrap(<MemoryScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));
    await fireEvent.changeText(screen.getByLabelText('Edit this note'), 'My exam is on Monday');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    const p = calls.find((c) => c.method === 'PATCH')!;
    expect(p.path).toBe('/memories/u1');
    expect(p.body).toEqual({ text: 'My exam is on Monday' });
  });

  it('deletes only after confirming', async () => {
    await wrap(<MemoryScreen />);
    await screen.findByText('My exam is on Friday');
    const confirm = pressAlertButton('Delete');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' })[2]!);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    confirm.run();
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/memories/u1'));
  });

  it('forgets what was learned from conversations after confirming', async () => {
    await wrap(<MemoryScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Forget what I learned from our conversations' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    pressAlertButton('Forget it all').run();
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/memories?source=SESSION'));
    expect(await screen.findByText('Done. Those notes are gone.')).toBeTruthy();
  });
});

describe('PrivacyScreen memory switch', () => {
  it('shows memory ON when the preference was never stored, and OFF when stored false', async () => {
    await wrap(<PrivacyScreen />);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Remember our conversations' }).props.disabled).toBeFalsy());
    expect(screen.getByRole('switch', { name: 'Remember our conversations' }).props.value).toBe(true);
  });
});
