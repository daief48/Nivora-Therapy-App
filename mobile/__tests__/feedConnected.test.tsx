import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockNavigate = jest.fn();
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: [string, any]) => mockApi(...a) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }), useRoute: () => ({ params: undefined }) }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(), printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn() }));

import type { ActionCardData } from '../src/api/actions';
import type { Monthly, PatternView } from '../src/api/monthly';
import { MonthStory, PracticeCard } from '../src/components/MonthStory';
import { TodayFeed } from '../src/components/TodayFeed';
import { WeeklyReportCard } from '../src/components/WeeklyReportCard';
import { bn, en, hi, ne } from '../src/i18n/ext/feed';
import { KaizenScreen } from '../src/screens/KaizenScreen';
import { useSettings } from '../src/store/settings';

const card = (id: string, over: Partial<ActionCardData> = {}): ActionCardData => ({
  offerId: null, id, kind: 'BREATHING', crisis: false, minutes: 2, deepLink: { route: 'Exercise', params: { kind: 'breathing' } }, surface: 'TODAY',
  title: `Title ${id}`, why: `Why ${id}`, reason: `Reason ${id}`, cta: `Try ${id}`, notNow: 'Not now', titleKey: 'k', whyKey: 'k', reasonKey: 'k', ...over,
});
const crisis = (id: string, route: string) => card(id, { kind: 'CRISIS', crisis: true, minutes: 0, deepLink: { route }, cta: `Open ${id}` });

const baseFeed = {
  date: '2026-11-01', quietNow: false, snoozedUntil: null,
  plan: { focus: 'Stretch', kaizenActionId: 'a1', tonightBedtime: '22:30', windDownAt: '21:45', morningCheckInDone: false, reason: 'Plan reason line' },
  nudges: [{ type: 'WIND_DOWN', title: 'Time to slow down', body: 'Bedtime is near.', cta: 'sleep_routine', reason: 'Nudge reason line' }],
  insights: [{ kind: 'SLEEP_TREND', title: 'Sleep this week', body: 'Steady.', value: 70, reason: 'Insight reason line' }],
  lightDay: false, riskMode: false, suggestionLevel: 'SOMETIMES', order: ['plan', 'nudge:WIND_DOWN', 'suggestion:GROUNDING', 'insight:SLEEP_TREND'], suggestions: [card('GROUNDING', { kind: 'GROUNDING' })],
};
const invite = {
  type: 'SESSION_INVITE', title: 'Want to talk it through?', body: 'A session is here if you would like one.', cta: 'start_session', reason: 'Invite reason', variant: 'INVITE',
  primary: { label: 'Start a session', deepLink: { route: 'Tabs', params: { screen: 'SessionsTab' } } }, notNowLabel: 'Not now', options: [],
};
const support = {
  type: 'SESSION_INVITE', title: 'You are not alone', body: 'Consider speaking with a doctor or counsellor.', cta: 'support', reason: 'Support reason', variant: 'SUPPORT',
  primary: null, notNowLabel: 'Not now', options: [crisis('EMERGENCY', 'Emergency'), crisis('SAFETY_PLAN', 'SafetyPlan'), crisis('TRUSTED_PERSON', 'ActionReachOut')],
};

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const consentErr = Object.assign(new Error('consent'), { code: 'CONSENT_REQUIRED', details: { consentType: 'WELLNESS_AI_SHARING' } });
const feedWith = (over: Record<string, unknown>) => { mockHandler = (path) => (path === '/today/feed' ? { ...baseFeed, ...over } : undefined); };

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' } as never);
  mockNavigate.mockClear(); mockApi.mockClear();
  mockHandler = () => undefined;
});

const y = (el: any) => el.parent;
const order = (texts: string[]) => {
  const all = JSON.stringify(screen.toJSON());
  const pos = texts.map((t) => all.indexOf(t));
  expect(pos.every((p) => p >= 0)).toBe(true);
  expect([...pos].sort((a, b) => a - b)).toEqual(pos);
};

describe('Today feed: order, why lines, light day', () => {
  it('renders cards in the server order with a why line under each', async () => {
    feedWith({});
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('Time to slow down')).toBeTruthy();
    order(['Focus: Stretch', 'Time to slow down', 'Title GROUNDING', 'Sleep this week']);
    expect(screen.getByText('Plan reason line')).toBeTruthy();
    expect(screen.getByText('Nudge reason line')).toBeTruthy();
    expect(screen.getByText('Insight reason line')).toBeTruthy();
    expect(screen.queryByTestId('light-day')).toBeNull();
  });

  it('a light day puts the server-ordered light cards first and says so', async () => {
    feedWith({ lightDay: true, order: ['suggestion:GROUNDING', 'nudge:WIND_DOWN', 'plan', 'insight:SLEEP_TREND'] });
    await render(wrap(<TodayFeed />));
    expect(await screen.findByTestId('light-day')).toBeTruthy();
    expect(screen.getByText('A lighter day')).toBeTruthy();
    order(['Title GROUNDING', 'Time to slow down', 'Focus: Stretch', 'Sleep this week']);
  });

  it('suggestions are action cards with their own Try it', async () => {
    feedWith({});
    await render(wrap(<TodayFeed />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Try GROUNDING' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/actions/GROUNDING/outcome', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Exercise', { kind: 'breathing' }));
  });

  it('keys missing from `order` are still shown (appended) and an old response shape does not crash', async () => {
    feedWith({ order: ['plan'] });
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('Sleep this week')).toBeTruthy();
  });

  it('an old response shape (no order, reasons, suggestions) does not crash', async () => {
    mockHandler = (path) => (path === '/today/feed' ? { date: 'd', plan: null, nudges: [{ type: 'WIND_DOWN', title: 'Old nudge', body: 'b', cta: 'plan' }], insights: [{ kind: 'MOOD_WEEK', title: 'Old insight', body: 'b', value: null }] } : undefined);
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('Old nudge')).toBeTruthy();
    expect(screen.getByText('Old insight')).toBeTruthy();
  });
});

describe('Today feed: risk mode', () => {
  it('shows only crisis cards: no plan, no insight, no ordinary nudge or suggestion', async () => {
    feedWith({ riskMode: true, plan: { ...baseFeed.plan, focus: null, reason: null }, nudges: [baseFeed.nudges[0], support], order: ['nudge:SESSION_INVITE', 'suggestion:EMERGENCY'], suggestions: [crisis('EMERGENCY', 'Emergency'), card('BREATHING')] });
    await render(wrap(<TodayFeed />));
    expect(await screen.findByTestId('support-card')).toBeTruthy();
    expect(screen.queryByText(/Focus:/)).toBeNull();
    expect(screen.queryByText('Time to slow down')).toBeNull();
    expect(screen.queryByText('Sleep this week')).toBeNull();
    expect(screen.queryByText('Title BREATHING')).toBeNull();
    expect(screen.getAllByText('Title EMERGENCY').length).toBeGreaterThan(0);
  });
});

describe('Session invitation', () => {
  it('INVITE: primary button opens the sessions tab, Not now posts the dismissal and hides the card', async () => {
    feedWith({ nudges: [invite], order: ['nudge:SESSION_INVITE'], suggestions: [], insights: [], plan: null });
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('Want to talk it through?')).toBeTruthy();
    expect(screen.getByText('Invite reason')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a session' }));
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'SessionsTab' });
    await fireEvent.press(screen.getAllByRole('button', { name: /Set this card aside/ })[0]!);
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/SESSION_INVITE/dismiss', { method: 'POST' }));
    expect(screen.queryByText('Want to talk it through?')).toBeNull();
  });

  it('SUPPORT: no session button, the Emergency, Safety plan and trusted person options are shown', async () => {
    feedWith({ nudges: [support], order: ['nudge:SESSION_INVITE'], suggestions: [], insights: [], plan: null, riskMode: true });
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('You are not alone')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start a session' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open EMERGENCY' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open SAFETY_PLAN' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open TRUSTED_PERSON' })).toBeTruthy();
    expect(screen.queryAllByTestId('swipe-card')).toHaveLength(0);
  });
});

// ---------- Insights ----------
const share = { periodDays: 30, daysLogged: 20, avgMood: 3.8, avgStress: 2.4, avgSleepScore: 72, kaizenDone: 9, season: 'SPRING' as const, strongestPattern: null };
const series = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, mood: 3, stress: 2, energy: 3, sleepScore: 70, sleepHours: 7, kaizenDone: 0 as const, steps: null, activeMin: null }));
const patterns: PatternView[] = [
  { id: 'corr-sleep-mood', type: 'CORRELATION', a: 'sleepScore', b: 'mood', direction: 'together', strength: 'moderate', text: 't', reason: 'Pattern reason', nextStep: card('SLEEP_ROUTINE', { kind: 'SLEEP', cta: "See tonight's routine", deepLink: { route: 'Routine' } }) },
  { id: 'weekday-low', type: 'WEEKDAY_LOW', weekday: 'Monday', text: 't', reason: null, nextStep: card('KAIZEN_STEP', { kind: 'KAIZEN', cta: 'Plan a gentle step for Monday', deepLink: { route: 'Tabs', params: { screen: 'KaizenTab', weekday: 1 } } }) },
];
const practice = { counts: { BREATHING: 4, GROUNDING: 1, THOUGHT_RECORD: 2, SOUNDS: 0 }, total: 7, thoughtRecord: { count: 2, pairs: 2, avgMoodBefore: 3, avgMoodAfter: 4 }, line: 'You did 7 practices. In your thought records your mood went from 3 to 4 on average.' };
const monthly = (over: Partial<Monthly> = {}): Monthly => ({
  enough: true, periodDays: 30, daysLogged: 20, minDaysRequired: 14,
  averages: { mood: 3.8, stress: 2.4, energy: 3, sleepScore: 72, sleepHours: 7, steps: null, activeMin: null },
  kaizenDone: 9, series, correlations: [{ a: 'sleepScore', b: 'mood', r: 0.5, n: 18, strength: 'moderate', direction: 'together' }],
  weekdays: [], bestMoodWeekday: { weekday: 'Saturday', mood: 4.5, stress: 2, sleepScore: 70, days: 3 }, lowestMoodWeekday: { weekday: 'Monday', mood: 3, stress: 3, sleepScore: 60, days: 3 },
  narrative: { headline: 'A steady month.', text: 'You checked in 20 days.', ai: false }, season: 'SPRING', share, practice, patterns, riskMode: false, ...over,
});

describe('Insights next steps and practice', () => {
  it('each pattern gets one next-step button; the weekday step carries the weekday', async () => {
    await render(wrap(<MonthStory data={monthly()} />));
    expect(screen.getByTestId('pattern-step-corr-sleep-mood')).toBeTruthy();
    expect(screen.getByTestId('pattern-step-weekday-low')).toBeTruthy();
    expect(screen.getByText('Pattern reason')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: "See tonight's routine" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Routine'));
    await fireEvent.press(screen.getByRole('button', { name: 'Plan a gentle step for Monday' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'KaizenTab', params: { weekday: 1 } }));
  });

  it('hides the button when nextStep is null', async () => {
    await render(wrap(<MonthStory data={monthly({ patterns: patterns.map((p) => ({ ...p, nextStep: null })) })} />));
    expect(screen.queryByTestId('pattern-step-corr-sleep-mood')).toBeNull();
    expect(screen.queryByTestId('pattern-step-weekday-low')).toBeNull();
  });

  it('hides the button in risk mode', async () => {
    await render(wrap(<MonthStory data={monthly({ riskMode: true })} />));
    expect(screen.queryByTestId('pattern-step-corr-sleep-mood')).toBeNull();
    expect(screen.queryByTestId('pattern-step-weekday-low')).toBeNull();
  });

  it('tolerates an older server without patterns, practice or riskMode', async () => {
    await render(wrap(<MonthStory data={monthly({ patterns: undefined, practice: undefined, riskMode: undefined })} />));
    expect(screen.getByText('A steady month.')).toBeTruthy();
    expect(screen.queryByTestId('practice-card')).toBeNull();
  });

  it('shows the practice card with the server line and counts, and no improvement claims', async () => {
    await render(wrap(<PracticeCard practice={practice} />));
    expect(screen.getByText(practice.line)).toBeTruthy();
    expect(screen.getByText('Breathing: 4')).toBeTruthy();
    expect(screen.getByText('Thought records: 2')).toBeTruthy();
    expect(screen.queryByText('Sounds: 0')).toBeNull();
    const all = JSON.stringify(screen.toJSON());
    expect(all).not.toMatch(/improv|better|progress/i);
  });

  it('shows a calm line when nothing was practised', async () => {
    await render(wrap(<PracticeCard practice={{ ...practice, total: 0, line: '' }} />));
    expect(screen.getByText('No practice was logged in this period.')).toBeTruthy();
  });
});

// ---------- Your week ----------
const report = (over: Record<string, unknown> = {}) => ({
  weekStart: '2026-10-26', headline: 'A gentle week.', text: 'You took four small steps.', ai: true, cached: false, riskMode: false,
  nextStep: card('SLEEP_ROUTINE', { kind: 'SLEEP', cta: "See tonight's routine" }), support: [], createdAt: '2026-11-01T08:00:00Z',
  stats: { kaizenDone: 4, kaizenTotal: 6, restarts: 0, sleepNights: 5, avgSleepScore: 70, avgSleepHours: 7, moodDays: 5, avgMood: 3.5, avgStress: 2, daysWithData: 6 }, ...over,
});

describe('Your week card', () => {
  it('shows the headline, text, AI badge, stats (counts only) and next step; refresh forces a new one', async () => {
    mockHandler = (path, opts) => (path === '/reports/weekly' ? (opts?.method === 'POST' ? report({ headline: 'Fresh week.' }) : report({ cached: true, stats: null })) : undefined);
    await render(wrap(<WeeklyReportCard />));
    expect(await screen.findByText('A gentle week.')).toBeTruthy();
    expect(screen.getByText('AI-generated')).toBeTruthy();
    expect(screen.getByText('Saved from earlier today')).toBeTruthy();
    expect(screen.getByRole('button', { name: "See tonight's routine" })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/reports/weekly', { method: 'POST', body: { force: true } }));
    expect(await screen.findByText('Fresh week.')).toBeTruthy();
    expect(screen.getByText('Kaizen steps: 4 of 6')).toBeTruthy();
    expect(screen.getByText('Days with a check-in: 5')).toBeTruthy();
  });

  it('template report has no AI badge; no stored report offers to create one', async () => {
    mockHandler = (path, opts) => (path === '/reports/weekly' ? (opts?.method === 'POST' ? report({ ai: false }) : null) : undefined);
    await render(wrap(<WeeklyReportCard />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Create my weekly review' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/reports/weekly', { method: 'POST', body: {} }));
    expect(await screen.findByText('A gentle week.')).toBeTruthy();
    expect(screen.queryByText('AI-generated')).toBeNull();
  });

  it('asks for consent on 403, then retries after the person allows it', async () => {
    let granted = false;
    mockHandler = (path, opts) => {
      if (path === '/consents') { granted = true; return {}; }
      if (path === '/reports/weekly' && opts?.method === 'POST') return granted ? report() : consentErr;
      return null;
    };
    await render(wrap(<WeeklyReportCard />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Create my weekly review' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Allow and continue' }));
    expect(await screen.findByText('A gentle week.')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/consents', { method: 'POST', body: { consentType: 'WELLNESS_AI_SHARING' } });
  });

  it('a declined consent shows a gentle note and nothing is created', async () => {
    mockHandler = (path, opts) => (path === '/reports/weekly' && opts?.method === 'POST' ? consentErr : null);
    await render(wrap(<WeeklyReportCard />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Create my weekly review' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('Okay. Nothing was sent to the AI. You can make your week summary any time.')).toBeTruthy();
    expect(screen.queryByText('A gentle week.')).toBeNull();
  });

  it('risk: only support options, no refresh, no next step, no stats', async () => {
    mockHandler = (path) => (path === '/reports/weekly' ? report({ riskMode: true, ai: false, nextStep: null, support: [crisis('EMERGENCY', 'Emergency'), crisis('SAFETY_PLAN', 'SafetyPlan')] }) : undefined);
    await render(wrap(<WeeklyReportCard />));
    expect(await screen.findByRole('button', { name: 'Open EMERGENCY' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open SAFETY_PLAN' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('button', { name: "See tonight's routine" })).toBeNull();
    expect(screen.queryByTestId('week-stats')).toBeNull();
  });

  it('a failing read shows a calm error line', async () => {
    mockHandler = () => new Error('x');
    await render(wrap(<WeeklyReportCard />));
    expect(await screen.findByText('Could not load your week right now.')).toBeTruthy();
  });
});

// ---------- Kaizen ----------
const kzToday = (over: Record<string, unknown> = {}) => ({
  needsGoal: false, goal: { id: 'g1', title: 'Move a little', category: 'SHORT_WALK' },
  action: { id: 'a1', goalId: 'g1', date: '2026-11-01', title: 'Stretch for 2 minutes', description: 'Easy.', targetValue: 2, unit: 'minutes', difficulty: 1, micro: false, status: 'PLANNED', difficultyFeedback: null, reflected: false, feltLevel: null, usefulness: null, nextPreference: null },
  progress: { completed: 3, stage: 'SEED', restarts: 0, total: 3, week: [], consistency7: 0 }, ...over,
});

describe('Kaizen light day and extras', () => {
  it('shows the reason on a light day and extra steps that can be completed', async () => {
    mockHandler = (path, opts) => {
      if (path === '/kaizen/today') return kzToday({ lightDay: true, reason: "Last night's sleep was short, so today is lighter.", extras: [{ id: 'x1', title: 'Walk to the shop', status: 'PLANNED', source: 'WALK' }, { id: 'x2', title: 'Write one line', status: 'DONE', source: 'JOURNAL' }] });
      if (path === '/kaizen/actions/x1/complete') return { id: 'x1', status: 'DONE' };
      return opts?.method ? {} : null;
    };
    await render(wrap(<KaizenScreen />));
    expect(await screen.findByText("Last night's sleep was short, so today is lighter.")).toBeTruthy();
    expect(screen.getByText('Walk to the shop')).toBeTruthy();
    expect(screen.getByText('A walk')).toBeTruthy();
    expect(screen.getAllByText('Done').length).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark done: Walk to the shop' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/kaizen/actions/x1/complete', { method: 'POST', body: { level: 'FULL' } }));
    await waitFor(() => expect(screen.getAllByText('Done').length).toBe(2));
  });

  it('shows no reason without lightDay and tolerates a response without the new fields', async () => {
    mockHandler = (path) => (path === '/kaizen/today' ? kzToday({ reason: 'Hidden unless light', extras: undefined }) : null);
    await render(wrap(<KaizenScreen />));
    expect(await screen.findByText('Stretch for 2 minutes')).toBeTruthy();
    expect(screen.queryByText('Hidden unless light')).toBeNull();
    expect(screen.queryByText('Extra small steps')).toBeNull();
  });

  it('the weekly review section is the combined Your week card', async () => {
    mockHandler = (path) => (path === '/kaizen/today' ? kzToday() : null);
    await render(wrap(<KaizenScreen />));
    expect(await screen.findByRole('button', { name: 'Create my weekly review' })).toBeTruthy();
  });
});

describe('feed strings', () => {
  it('all four languages have every key and keep their placeholders', () => {
    const keys = Object.keys(en).sort();
    for (const d of [bn, hi, ne]) {
      expect(Object.keys(d).sort()).toEqual(keys);
      for (const k of keys) {
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
        expect(ph((d as Record<string, string>)[k]!)).toBe(ph((en as Record<string, string>)[k]!));
      }
    }
  });
});
