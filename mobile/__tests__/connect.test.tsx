import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

let mockParams: { id?: string } | undefined;
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => ({ record: jest.fn(), stop: jest.fn(), uri: null }),
}));
const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: unknown[]) => mockApi(...a) }));

import { ApiError } from '../src/api/client';
import { AiControlsSection } from '../src/components/AiControls';
import { JournalStepCard } from '../src/components/JournalStepCard';
import { NudgeSettingsSection } from '../src/components/NudgeSettings';
import { JournalOfferCard } from '../src/components/practice/JournalOfferCard';
import { PracticeDone } from '../src/components/practice/parts';
import { RoutineTicked } from '../src/components/RoutineTicked';
import { bn, en, hi, ne } from '../src/i18n/ext/connect';
import { AiSeesScreen } from '../src/screens/AiSeesScreen';
import { JournalEditScreen } from '../src/screens/JournalScreen';
import { RoutineScreen, SleepScreen } from '../src/screens/SleepScreens';
import { useSettings } from '../src/store/settings';

const wrap = (ui: React.ReactElement, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
const press = async (name: string | RegExp) => { await fireEvent.press(screen.getByRole('button', { name })); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const calls = (method: string, path: string | RegExp) => mockApi.mock.calls.filter(([p, o]) => (typeof path === 'string' ? p === path : path.test(p)) && (o?.method ?? 'GET') === method);

const step = { actionId: 'a1', category: 'REST', minutes: 2 as const, unit: 'minutes', title: 'Stretch your shoulders', why: 'Tired bodies like a little movement.', reason: 'Because you wrote that you felt tired', reasonKey: 'journal_step' };

beforeEach(() => { useSettings.setState({ reducedMotion: true, uiLang: 'en' }); mockApi.mockReset(); mockNavigate.mockClear(); mockParams = undefined; });

describe('connect strings', () => {
  it('has every key in every language', () => {
    for (const d of [bn, hi, ne]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
  });
  it('keeps {n} placeholders and has no empty text', () => {
    for (const d of [en, bn, hi, ne]) for (const v of Object.values(d)) expect(v.length).toBeGreaterThan(0);
    for (const d of [bn, hi, ne]) expect(d.cnStepMin).toContain('{n}');
  });
});

describe('JournalStepCard', () => {
  it('adds the step to today and says so; shows the reason as a small line', async () => {
    mockApi.mockResolvedValue({ added: true, skipped: null, alreadyDone: false, action: { id: 'k1', title: 'x' }, flowers: 3 });
    await render(wrap(<JournalStepCard entryId="e1" step={step} />));
    expect(screen.getByText("Add as today's small step?")).toBeTruthy();
    expect(screen.getByText('Stretch your shoulders')).toBeTruthy();
    expect(screen.getByText('Because you wrote that you felt tired')).toBeTruthy();
    await press('Add it'); await flush();
    expect(calls('POST', '/journal/e1/kaizen-step')).toHaveLength(1);
    expect(screen.getByText("Added to today's small steps.")).toBeTruthy();
  });

  it('asks for the journal consent on 403 and retries after it is granted', async () => {
    mockApi.mockImplementation(async (path: string, o?: { method?: string }) => {
      if (path === '/journal/e1/kaizen-step' && mockApi.mock.calls.filter((c) => c[0] === path).length === 1) throw new ApiError(403, 'CONSENT_REQUIRED', 'x', { consentType: 'JOURNAL_AI_SHARING' });
      if (path === '/consents') return {};
      return { added: true, skipped: null, alreadyDone: false, action: null };
    });
    await render(wrap(<JournalStepCard entryId="e1" step={step} />));
    await press('Add it'); await flush();
    expect(screen.getByText('One small thing first')).toBeTruthy();
    await press('Allow and continue'); await flush();
    await waitFor(() => expect(screen.getByText("Added to today's small steps.")).toBeTruthy());
  });

  it('shows nothing at all when the server skips it for risk', async () => {
    mockApi.mockResolvedValue({ added: false, skipped: 'RISK', action: null });
    const { toJSON } = await render(wrap(<JournalStepCard entryId="e1" step={step} />));
    await press('Add it'); await flush();
    expect(screen.queryByText("Add as today's small step?")).toBeNull();
    expect(JSON.stringify(toJSON())).not.toContain('Stretch');
  });

  it('is kind when the step was already done, and Not now simply closes it', async () => {
    mockApi.mockResolvedValue({ added: false, skipped: null, alreadyDone: true, action: { id: 'k1', title: 'x' } });
    await render(wrap(<JournalStepCard entryId="e1" step={step} />));
    await press('Add it'); await flush();
    expect(screen.getByText('You have already done this one today. Nice.')).toBeTruthy();
  });

  it('Not now closes it without a request', async () => {
    await render(wrap(<JournalStepCard entryId="e1" step={step} />));
    await press('Not now');
    expect(screen.queryByText("Add as today's small step?")).toBeNull();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('JournalEditScreen reading', () => {
  const entry = (reading: unknown) => ({ id: 'e1', entryType: 'FREE', content: 'I felt tired', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', reading });
  const setup = (reading: unknown) => {
    mockParams = { id: 'e1' };
    mockApi.mockImplementation(async (path: string) => (path === '/journal/e1' ? entry(reading) : path === '/consents' ? [] : undefined));
  };
  it('shows a stored reading with its step', async () => {
    setup({ emotions: ['tired'], reflection: 'A heavy day.', suggestion: 'Rest.', ai: true, step });
    await render(wrap(<JournalEditScreen />));
    await waitFor(() => expect(screen.getByText('A heavy day.')).toBeTruthy());
    expect(screen.getByText("Add as today's small step?")).toBeTruthy();
  });
  it('shows no step card when the reading has none (step null)', async () => {
    setup({ emotions: ['tired'], reflection: 'A heavy day.', suggestion: 'Rest.', ai: true, step: null });
    await render(wrap(<JournalEditScreen />));
    await waitFor(() => expect(screen.getByText('A heavy day.')).toBeTruthy());
    expect(screen.queryByText("Add as today's small step?")).toBeNull();
  });
});

describe('Sleep Coach -> tonight\'s routine', () => {
  const sleepApi = (coach: unknown, add: unknown = { added: true }) => mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith('/sleep?')) return { entries: [], breakdown: null };
    if (path.startsWith('/insights/timeline')) return [];
    if (path === '/sleep/coach') return coach;
    if (path === '/sleep/routine/steps') return add;
    return undefined;
  });
  it('adds the suggested step', async () => {
    sleepApi({ text: 'Try dimming the lights.', routineStep: { stepId: 'DIM_LIGHTS', label: 'Dim the lights', minutes: 5 } });
    await render(wrap(<SleepScreen />));
    await press('Get a suggestion'); await flush();
    expect(screen.getByText('Try dimming the lights.')).toBeTruthy();
    await press("Add to tonight's routine"); await flush();
    expect(calls('POST', '/sleep/routine/steps')[0]![1].body).toEqual({ stepId: 'DIM_LIGHTS' });
    expect(screen.getByText("Added to tonight's routine.")).toBeTruthy();
  });
  it('says kindly when it was already there, and shows no button when there is no step', async () => {
    sleepApi({ text: 'Try dimming the lights.', routineStep: { stepId: 'DIM_LIGHTS', label: 'Dim the lights', minutes: 5 } }, { added: false });
    await render(wrap(<SleepScreen />));
    await press('Get a suggestion'); await flush();
    await press("Add to tonight's routine"); await flush();
    expect(screen.getByText("That is already in tonight's routine.")).toBeTruthy();
  });
  it('no add button when routineStep is null', async () => {
    sleepApi({ text: 'Sleep well.', routineStep: null });
    await render(wrap(<SleepScreen />));
    await press('Get a suggestion'); await flush();
    expect(screen.queryByRole('button', { name: "Add to tonight's routine" })).toBeNull();
  });
});

describe('RoutineScreen', () => {
  const base = { desiredBedtime: '22:30', tonightBedtime: '22:30' };
  const stepsNew = [
    { id: 'breathing', at: '21:45', kind: 'breathing', minutes: 5, label: 'Breathing', extra: false, done: false },
    { id: 'DIM_LIGHTS', at: '21:55', kind: 'extra', minutes: 5, label: 'Dim the lights', extra: true, done: false },
    { id: 'sleep', at: '22:30', kind: 'sleep', minutes: 0, label: 'Sleep', extra: false, done: false },
  ];
  it('toggles a step with PUT done, and removes an added step with DELETE', async () => {
    const routine = { ...base, steps: stepsNew, doneIds: [], extras: ['DIM_LIGHTS'] };
    mockApi.mockImplementation(async (path: string, o?: { method?: string }) => {
      if (path === '/sleep/routine' && !o?.method) return routine;
      if (path === '/me') return { preferences: {} };
      if (path.startsWith('/sleep/routine/done/')) return { ...routine, doneIds: ['breathing'], steps: stepsNew.map((s) => (s.id === 'breathing' ? { ...s, done: true } : s)) };
      if (o?.method === 'DELETE') return { ...routine, steps: stepsNew.filter((s) => !s.extra), extras: [] };
      return {};
    });
    await render(wrap(<RoutineScreen />));
    await waitFor(() => expect(screen.getByText(/Dim the lights/)).toBeTruthy());
    expect(screen.getByText('Added by you')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('checkbox')[0]!); await flush();
    expect(calls('PUT', '/sleep/routine/done/breathing')[0]![1].body).toEqual({ done: true });
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0]!.props.accessibilityState.checked).toBe(true));
    await press('Remove'); await flush();
    expect(calls('DELETE', '/sleep/routine/steps/DIM_LIGHTS')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/Dim the lights/)).toBeNull());
  });
  it('still works with the old shape (no labels, no doneIds)', async () => {
    const old = { ...base, stepsDone: 1, stepsTotal: 2, steps: [{ id: 'breathing', at: '21:45', kind: 'breathing', minutes: 5 }, { id: 'reflection', at: '22:00', kind: 'reflection', minutes: 5 }, { id: 'sleep', at: '22:30', kind: 'sleep', minutes: 0 }] };
    mockApi.mockImplementation(async (path: string, o?: { method?: string }) => (path === '/sleep/routine' && !o?.method ? old : {}));
    await render(wrap(<RoutineScreen />));
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(2));
    expect(screen.getAllByRole('checkbox')[0]!.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getAllByRole('checkbox')[1]!); await flush();
    expect(calls('POST', '/sleep/routine/log')[0]![1].body).toEqual({ stepsDone: 2, stepsTotal: 2 });
  });
});

describe('auto-tick and undo', () => {
  const marked = { stepId: 'breathing', marked: true, stepsDone: 1, stepsTotal: 2, undo: { method: 'PUT' as const, path: '/sleep/routine/done/breathing', body: { done: false } } };
  it('shows a quiet line and Undo calls the returned request', async () => {
    mockApi.mockResolvedValue({});
    await render(wrap(<RoutineTicked routine={marked} />));
    expect(screen.getByText("Ticked off in tonight's routine.")).toBeTruthy();
    await press('Undo'); await flush();
    expect(mockApi).toHaveBeenCalledWith('/sleep/routine/done/breathing', { method: 'PUT', body: { done: false } });
    expect(screen.getByText('Okay, put back.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
  it('renders nothing when not marked or null', async () => {
    const { toJSON } = await render(wrap(<RoutineTicked routine={{ ...marked, marked: false, undo: null }} />));
    expect(toJSON()).toBeNull();
    const b = await render(wrap(<RoutineTicked routine={null} />));
    expect(b.toJSON()).toBeNull();
  });
  it('a failed undo is gentle', async () => {
    mockApi.mockRejectedValue(new ApiError(500, 'X', 'x'));
    await render(wrap(<RoutineTicked routine={marked} />));
    await press('Undo'); await flush();
    expect(screen.getByText('Could not undo just now.')).toBeTruthy();
  });
  it('PracticeDone shows flower only when counted, and the tick line when marked', async () => {
    await render(wrap(<PracticeDone title="Done" recorded={{ counted: false, flowers: 3 }} routine={marked} />));
    expect(screen.queryByText('A flower was added to your garden.')).toBeNull();
    expect(screen.getByText("Ticked off in tonight's routine.")).toBeTruthy();
  });
});

describe('thought record journal offer', () => {
  const offer = { entryType: 'DAILY_REFLECTION' as const, text: 'Today I noticed: I always fail.' };
  it('saves the note through POST /journal', async () => {
    mockApi.mockResolvedValue({});
    await render(wrap(<JournalOfferCard offer={offer} />));
    expect(screen.getByText('Save a short note in your journal?')).toBeTruthy();
    await press('Save note'); await flush();
    expect(mockApi).toHaveBeenCalledWith('/journal', { method: 'POST', body: { entryType: 'DAILY_REFLECTION', content: offer.text } });
    expect(screen.getByText('Saved in your journal.')).toBeTruthy();
  });
  it('Not now closes without saving', async () => {
    await render(wrap(<JournalOfferCard offer={offer} />));
    await press('Not now');
    expect(screen.queryByText('Save a short note in your journal?')).toBeNull();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('SESSION_INVITE toggle', () => {
  it('lists the gentle invitation and switches it with PUT types', async () => {
    const settings = { enabled: true, quietStart: '22:00', quietEnd: '07:00', snoozedUntil: null, types: { WIND_DOWN: true, MOOD_CHECKIN: true, WEEKLY_REVIEW: true, MORNING_PLAN: true, SESSION_INVITE: true } };
    mockApi.mockImplementation(async (path: string) => (path === '/nudges/settings' ? settings : undefined));
    await render(wrap(<NudgeSettingsSection />));
    const box = await screen.findByRole('checkbox', { name: 'Gentle invitation to talk' });
    expect(box.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(box); await flush();
    expect(calls('PUT', '/nudges/settings')[0]![1].body).toEqual({ types: { SESSION_INVITE: false } });
  });
});

describe('suggestion level', () => {
  it('reads the level and saves a change with PUT /me/ai-settings', async () => {
    mockApi.mockImplementation(async (path: string, o?: { method?: string; body?: any }) => {
      if (path === '/me/ai-settings' && !o?.method) return { suggestionLevel: 'SOMETIMES', analyticsOptIn: false, levels: [] };
      if (path === '/me/ai-settings') return { suggestionLevel: o!.body.suggestionLevel ?? 'SOMETIMES', analyticsOptIn: o!.body.analyticsOptIn ?? false };
      return undefined;
    });
    const onOpen = jest.fn();
    await render(wrap(<AiControlsSection onOpenAiSees={onOpen} />));
    const sometimes = await screen.findByRole('button', { name: 'Sometimes' });
    expect(sometimes.props.accessibilityState.selected).toBe(true);
    await press('Rarely'); await flush();
    expect(calls('PUT', '/me/ai-settings')[0]![1].body).toEqual({ suggestionLevel: 'RARELY' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rarely' }).props.accessibilityState.selected).toBe(true));
    await press('Never'); await flush();
    expect(await screen.findByText('Nivora will not offer suggestions on its own.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Share anonymous usage counts (never what you write)' })); await flush();
    expect(calls('PUT', '/me/ai-settings')[2]![1].body).toEqual({ analyticsOptIn: true });
    await press('What the AI sees');
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('AiSeesScreen', () => {
  const data = {
    consents: [
      { type: 'JOURNAL_AI_SHARING', granted: true, grantedAt: 'x', covers: ['JOURNAL_TEXT', 'EMOTION_WORDS', 'FUTURE_THING'], features: ['emotion_words'] },
      { type: 'WELLNESS_AI_SHARING', granted: false, grantedAt: null, covers: ['MOOD_STRESS_NUMBERS'], features: ['weekly_report'] },
    ],
    features: [
      { key: 'emotion_words', usesModel: true, consent: 'JOURNAL_AI_SHARING', data: ['EMOTION_WORDS'], allowed: true },
      { key: 'weekly_report', usesModel: true, consent: 'WELLNESS_AI_SHARING', data: [], allowed: false },
      { key: 'today_feed', usesModel: false, consent: null, data: [], allowed: true },
      { key: 'brand_new_feature', usesModel: false, consent: null, data: [], allowed: true },
    ],
    neverSent: ['PASSWORD', 'SAFETY_PLAN', 'SOMETHING_NEW'],
    suggestionLevel: 'SOMETIMES', analyticsOptIn: false, links: { privacy: 'Privacy' },
  };
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string, o?: { method?: string }) => {
      if (path === '/privacy/ai-data') return data;
      if (path === '/consents' && !o?.method) return [{ id: 'c1', consentType: 'JOURNAL_AI_SHARING', consentVersion: '1', grantedAt: 'x', withdrawnAt: null }];
      return {};
    });
  });
  it('shows consents, model vs rules features, never-sent list and tolerates unknown keys', async () => {
    await render(wrap(<AiSeesScreen />));
    await screen.findByText('Journal sharing');
    expect(screen.getByText('Wellness sharing')).toBeTruthy();
    expect(screen.getByText('• The words in your journal')).toBeTruthy();
    expect(screen.getByText('• Other data')).toBeTruthy(); // unknown data key
    expect(screen.getByText('Uses an AI model')).toBeTruthy();
    expect(screen.getByText('Built-in rules, no AI')).toBeTruthy();
    expect(screen.getByText('The cards on Today')).toBeTruthy();
    expect(screen.getByText('Brand new feature')).toBeTruthy(); // unknown feature key
    expect(screen.getAllByText('Needs a permission that is off')).toHaveLength(1);
    expect(screen.getByText('Never sent to the AI')).toBeTruthy();
    expect(screen.getByText('• Your password')).toBeTruthy();
    expect(screen.getByText('• Something new')).toBeTruthy();
  });
  it('turns a permission off and on with the existing consent endpoints, and links to Privacy', async () => {
    await render(wrap(<AiSeesScreen />));
    await screen.findByText('Journal sharing');
    await press('Journal sharing: Turn off'); await flush();
    expect(calls('DELETE', '/consents/c1')).toHaveLength(1);
    await press('Wellness sharing: Turn on'); await flush();
    expect(calls('POST', '/consents')[0]![1].body).toEqual({ consentType: 'WELLNESS_AI_SHARING' });
    await press('Open Privacy');
    expect(mockNavigate).toHaveBeenCalledWith('Privacy');
  });
});
