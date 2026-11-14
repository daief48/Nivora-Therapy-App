import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => mockHandler(path, opts));
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: [string, any]) => mockApi(...a) }));

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }), useRoute: () => ({ params: undefined }) }));

import type { KaizenTask } from '../src/api/types';
import { resetFeltPrompt, TaskCard } from '../src/components/kaizen/TaskCard';
import { bn, en, hi, ne } from '../src/i18n/ext/taskCue';
import { useSettings } from '../src/store/settings';

const task = (over: Partial<KaizenTask> = {}): KaizenTask => ({
  id: 'k1', content: 'Drink a glass of water', reason: 'Small and easy', status: 'ACTIVE', stateNote: null, standingStill: false,
  cue: null, cueTime: null, suggestedCue: null, felt: null, createdAt: '2026-11-01T08:00:00Z', completedAt: null, ...over,
});
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const posts = (suffix: string) => mockApi.mock.calls.filter(([p, o]) => p.endsWith(suffix) && o?.method === 'POST');

const setup = async (tk: KaizenTask | null, extra: Partial<{ backoff: boolean; riskMode: boolean }> = {}, post?: Handler) => {
  mockHandler = (path, opts) => {
    if (path === '/kaizen/task' && !opts?.method) return { task: tk, history: [], riskMode: false, backoff: false, ...extra };
    return post?.(path, opts) ?? tk;
  };
  await render(wrap(<TaskCard />));
};

beforeEach(() => { useSettings.setState({ reducedMotion: true, uiLang: 'en' } as never); mockApi.mockClear(); resetFeltPrompt(); });
afterEach(() => cleanup());

describe('Kaizen task cue', () => {
  it('suggested chip fills the input and saves', async () => {
    await setup(task({ suggestedCue: 'after breakfast' }));
    expect(await screen.findByText('When will you do it?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Use: after breakfast'));
    expect(screen.getByDisplayValue('after breakfast')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(posts('/cue')).toHaveLength(1));
    expect(posts('/cue')[0]![1]!.body).toEqual({ cue: 'after breakfast' });
  });

  it('saves a custom cue with a time preset', async () => {
    await setup(task());
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. after breakfast'), 'after lunch');
    await fireEvent.press(screen.getByText('Afternoon'));
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(posts('/cue')).toHaveLength(1));
    expect(posts('/cue')[0]![1]!.body).toEqual({ cue: 'after lunch', time: '14:00' });
  });

  it('shows the saved cue, taps to edit, and clears with an empty cue', async () => {
    await setup(task({ cue: 'after lunch', cueTime: '14:00' }));
    await fireEvent.press(await screen.findByText('after lunch at 14:00'));
    expect(screen.getByDisplayValue('after lunch')).toBeTruthy();
    await fireEvent.press(screen.getByText('Clear'));
    await waitFor(() => expect(posts('/cue')).toHaveLength(1));
    expect(posts('/cue')[0]![1]!.body).toEqual({ cue: '' });
  });

  it('a crisis cue shows the crisis notice and clears the input', async () => {
    const safety = { severity: 'HIGH', crisis: true, resources: [{ name: 'Local line', contactDetails: '999' }], message: 'You are not alone.' };
    await setup(task(), {}, (p) => (p.endsWith('/cue') ? { crisis: true, safety } : undefined));
    const input = await screen.findByPlaceholderText('e.g. after breakfast');
    await fireEvent.changeText(input, 'something worrying');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByTestId('crisis-notice')).toBeTruthy();
    expect(screen.queryByDisplayValue('something worrying')).toBeNull();
  });

  it('backoff shows the gentle line, otherwise not', async () => {
    await setup(task(), { backoff: true });
    expect(await screen.findByText("Let's keep it extra gentle for now.")).toBeTruthy();
  });

  it('no backoff line by default', async () => {
    await setup(task());
    await screen.findByText('Drink a glass of water');
    expect(screen.queryByText("Let's keep it extra gentle for now.")).toBeNull();
  });

  it('riskMode hides the card', async () => {
    await setup(null, { riskMode: true });
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(screen.queryByText('When will you do it?')).toBeNull();
  });
});

describe('Kaizen task felt check', () => {
  it('Done then Better sends felt', async () => {
    await setup(task());
    await fireEvent.press(await screen.findByText('Done'));
    expect(await screen.findByText('How do you feel now?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Better'));
    await waitFor(() => expect(posts('/complete')).toHaveLength(2));
    expect(posts('/complete')[1]![1]!.body).toEqual({ felt: 'BETTER' });
  });

  it('Skip sends no felt and closes the prompt', async () => {
    await setup(task());
    await fireEvent.press(await screen.findByText('Done'));
    await fireEvent.press(await screen.findByText('Skip'));
    await waitFor(() => expect(screen.queryByText('How do you feel now?')).toBeNull());
    expect(posts('/complete')).toHaveLength(1);
    expect(posts('/complete')[0]![1]!.body.felt).toBeUndefined();
  });
});

describe('Kaizen task felt check robustness', () => {
  it('disables chips while pending so a second tap cannot double-submit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await setup(task(), {}, async (p, o) => { if (p.endsWith('/complete') && o?.body?.felt) await gate; return {}; });
    await fireEvent.press(await screen.findByText('Done'));
    await fireEvent.press(await screen.findByText('Better'));
    await fireEvent.press(screen.getByText('Worse'));
    expect(posts('/complete').filter(([, o]) => o?.body?.felt)).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByText('How do you feel now?')).toBeNull());
  });

  it('keeps the prompt open with a gentle line when saving fails, then closes on retry success', async () => {
    let fail = true;
    await setup(task(), {}, (p, o) => { if (p.endsWith('/complete') && o?.body?.felt && fail) throw new Error('boom'); return {}; });
    await fireEvent.press(await screen.findByText('Done'));
    await fireEvent.press(await screen.findByText('Same'));
    expect(await screen.findByText("Couldn't save that. Try again when you like.")).toBeTruthy();
    expect(screen.getByText('How do you feel now?')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByText('Same'));
    await waitFor(() => expect(screen.queryByText('How do you feel now?')).toBeNull());
  });

  it('the prompt survives an unmount/remount', async () => {
    await setup(task());
    await fireEvent.press(await screen.findByText('Done'));
    await screen.findByText('How do you feel now?');
    await screen.unmount();
    await render(wrap(<TaskCard />));
    expect(await screen.findByText('How do you feel now?')).toBeTruthy();
  });

  it('Worse shows an optional, dismissible support nudge', async () => {
    await setup(task(), {}, () => ({}));
    await fireEvent.press(await screen.findByText('Done'));
    await fireEvent.press(await screen.findByText('Worse'));
    expect(await screen.findByText(/Thank you for telling us/)).toBeTruthy();
    expect(screen.queryByTestId('support-options')).toBeNull();
    await fireEvent.press(screen.getByText('See support options'));
    expect(screen.getByTestId('support-options')).toBeTruthy();
    await fireEvent.press(screen.getByText('Not now'));
    await waitFor(() => expect(screen.queryByText(/Thank you for telling us/)).toBeNull());
  });

  it('Better closes without a nudge', async () => {
    await setup(task(), {}, () => ({}));
    await fireEvent.press(await screen.findByText('Done'));
    await fireEvent.press(await screen.findByText('Better'));
    await waitFor(() => expect(screen.queryByText('How do you feel now?')).toBeNull());
    expect(screen.queryByText(/Thank you for telling us/)).toBeNull();
  });
});

describe('Kaizen task server flags', () => {
  it('textSkipped on complete shows the small note line', async () => {
    await setup(task(), {}, (p) => (p.endsWith('/complete') ? { textSkipped: true } : undefined));
    await fireEvent.press(await screen.findByText('Done'));
    expect(await screen.findByText("We couldn't save the note right now.")).toBeTruthy();
  });

  it('textSkipped on react shows the small note line', async () => {
    await setup(task(), {}, (p) => (p.endsWith('/react') ? { textSkipped: true } : undefined));
    await fireEvent.press(await screen.findByText("Can't today"));
    expect(await screen.findByText("We couldn't save the note right now.")).toBeTruthy();
  });

  it('cue saved:false SAFETY_CHECK_UNAVAILABLE shows a retry line and keeps the input', async () => {
    await setup(task(), {}, (p) => (p.endsWith('/cue') ? { saved: false, reason: 'SAFETY_CHECK_UNAVAILABLE' } : undefined));
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. after breakfast'), 'after lunch');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText("We couldn't save that right now. Please try again in a moment.")).toBeTruthy();
    expect(screen.getByDisplayValue('after lunch')).toBeTruthy();
  });

  it('sittingErrorKey maps SAFETY_CHECK_UNAVAILABLE to the gentle retry string', () => {
    const { sittingErrorKey } = require('../src/api/sessionPrograms');
    expect(sittingErrorKey({ code: 'SAFETY_CHECK_UNAVAILABLE' })).toBe('kzSafetyRetry');
    expect(en.kzSafetyRetry).toMatch(/try again/);
  });
});

describe('Kaizen task cue strings', () => {
  it('bn/hi/ne cover every key with no mojibake', () => {
    for (const d of [bn, hi, ne]) {
      expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
      for (const v of Object.values(d)) expect(v).not.toMatch(/[�]|à¦|à¤|Ã/);
    }
    expect(bn.kzCueTitle).toBe('কখন করবেন?');
    expect(bn.kzFeltTitle).toMatch(/[ঀ-৿]/);
  });
});
