import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) }));

const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: unknown[]) => mockApi(...a) }));

import { TodayFeed, goCta } from '../src/components/TodayFeed';
import { NudgeSettingsSection } from '../src/components/NudgeSettings';
import { minutesUntilMorning } from '../src/api/today';
import { useSettings } from '../src/store/settings';

const feed = {
  date: '2026-10-31', quietNow: false, snoozedUntil: null,
  plan: { focus: 'Walk for 10 minutes', kaizenActionId: 'a1', tonightBedtime: '22:30', windDownAt: '21:45', morningCheckInDone: false },
  nudges: [{ type: 'WIND_DOWN', title: 'Time to slow down', body: 'Bedtime is near.', cta: 'sleep_routine' }, { type: 'MOOD_CHECKIN', title: 'How is your day?', body: 'A quick check-in.', cta: 'checkin' }],
  insights: [{ kind: 'SLEEP_TREND', title: 'Sleep this week', body: 'Averaging 78.', value: 78 }],
};
const settings = { enabled: true, quietStart: '22:00', quietEnd: '07:00', snoozedUntil: null, types: { WIND_DOWN: true, MOOD_CHECKIN: true, WEEKLY_REVIEW: false, MORNING_PLAN: true } };

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockApi.mockReset();
  mockApi.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/today/feed') return feed;
    if (path === '/nudges/settings' && !opts?.method) return settings;
    if (path === '/nudges/settings') return { ...settings, enabled: false };
    if (path === '/nudges/snooze') return { ...settings, snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() };
    return undefined;
  });
});

describe('Today feed', () => {
  it('renders plan, nudge and insight cards from the API', async () => {
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('Time to slow down')).toBeTruthy();
    expect(screen.getByText('Focus: Walk for 10 minutes')).toBeTruthy();
    expect(screen.getByText('Sleep this week')).toBeTruthy();
    expect(screen.getByText('Wind down from 21:45, bedtime around 22:30.')).toBeTruthy();
  });

  it('dismissing a nudge calls the dismiss endpoint and removes the card', async () => {
    await render(wrap(<TodayFeed />));
    await screen.findByText('Time to slow down');
    await fireEvent.press(screen.getAllByRole('button', { name: /Set this card aside/ })[1]!);
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/WIND_DOWN/dismiss', { method: 'POST' }));
    expect(screen.queryByText('Time to slow down')).toBeNull();
    expect(screen.getByText('How is your day?')).toBeTruthy();
  });

  it('the accessibility dismiss action works like a swipe', async () => {
    await render(wrap(<TodayFeed />));
    await screen.findByText('How is your day?');
    const cards = screen.getAllByTestId('swipe-card');
    await act(async () => { cards[2]!.props.onAccessibilityAction({ nativeEvent: { actionName: 'dismiss' } }); });
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/MOOD_CHECKIN/dismiss', { method: 'POST' }));
  });

  it('a failed dismiss still sets the card aside, with a calm note', async () => {
    mockApi.mockImplementation(async (path: string) => { if (path === '/today/feed') return feed; throw new Error('404'); });
    await render(wrap(<TodayFeed />));
    await screen.findByText('Time to slow down');
    await fireEvent.press(screen.getAllByRole('button', { name: /Set this card aside/ })[1]!);
    expect(await screen.findByText('That did not save, but it is set aside for now.')).toBeTruthy();
    expect(screen.queryByText('Time to slow down')).toBeNull();
  });

  it('cta buttons open the right screens', async () => {
    await render(wrap(<TodayFeed />));
    await fireEvent.press(await screen.findByRole('button', { name: "Open tonight's routine" }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Routine');
    await fireEvent.press(screen.getByRole('button', { name: 'See my plan' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Plan');
    const nav = { navigate: mockNavigate } as never;
    goCta(nav, 'checkin', new Date(2026, 9, 31, 9));
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckIn', { kind: 'MORNING' });
    goCta(nav, 'checkin', new Date(2026, 9, 31, 20));
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckIn', { kind: 'EVENING' });
    goCta(nav, 'weekly_review');
    expect(mockNavigate).toHaveBeenLastCalledWith('Tabs', { screen: 'InsightsTab' });
    mockNavigate.mockClear(); goCta(nav, 'nonsense'); expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('says nudges are resting during quiet hours instead of showing a missed state', async () => {
    mockApi.mockImplementation(async () => ({ ...feed, nudges: [], quietNow: true }));
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText('It is a quiet hour, so there are no nudges right now.')).toBeTruthy();
  });

  it('shows a quiet error line when the feed cannot load', async () => {
    mockApi.mockRejectedValue(new Error('x'));
    await render(wrap(<TodayFeed />));
    expect(await screen.findByText(/could not load today/)).toBeTruthy();
  });
});

describe('Nudge settings', () => {
  it('toggles and snoozes through the API', async () => {
    await render(wrap(<NudgeSettingsSection />));
    const sw = await screen.findByRole('checkbox', { name: 'Show gentle nudges' });
    expect(sw.props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Weekly review' }).props.accessibilityState.checked).toBe(false);

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Weekly review' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/settings', { method: 'PUT', body: { types: { WEEKLY_REVIEW: true } } }));
  });

  it('adjusts quiet hours and snoozes, then resumes', async () => {
    await render(wrap(<NudgeSettingsSection />));
    await screen.findByRole('checkbox', { name: 'Show gentle nudges' });
    await fireEvent.press(screen.getByRole('button', { name: 'Quiet from +' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/settings', { method: 'PUT', body: { quietStart: '22:15' } }));

    await fireEvent.press(screen.getByRole('button', { name: 'For 1 hour' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/snooze', { method: 'POST', body: { minutes: 60 } }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Resume now' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/nudges/snooze', { method: 'POST', body: { minutes: 0 } }));
  });

  it('minutesUntilMorning is within the allowed range', () => {
    expect(minutesUntilMorning(new Date(2026, 9, 31, 23, 0))).toBe(8 * 60);
    expect(minutesUntilMorning(new Date(2026, 9, 31, 6, 30))).toBeGreaterThanOrEqual(60);
  });
});
