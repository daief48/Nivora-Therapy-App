import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: [string, any]) => mockApi(...a) }));

import type { UserGoal } from '../src/api/types';
import { KaizenScreen } from '../src/screens/KaizenScreen';
import { useSettings } from '../src/store/settings';

const goal = (over: Partial<UserGoal> = {}): UserGoal => ({
  id: 'g1', title: 'Read a little every night', status: 'ACTIVE', score: 40,
  createdAt: '2026-10-01T08:00:00Z', completedAt: null, currentIndex: 1,
  tasks: [
    { id: 't1', title: 'Open the book', done: true, state: 'DONE' },
    { id: 't2', title: 'Read one page', done: false, state: 'CURRENT', why: 'One page always fits in a day' },
    { id: 't3', title: 'Note one thought', done: false, state: 'TODO' },
  ],
  updates: [], anchor: 'after brushing teeth', timePerDayMin: 10, reminderMin: null,
  breakdown: { donePart: 30, streakPart: 10 }, momentum: 'RISING',
  ...over,
});

const templates = [{ id: 'tpl1', title: 'Walk gently', tasks: [{ title: 'Step outside', why: 'Fresh air helps' }] }];

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

afterEach(() => cleanup());

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' } as never);
  mockApi.mockClear();
  mockHandler = () => undefined;
});

/** Standard handler: the task block is empty, the goal list and templates as given, extra paths via `extra`. */
const renderKaizen = async (goals: UserGoal[] | null, extra?: Handler) => {
  mockHandler = (path, opts) => {
    if (path === '/kaizen/task') return { task: null, history: [], riskMode: false };
    if (path === '/kaizen/goal' && !opts?.method) return goals;
    if (path === '/kaizen/goal/templates') return templates;
    return extra?.(path, opts);
  };
  await render(wrap(<KaizenScreen />));
};

describe('GoalStart: time chips and templates (feature 1)', () => {
  it('renders the time-per-day chips and the template row, and posts timePerDayMin with the goal', async () => {
    await renderKaizen(null);
    expect(await screen.findByText('How much time can you give each day?')).toBeTruthy();
    expect(screen.getByText('5 min/day')).toBeTruthy();
    expect(screen.getByText('30 min/day')).toBeTruthy();
    expect(await screen.findByText('Or start from a gentle template')).toBeTruthy();
    expect(await screen.findByText('Walk gently')).toBeTruthy();

    const titleInput = await screen.findByLabelText('What do you want to work toward?');
    fireEvent.press(screen.getByText('10 min/day'));
    fireEvent.changeText(await screen.findByLabelText('What do you want to work toward?'), 'Stretch a bit');
    fireEvent.press(await screen.findByRole('button', { name: 'Break it into small steps' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal', { method: 'POST', body: { title: 'Stretch a bit', timePerDayMin: 10 } }));
  });

  it('omits timePerDayMin when no chip is selected, and POSTs when a template is tapped', async () => {
    await renderKaizen(null);
    const titleInput2 = await screen.findByLabelText('What do you want to work toward?');
    fireEvent.changeText(titleInput2, 'Stretch a bit');
    fireEvent.press(await screen.findByRole('button', { name: 'Break it into small steps' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal', { method: 'POST', body: { title: 'Stretch a bit' } }), { timeout: 5000 });

    fireEvent.press(await screen.findByText('Walk gently'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/from-template', { method: 'POST', body: { templateId: 'tpl1' } }));
  });
});

describe('GoalCard: breakdown, momentum, why, one-tap update (features 3, 5, 6, 8, 9, 10)', () => {
  it('renders the breakdown line, momentum pill, why-lines and the three one-tap buttons', async () => {
    await renderKaizen([goal()]);
    expect(await screen.findByText('Read a little every night')).toBeTruthy();
    expect(screen.getByText('🔥 Going strong')).toBeTruthy();
    expect(screen.getByText('40% of the way — steps 1 of 3, steadiness 10%')).toBeTruthy();
    expect(screen.getByText('One page always fits in a day')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Partly' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not today' })).toBeTruthy();
    // the mic degrades silently when the device has no recogniser (none in tests)
    expect(screen.queryByLabelText('Speak instead')).toBeNull();
  });

  it('Done fires the update with doneCurrent true, shows the milestone, then the difficulty chips fire once', async () => {
    await renderKaizen([goal()], (path, opts) => {
      if (path === '/kaizen/goal/g1/update' && opts?.method === 'POST') return { ...goal(), line: 'Quietly done.', milestone: 'A week of gentle pages' };
      return undefined;
    });
    fireEvent.press(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/g1/update', { method: 'POST', body: { doneCurrent: true } }));
    expect(await screen.findByText('How did it feel?')).toBeTruthy();
    // the milestone from the update response shows in a gentle lavender card
    expect(screen.getByText('A little milestone')).toBeTruthy();
    expect(screen.getByText('A week of gentle pages')).toBeTruthy();
    fireEvent.press(screen.getByText('Easy'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/g1/update', { method: 'POST', body: { difficulty: 'EASY' } }));
    await waitFor(() => expect(screen.queryByText('How did it feel?')).toBeNull());
  });

  it('Partly fires doneCurrent false with the auto note; a typed note wins over it', async () => {
    await renderKaizen([goal()]);
    fireEvent.press(await screen.findByRole('button', { name: 'Partly' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/g1/update', { method: 'POST', body: { doneCurrent: false, note: 'partly' } }));

    fireEvent.press(screen.getByText('Add a note'));
    fireEvent.changeText(await screen.findByLabelText('Anything to remember? (optional)'), 'half a page only');
    fireEvent.press(await screen.findByRole('button', { name: 'Not today' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/g1/update', { method: 'POST', body: { doneCurrent: false, note: 'half a page only' } }));
  });
});

describe('GoalCard: anchor, reminder and journey (features 4, 11, 12)', () => {
  it('shows the anchor on the current step and saves an edited anchor', async () => {
    await renderKaizen([goal()]);
    fireEvent.press(await screen.findByText('Try anchoring it: after brushing teeth'));
    fireEvent.changeText(await screen.findByLabelText('Try anchoring it:'), 'with morning tea');
    fireEvent.press(await screen.findByRole('button', { name: 'Save anchor' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/g1/anchor', { method: 'POST', body: { anchor: 'with morning tea' } }));
  });

  it('a goal without an anchor offers the ghost chip instead', async () => {
    await renderKaizen([goal({ anchor: undefined })]);
    fireEvent.press(await screen.findByText('Add a habit anchor'));
    expect(await screen.findByLabelText('Try anchoring it:')).toBeTruthy();
  });

  it('the reminder chips post reminderMin (19:00 → 1140)', async () => {
    await renderKaizen([goal()]);
    expect(await screen.findByText('Daily nudge (optional)')).toBeTruthy();
    fireEvent.press(screen.getByText('19:00'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/goal/g1/reminder', { method: 'POST', body: { reminderMin: 1140 } }));
  });

  it('a completed goal shows the journey button and opens the journey sheet', async () => {
    const done = goal({ status: 'COMPLETED', completedAt: '2026-10-20T08:00:00Z' });
    await renderKaizen([done], (path) => {
      if (path === '/kaizen/goal/g1/card') return { title: 'Read a little every night', tasks: [{ title: 'Open the book', done: true }, { title: 'Read one page', done: true }], startedAt: '2026-10-01T08:00:00Z', completedAt: '2026-10-20T08:00:00Z', days: 19, score: 100 };
      return undefined;
    });
    fireEvent.press(await screen.findByRole('button', { name: 'See my journey' }));
    expect(await screen.findByText('19 days')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getAllByText('Read one page').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Share as text' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
