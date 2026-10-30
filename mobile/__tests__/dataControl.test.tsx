import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ api: (...a: unknown[]) => mockApi(...a), ApiError: class extends Error {} }));
const mockShare = jest.fn(async () => {});
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: (...a: unknown[]) => (mockShare as any)(...a) }));
const mockWrite = jest.fn();
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class { uri = 'file:///cache/x.json'; create() {} write(s: string) { mockWrite(s); } delete() {} },
}));

import { SessionDataScreen } from '../src/screens/SessionDataScreen';
import { useSettings } from '../src/store/settings';

const sessionRow = { sessionId: 's1', startedAt: '2026-10-01T10:00:00Z', endedAt: null, sessionType: 'TEXT', lengthMin: 30, phase: 'CLOSING', isIntake: false, moodBefore: 4, moodAfter: 6, themes: ['sleep', 'work stress'], summary: 'We talked about sleep.', progressNote: '', homeworkCount: 1, finalized: true };
const detail = { ...sessionRow, note: { summary: 'We talked about sleep.', progressNote: '', agenda: [], themes: ['sleep'], techniques: [], keyInsights: ['Screens keep me up'], unresolved: [], homework: [] }, homework: [{ id: 'h1', title: 'No phone after 10pm', dueDate: null, status: 'OPEN', feedback: null }], messageCount: 12 };
const sample = { id: 'q1', createdAt: '2026-10-02T10:00:00Z', redactions: 2, messages: [{ role: 'user', text: 'Call me on [number]' }] };

let calls: { path: string; method: string; body?: unknown }[] = [];
beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  calls = []; mockShare.mockClear(); mockWrite.mockClear();
  mockApi.mockImplementation(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ path, method, body: opts.body });
    if (method === 'GET' && path === '/therapy/sessions') return [sessionRow];
    if (method === 'GET' && path === '/therapy/sessions/s1') return detail;
    if (method === 'GET' && path === '/quality/samples') return [sample];
    if (method === 'GET' && path === '/therapy/export') return { sessions: [sessionRow] };
    return undefined;
  });
});

const renderScreen = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SessionDataScreen /></QueryClientProvider>);

describe('SessionDataScreen', () => {
  it('lists sessions and the excerpts the user shared', async () => {
    await renderScreen();
    expect(await screen.findByText('We talked about sleep.')).toBeTruthy();
    expect(screen.getByText('sleep · work stress')).toBeTruthy();
    expect(await screen.findByText(/Call me on \[number\]/)).toBeTruthy();
    expect(screen.getByText('2 details hidden')).toBeTruthy();
  });

  it('shows a calm empty state', async () => {
    mockApi.mockImplementation(async () => []);
    await renderScreen();
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(await screen.findByText('You have not shared any excerpts.')).toBeTruthy();
  });

  it('opens a session, edits the note and saves it with PATCH', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Session on .*We talked about sleep/ }));
    expect(await screen.findByText('No phone after 10pm')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit this note' }));
    await fireEvent.changeText(screen.getByLabelText('Themes'), 'sleep, evenings');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/therapy/sessions/s1/note', body: { themes: ['sleep', 'evenings'], keyInsights: ['Screens keep me up'] } });
  });

  it('deletes one session only after confirmation', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Session on/ }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this session' }));
    expect(screen.getByText('Delete this session?')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ path: '/therapy/sessions/s1', method: 'DELETE' })));
  });

  it('cancelling the confirmation deletes nothing', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete all my session data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('delete-all can also delete the conversations', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete all my session data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ path: '/therapy/data', method: 'DELETE' })));

    await fireEvent.press(screen.getByRole('button', { name: 'Delete all my session data' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Also delete the conversations themselves' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ path: '/therapy/data?includeSessions=true', method: 'DELETE' })));
  });

  it('exports the data through the share sheet', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Export my session data' }));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect(JSON.parse(mockWrite.mock.calls[0]![0] as string)).toEqual({ sessions: [sessionRow] });
    expect(await screen.findByText('Your session data is ready.')).toBeTruthy();
  });

  it('says so calmly when export fails (offline)', async () => {
    await renderScreen();
    await screen.findByText('We talked about sleep.');
    mockApi.mockImplementation(async (path: string) => { if (path === '/therapy/export') throw new Error('offline'); return []; });
    await fireEvent.press(screen.getByRole('button', { name: 'Export my session data' }));
    expect(await screen.findByText('We could not export your data. Please try again.')).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('deletes a single shared excerpt', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this excerpt' }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ path: '/quality/samples/q1', method: 'DELETE' })));
  });
});
