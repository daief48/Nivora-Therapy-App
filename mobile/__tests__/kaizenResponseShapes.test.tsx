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
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }), useRoute: () => ({ params: undefined }) }));

import { ApiError } from '../src/api/client';
import { errorMessageKey } from '../src/api/hooks';
import type { KaizenTask, UserGoal } from '../src/api/types';
import { GoalCard } from '../src/components/kaizen/GoalCard';
import { resetFeltPrompt, TaskCard } from '../src/components/kaizen/TaskCard';
import { bn, en, hi, ne } from '../src/i18n/ext/taskCue';
import { SleepDiaryScreen } from '../src/screens/SleepScreens';
import { useAuth } from '../src/store/auth';
import { useSettings } from '../src/store/settings';

const goal = (over: Partial<UserGoal> = {}): UserGoal => ({
  id: 'g1', title: 'Read a little every night', status: 'ACTIVE', score: 40, createdAt: '2026-10-01T08:00:00Z', completedAt: null, currentIndex: 0,
  tasks: [{ id: 't1', title: 'Open the book', done: false, state: 'CURRENT' }], updates: [], ...over,
});
const task: KaizenTask = {
  id: 'k1', content: 'Drink a glass of water', reason: null, status: 'ACTIVE', stateNote: null, standingStill: false,
  cue: null, cueTime: null, suggestedCue: null, felt: null, createdAt: '2026-11-01T08:00:00Z', completedAt: null,
};
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const err = (status: number, code: string) => new ApiError(status, code, code);

beforeEach(() => { useSettings.setState({ reducedMotion: true, uiLang: 'en' } as never); mockApi.mockClear(); resetFeltPrompt(); mockHandler = () => undefined; });
afterEach(() => cleanup());

describe('errorMessageKey: new backend codes', () => {
  it('maps the gentle codes', () => {
    expect(errorMessageKey(err(503, 'SAFETY_CHECK_UNAVAILABLE'))).toBe('kzSafetyRetry');
    expect(errorMessageKey(err(409, 'GOAL_TASKS_UNREADABLE'))).toBe('kzGoalTasksUnreadable');
    expect(errorMessageKey(err(409, 'TASK_DROPPED'))).toBe('kzTaskGone');
    expect(errorMessageKey(err(500, 'X'))).toBe('errorTitle');
  });
  it('new keys have parity in every language', () => {
    for (const k of ['kzGoalTasksUnreadable', 'kzTaskGone'] as const) {
      for (const l of [en, bn, hi, ne]) expect(typeof (l as Record<string, string>)[k]).toBe('string');
    }
    expect(bn.kzTaskGone).toBe('এই কাজটি আর সক্রিয় নেই।');
  });
});

describe('goal card response shapes', () => {
  it('goal update with textSkipped shows the gentle line', async () => {
    mockHandler = (p, o) => (p.endsWith('/update') && o?.method === 'POST' ? { ...goal(), textSkipped: true } : undefined);
    await render(wrap(<GoalCard goal={goal()} />));
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByText(en.kzTextSkipped)).toBeTruthy();
  });

  it('goal update 409 GOAL_TASKS_UNREADABLE shows the unreadable line', async () => {
    mockHandler = (p, o) => (p.endsWith('/update') && o?.method === 'POST' ? err(409, 'GOAL_TASKS_UNREADABLE') : undefined);
    await render(wrap(<GoalCard goal={goal()} />));
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByText(en.kzGoalTasksUnreadable)).toBeTruthy();
  });

  it('anchor saved:false keeps the editor open with the text and shows the retry line', async () => {
    mockHandler = (p, o) => (p.endsWith('/anchor') && o?.method === 'POST' ? { saved: false, reason: 'SAFETY_CHECK_UNAVAILABLE' } : undefined);
    await render(wrap(<GoalCard goal={goal()} />));
    await fireEvent.press(screen.getByText('Add a habit anchor'));
    await fireEvent.changeText(screen.getByLabelText('Try anchoring it:'), 'after tea');
    await fireEvent.press(screen.getByText('Save anchor'));
    expect(await screen.findByText(en.kzSafetyRetry)).toBeTruthy();
    expect(screen.getByDisplayValue('after tea')).toBeTruthy();
  });

  it('anchor saved normally closes the editor', async () => {
    mockHandler = (p, o) => (p.endsWith('/anchor') && o?.method === 'POST' ? { saved: true } : undefined);
    await render(wrap(<GoalCard goal={goal()} />));
    await fireEvent.press(screen.getByText('Add a habit anchor'));
    await fireEvent.changeText(screen.getByLabelText('Try anchoring it:'), 'after tea');
    await fireEvent.press(screen.getByText('Save anchor'));
    await waitFor(() => expect(screen.queryByText('Save anchor')).toBeNull());
  });

  it('goal edit 503 / 409 show gentle lines and keep the typed title', async () => {
    mockHandler = (p, o) => (p.endsWith('/edit') && o?.method === 'POST' ? err(503, 'SAFETY_CHECK_UNAVAILABLE') : undefined);
    await render(wrap(<GoalCard goal={goal()} />));
    await fireEvent.press(screen.getByText('Rewrite the goal'));
    await fireEvent.changeText(screen.getByLabelText('What do you want to work toward?'), 'Walk daily');
    await fireEvent.press(screen.getByText('Break it into small steps'));
    expect(await screen.findByText(en.kzSafetyRetry)).toBeTruthy();
    expect(screen.getByDisplayValue('Walk daily')).toBeTruthy();

    mockHandler = (p, o) => (p.endsWith('/edit') && o?.method === 'POST' ? err(409, 'GOAL_TASKS_UNREADABLE') : undefined);
    await fireEvent.press(screen.getByText('Break it into small steps'));
    expect(await screen.findByText(en.kzGoalTasksUnreadable)).toBeTruthy();
    expect(screen.getByDisplayValue('Walk daily')).toBeTruthy();
  });
});

describe('sleep diary textSkipped', () => {
  it('says saved but the note was not kept', async () => {
    mockHandler = (p, o) => (p === '/sleep' && o?.method === 'POST' ? { score: 80, textSkipped: true } : null);
    await render(wrap(<SleepDiaryScreen />));
    await fireEvent.changeText(screen.getByLabelText('Note (optional)'), 'slept ok');
    await fireEvent.press(screen.getByText('Save sleep entry'));
    expect(await screen.findByText('Saved. Your sleep score is ready.')).toBeTruthy();
    expect(screen.getByText(en.kzTextSkipped)).toBeTruthy();
  });
  it('plain save has no skipped line', async () => {
    mockHandler = (p, o) => (p === '/sleep' && o?.method === 'POST' ? { score: 80 } : null);
    await render(wrap(<SleepDiaryScreen />));
    await fireEvent.press(screen.getByText('Save sleep entry'));
    expect(await screen.findByText('Saved. Your sleep score is ready.')).toBeTruthy();
    expect(screen.queryByText(en.kzTextSkipped)).toBeNull();
  });
});

describe('task card TASK_DROPPED + sign-out', () => {
  it('shows the gone line and refetches the task list', async () => {
    mockHandler = (p, o) => {
      if (p === '/kaizen/task' && !o?.method) return { task, history: [], riskMode: false };
      if (p.endsWith('/complete')) return err(409, 'TASK_DROPPED');
      return undefined;
    };
    await render(wrap(<TaskCard />));
    await fireEvent.press(await screen.findByText('Done'));
    expect(await screen.findByText(en.kzTaskGone)).toBeTruthy();
    await waitFor(() => expect(mockApi.mock.calls.filter(([p, o]) => p === '/kaizen/task' && !o?.method).length).toBeGreaterThan(1));
  });

  it('react (Can\'t today) 409 shows the gone line too', async () => {
    mockHandler = (p, o) => {
      if (p === '/kaizen/task' && !o?.method) return { task, history: [], riskMode: false };
      if (p.endsWith('/react')) return err(409, 'TASK_DROPPED');
      return undefined;
    };
    await render(wrap(<TaskCard />));
    await fireEvent.press(await screen.findByText("Can't today"));
    expect(await screen.findByText(en.kzTaskGone)).toBeTruthy();
  });

  it('signing out clears the open felt prompt', async () => {
    mockHandler = (p, o) => {
      if (p === '/kaizen/task' && !o?.method) return { task, history: [], riskMode: false };
      return {};
    };
    useAuth.setState({ status: 'in' } as never);
    await render(wrap(<TaskCard />));
    await fireEvent.press(await screen.findByText('Done'));
    expect(await screen.findByText('How do you feel now?')).toBeTruthy();
    await cleanup();
    useAuth.setState({ status: 'out' } as never);
    await render(wrap(<TaskCard />));
    await screen.findByText('Drink a glass of water');
    expect(screen.queryByText('How do you feel now?')).toBeNull();
  });
});
