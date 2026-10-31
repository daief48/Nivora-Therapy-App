import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), dispatch: jest.fn() }),
  useFocusEffect: (cb: () => void) => { const R = require('react'); R.useEffect(cb, [cb]); },
}));
const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: unknown[]) => mockApi(...a) }));
const mockSchedule = jest.fn(async (..._a: unknown[]) => 'id');
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: (...a: unknown[]) => mockSchedule(...a),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

import { readEmotions, EMOTION_TEXT_MAX } from '../src/api/voiceJournal';
import { persistOptions } from '../src/api/offline';
import { ActionCard } from '../src/components/ActionCard';
import { TodayFeed } from '../src/components/TodayFeed';
import { resetGuideForTests, useGuide } from '../src/guide/guideEngine';
import { MAX_DAILY_REMINDERS, reminderBudget, rescheduleAll } from '../src/utils/reminders';
import { useSettings } from '../src/store/settings';

beforeEach(() => {
  resetGuideForTests();
  mockApi.mockReset(); mockNavigate.mockClear(); mockSchedule.mockClear();
  useSettings.setState({ reducedMotion: true, uiLang: 'en', quietOn: false });
});

describe('emotion reading limit', () => {
  it('sends at most 6000 characters', async () => {
    mockApi.mockResolvedValue({ emotions: [] });
    await readEmotions('x'.repeat(20000), 'e1');
    expect((mockApi.mock.calls[0]![1] as { body: { text: string } }).body.text).toHaveLength(EMOTION_TEXT_MAX);
  });
});

describe('offline cache', () => {
  it('never persists reflections, the Today feed or session-close text', () => {
    const keep = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;
    const q = (k: string) => ({ state: { status: 'success' }, queryKey: [k, 'x'] }) as never;
    for (const k of ['reports', 'insights', 'today', 'actions', 'therapy', 'journal', 'sessions', 'memories', 'ai-settings', 'privacy-ai-data']) expect(keep(q(k))).toBe(false);
    expect(keep(q('garden'))).toBe(true);
  });
});

describe('guide engine gating', () => {
  it('a server risk signal blocks automatic tips until it clears', () => {
    useGuide.getState().setRiskSource('today', true);
    expect(useGuide.getState().request('journal')).toBe(false);
    useGuide.getState().setRiskSource('today', false);
    expect(useGuide.getState().request('journal')).toBe(true);
  });
  it('Rarely allows one automatic tip a day', () => {
    useGuide.setState({ suggestionLevel: 'RARELY' });
    expect(useGuide.getState().request('journal')).toBe(true);
    useGuide.getState().skip(); useGuide.setState({ sessionShown: 0 });
    expect(useGuide.getState().request('breathe')).toBe(false);
  });
  it('a request while the host is blocked neither shows nor marks the tip as seen', () => {
    useGuide.getState().setHostBlocked(true);
    expect(useGuide.getState().request('journal')).toBe(false);
    expect(useGuide.getState().seen.journal).toBeUndefined();
    expect(useGuide.getState().shownToday).toBe(0);
    useGuide.getState().setHostBlocked(false);
    expect(useGuide.getState().request('journal')).toBe(true);
  });
});

describe('local reminders', () => {
  const base = { reminderEnabled: true, reminderHour: 20, remMorningOn: true, remMorningAt: 480, remEveningOn: true, remEveningAt: 1200, remBedOn: true, remBedAt: 1320, quietOn: false, quietStart: 0, quietEnd: 0, gentleReturn: true, lastOpenAt: Date.now() };
  const t = ((k: string) => k) as never;
  it('caps at two per day and adds no return notice on top', async () => {
    await rescheduleAll(base, t);
    expect(MAX_DAILY_REMINDERS).toBe(2);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });
  it('Never schedules nothing and Rarely one', async () => {
    expect(reminderBudget('NEVER')).toBe(0);
    await rescheduleAll(base, t, { suggestionLevel: 'NEVER' });
    expect(mockSchedule).not.toHaveBeenCalled();
    await rescheduleAll(base, t, { suggestionLevel: 'RARELY' });
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });
  it('the return notice is a neutral invitation and only when it fits', async () => {
    await rescheduleAll({ ...base, remMorningOn: false, remEveningOn: false, reminderEnabled: false }, t);
    const ids = mockSchedule.mock.calls.map((c) => (c[0] as { identifier: string }).identifier);
    expect(ids).toEqual(['nv-bed', 'nv-return']);
  });
});

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const card = { offerId: 'o1', id: 'BREATHING', kind: 'BREATHING', crisis: false, minutes: 2, deepLink: { route: 'Exercise', params: { kind: 'breathing' } }, surface: 'TODAY', title: 'Two slow breaths', why: 'w', reason: null, cta: 'Try it', notNow: 'Not now', titleKey: 't', whyKey: 'w', reasonKey: 'r' } as never;

describe('ActionCard', () => {
  it('posts ACCEPTED once on a double tap and refreshes Kaizen and Today', async () => {
    mockApi.mockResolvedValue({});
    const qc = new QueryClient();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const onTry = jest.fn();
    await render(<QueryClientProvider client={qc}><ActionCard card={card} onTry={onTry} saveToKaizen /></QueryClientProvider>);
    const btn = screen.getByRole('button', { name: 'Try it' });
    await fireEvent.press(btn); await fireEvent.press(btn);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mockApi.mock.calls.filter((c) => (c[1] as { body?: { outcome?: string } })?.body?.outcome === 'ACCEPTED')).toHaveLength(1);
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['kaizen'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['today'] });
  });
});

describe('Today feed resting', () => {
  const feed = {
    date: 'd', quietNow: true, snoozedUntil: null, plan: { focus: 'Walk', kaizenActionId: null, tonightBedtime: '22:30', windDownAt: '21:45', morningCheckInDone: false },
    nudges: [], insights: [{ kind: 'SLEEP_TREND', title: 'Sleep this week', body: 'b', value: 1, reason: null }], lightDay: false, riskMode: false, order: [], suggestions: [card],
  } as never;
  it('shows only a quiet line, no plan, suggestion or insight', async () => {
    await render(wrap(<TodayFeed feed={feed} />));
    expect(screen.queryByText('Sleep this week')).toBeNull();
    expect(screen.queryByText('Two slow breaths')).toBeNull();
    expect(screen.queryByText(/Focus/)).toBeNull();
    expect(screen.getByText(/quiet hour/)).toBeTruthy();
  });
});
