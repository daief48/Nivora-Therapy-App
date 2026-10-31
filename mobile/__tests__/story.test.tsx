import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ api: (...a: [string, any]) => mockApi(...a), ApiError: class extends Error {} }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///card.pdf' })), printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

import { MonthStory } from '../src/components/MonthStory';
import { Garden } from '../src/components/Garden';
import { MoodChart } from '../src/components/MoodChart';
import { InsightsScreen } from '../src/screens/InsightsScreen';
import { GardenScreen } from '../src/screens/GardenScreen';
import { useSettings } from '../src/store/settings';
import { SEASON_PALETTE, shareCardSvg, shareShapes } from '../src/utils/shareCard';
import type { Monthly } from '../src/api/monthly';

const share = { periodDays: 30, daysLogged: 20, avgMood: 3.8, avgStress: 2.4, avgSleepScore: 72, kaizenDone: 9, season: 'SPRING' as const, strongestPattern: { a: 'sleepScore' as const, b: 'mood' as const, direction: 'together' as const, strength: 'moderate' as const } };
const series = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, mood: 3 + (i % 3), stress: 2, energy: 3, sleepScore: 70, sleepHours: 7, kaizenDone: (i % 2) as 0 | 1, steps: null, activeMin: null }));
const monthly = (over: Partial<Monthly> = {}): Monthly => ({
  enough: true, periodDays: 30, daysLogged: 20, minDaysRequired: 14,
  averages: { mood: 3.8, stress: 2.4, energy: 3, sleepScore: 72, sleepHours: 7, steps: null, activeMin: null },
  kaizenDone: 9, series, correlations: [{ a: 'sleepScore', b: 'mood', r: 0.5, n: 18, strength: 'moderate', direction: 'together' }, { a: 'kaizenDone', b: 'stress', r: -0.4, n: 15, strength: 'moderate', direction: 'opposite' }],
  weekdays: [], bestMoodWeekday: { weekday: 'Saturday', mood: 4.5, stress: 2, sleepScore: 70, days: 3 }, lowestMoodWeekday: { weekday: 'Monday', mood: 3, stress: 3, sleepScore: 60, days: 3 },
  narrative: { headline: 'A steady month.', text: 'You checked in 20 days.', ai: false }, season: 'SPRING', share, ...over,
});
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const consentErr = Object.assign(new Error('consent'), { code: 'CONSENT_REQUIRED', details: { consentType: 'WELLNESS_AI_SHARING' } });

beforeEach(() => { useSettings.setState({ reducedMotion: false, uiLang: 'en' } as never); mockApi.mockClear(); });

describe('MonthStory', () => {
  it('shows narrative, AI badge only when narrative.ai, plain correlation language', async () => {
    const { rerender } = await render(wrap(<MonthStory data={monthly()} />));
    expect(screen.getByText('A steady month.')).toBeTruthy();
    expect(screen.queryByText('AI-generated')).toBeNull();
    await rerender(wrap(<MonthStory data={monthly({ narrative: { headline: 'Calm.', text: 'Text.', ai: true } })} />));
    expect(screen.getByText('AI-generated')).toBeTruthy();
    expect(screen.getByText(/Sleep quality and mood a little tended to go together/i)).toBeTruthy();
    expect(screen.getByText(/When taking a Kaizen step was higher, stress a little tended to be lower/i)).toBeTruthy();
    expect(screen.queryByText(/cause/i, { exact: false })?.props.children).toMatch(/not causes/);
  });
  it('advances on tap and renders under reduced motion', async () => {
    useSettings.setState({ reducedMotion: true } as never);
    await render(wrap(<MonthStory data={monthly()} />));
    await fireEvent.press(screen.getByTestId('story-card-0'));
    expect(screen.getAllByTestId(/story-dot-/, { includeHiddenElements: true })).toHaveLength(6);
    expect(screen.getByText('A steady month.')).toBeTruthy();
  });
});

describe('share card', () => {
  it('uses only aggregates: extra personal fields never reach the output', () => {
    const polluted = { ...share, notes: 'MY SECRET JOURNAL', text: 'private words' } as typeof share;
    const svg = shareCardSvg(polluted, { title: 'My month with Nivora', sub: 'Spring' });
    expect(svg).not.toMatch(/SECRET|private/);
    expect(shareShapes(polluted).length).toBeGreaterThan(20);
    expect(svg).toContain('My month with Nivora');
  });
  it('differs by season palette', () => {
    expect(shareCardSvg({ ...share, season: 'WINTER' }, { title: 'x', sub: 'y' })).toContain(SEASON_PALETTE.WINTER.bg);
  });
});

describe('Insights screen', () => {
  it('enough:false shows the friendly state and no consent prompt', async () => {
    mockHandler = (p) => (p.startsWith('/insights/monthly') ? monthly({ enough: false, daysLogged: 5, narrative: null }) : p.startsWith('/insights/tags') ? { overall: {}, tags: [] } : new Error('x'));
    await render(wrap(<InsightsScreen />));
    expect(await screen.findByText('Not enough yet')).toBeTruthy();
    expect(screen.getByText(/5 of 14/)).toBeTruthy();
    expect(screen.queryByText('Allow and continue')).toBeNull();
  });
  it('on CONSENT_REQUIRED shows the prompt and still shows stats via ai=0', async () => {
    mockHandler = (p) => {
      if (p === '/insights/monthly?days=30&ai=1') return consentErr;
      if (p === '/insights/monthly?days=30&ai=0') return monthly();
      return p.startsWith('/insights/tags') ? { overall: {}, tags: [] } : new Error('x');
    };
    await render(wrap(<InsightsScreen />));
    expect(await screen.findByText('Allow and continue')).toBeTruthy();
    expect(await screen.findByText('A steady month.')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/insights/monthly?days=30&ai=0');
    mockHandler = (p, o) => (p === '/consents' ? { ok: true } : p === '/insights/monthly?days=30&ai=1' ? monthly({ narrative: { headline: 'AI headline.', text: 't', ai: true } }) : p.startsWith('/insights/tags') ? { overall: {}, tags: [] } : monthly());
    await act(async () => { fireEvent.press(screen.getByText('Allow and continue')); });
    await waitFor(() => expect(screen.getByText('AI headline.')).toBeTruthy());
    expect(screen.getByText('AI-generated')).toBeTruthy();
    expect(screen.queryByText('Allow and continue')).toBeNull();
  });
});

describe('MoodChart / Garden', () => {
  const pts = [{ label: '1', mood: 3, stress: 2, count: 1 }, { label: '2', mood: 4, stress: 2, count: 1 }];
  it('chart renders fully under reduced motion', async () => {
    useSettings.setState({ reducedMotion: true } as never);
    await render(<MoodChart points={pts} />);
    expect(screen.getByLabelText(/1: 3, 2: 4/)).toBeTruthy();
  });
  const flowers = [{ id: 'a', date: '2026-10-01', kind: 'BLOOM' as const, index: 0 }, { id: 'b', date: '2026-10-02', kind: 'BLOOM' as const, index: 1 }];
  it('garden background follows the season and new blooms get a pop wrapper', async () => {
    const { rerender } = await render(<Garden flowers={flowers} total={2} label="g" season="AUTUMN" newCount={1} />);
    expect(screen.getByLabelText('g').props.style.backgroundColor).toBe(SEASON_PALETTE.AUTUMN.bg);
    expect(screen.getAllByTestId('garden-new-bloom')).toHaveLength(1);
    await rerender(<Garden flowers={flowers} total={2} label="g" season="WINTER" />);
    expect(screen.getByLabelText('g').props.style.backgroundColor).toBe(SEASON_PALETTE.WINTER.bg);
    expect(screen.queryAllByTestId('garden-new-bloom')).toHaveLength(0);
  });
  it('garden screen announces new flowers vs last seen total, and never shows fewer', async () => {
    const AS = require('@react-native-async-storage/async-storage');
    await AS.setItem('nivora.garden.seenTotal', '1');
    mockHandler = () => ({ total: 2, days: [], flowers, season: 'SUMMER', seasonLabel: 'Summer' });
    await render(wrap(<GardenScreen />));
    expect(await screen.findByText('A new flower opened')).toBeTruthy();
    await waitFor(async () => expect(await AS.getItem('nivora.garden.seenTotal')).toBe('2'));
  });
});
