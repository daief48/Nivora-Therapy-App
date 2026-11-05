import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }), useRoute: () => ({ params: undefined }) }));

const ok = (data: unknown) => ({ isLoading: false, isError: false, error: null, data, refetch: jest.fn() });
let mockCheckIns: any, mockKaizen: any, mockPlan: any, mockSummary: any;
jest.mock('../src/api/hooks', () => ({
  useMe: () => ok({ displayName: 'Ayesha', locale: 'en' }),
  useCheckIns: () => mockCheckIns, useKaizenToday: () => mockKaizen, usePlan: () => mockPlan, useSummary: () => mockSummary,
  useInvalidatingMutation: () => ({ mutateAsync: jest.fn(async () => ({})), mutate: jest.fn(), isPending: false }),
  errorMessageKey: () => 'errorTitle',
}));

let mockPrograms: any;
const mockMutate = jest.fn();
jest.mock('../src/api/sessionPrograms', () => ({ ...jest.requireActual('../src/api/sessionPrograms'), usePrograms: () => mockPrograms, patchProgram: jest.fn(), startSitting: jest.fn(), sittingErrorKey: () => null, errorDetail: () => undefined, useProgramMutation: () => ({ mutate: mockMutate, isPending: false }) }));

jest.mock('../src/api/today', () => ({ useTodayFeed: () => ({ data: undefined, isError: false }), dismissNudge: jest.fn(async () => {}) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeScreen } from '../src/screens/HomeScreen';
import { useSettings } from '../src/store/settings';

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
const action = { id: 'a1', title: 'Breathe slowly for 2 minutes', description: 'Breathe in for 4, out for 6.', status: 'PLANNED', micro: false };
const checkIn = (kind: string) => ({ id: kind, kind, mood: 7, stress: 4, energy: 6, createdAt: new Date().toISOString() });

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockMutate.mockClear();
  mockCheckIns = ok([]);
  mockKaizen = ok({ needsGoal: false, goal: { id: 'g', title: 'Stress', category: 'BREATHING' }, action, progress: { stage: 'SEED' } });
  mockPlan = ok({ focus: 'x', bedtime: '22:30', note: null, items: [{ id: 'morning', time: '08:00', done: false, title: '2-minute morning check-in' }] });
  mockSummary = ok({ sleep: { avgScore: 78 } });
  mockPrograms = ok([]);
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 9, 0));
});
afterEach(() => jest.useRealTimers());

describe('Home', () => {
  it('greets by name and keeps emergency help one tap away', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Ayesha')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Emergency help' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Emergency');
  });

  it('puts the morning check-in first in the morning', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Morning check-in\./ }));
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckIn', { kind: 'MORNING' });
  });

  it('asks for the evening check-in later in the day, and points to Sessions once both are done', async () => {
    jest.setSystemTime(new Date(2026, 9, 31, 19, 0));
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Evening check-in\./ }));
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckIn', { kind: 'EVENING' });
    mockCheckIns = ok([checkIn('MORNING'), checkIn('EVENING')]);
    await render(<HomeScreen />);
    await fireEvent.press(screen.getAllByRole('button', { name: /Your sessions\./ })[0]!);
    expect(mockNavigate).toHaveBeenLastCalledWith('Tabs', { screen: 'SessionsTab' });
  });

  it('no longer shows the old daily Kaizen step card', async () => {
    await render(wrap(<HomeScreen />));
    expect(screen.queryByText('Breathe slowly for 2 minutes')).toBeNull();
    expect(screen.queryByText("Choose one thing to improve little by little.")).toBeNull();
  });

  it('has no standalone chat, call or video entry (they only exist inside a sitting), only quick actions', async () => {
    await render(<HomeScreen />);
    for (const name of ['Voice', 'Video', 'Text', 'Talk to Nivora']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('Call', expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Breathe' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Exercise', { kind: 'breathing' });
    await fireEvent.press(screen.getByRole('button', { name: 'Journal' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('JournalEdit');
  });

  it("shows today's sitting card and disables Start when done for today", async () => {
    const prog = { id: 'p1', title: 'Calmer evenings', status: 'ACTIVE', todayState: 'READY', currentDay: 3, plannedDays: 14, dailyMinutes: 30, topic: null, nextAvailableAt: null, lastSittingAt: null, activeSittingId: null };
    mockPrograms = ok([prog]);
    await render(wrap(<HomeScreen />));
    expect(screen.getByText("Today's sitting")).toBeTruthy();
    expect(screen.getByRole('button', { name: /Calmer evenings: Start today's sitting/ })).toBeTruthy();
    mockPrograms = ok([{ ...prog, todayState: 'DONE_TODAY', nextAvailableAt: new Date(2026, 10, 1, 9).toISOString() }]);
    await render(wrap(<HomeScreen />));
    expect(screen.getAllByRole('button', { name: 'Done for today' })[0]!.props.accessibilityState.disabled).toBe(true);
  });

  describe("Today's sitting mode picker", () => {
    const prog = (over: object = {}) => ({ id: 'p1', title: 'Calmer evenings', status: 'ACTIVE', todayState: 'READY', currentDay: 3, plannedDays: 14, dailyMinutes: 30, topic: null, nextAvailableAt: null, lastSittingAt: null, activeSittingId: null, ...over });
    const START = { name: /Calmer evenings: Start today's sitting/ };
    beforeEach(() => useSettings.setState({ sittingModes: {} }));

    it('is skipped when only text is available: Start begins a text sitting straight away', async () => {
      mockPrograms = ok([prog({ availableModes: ['TEXT'] })]);
      await render(wrap(<HomeScreen />));
      await fireEvent.press(screen.getByRole('button', START));
      expect(screen.queryByText('How would you like to talk today?')).toBeNull();
      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'TEXT' }), expect.anything());
    });

    it('is not on screen until Start is pressed, then offers exactly the available modes', async () => {
      mockPrograms = ok([prog({ availableModes: ['TEXT', 'VOICE', 'VIDEO'] })]);
      await render(wrap(<HomeScreen />));
      expect(screen.queryByText('How would you like to talk today?')).toBeNull();
      await fireEvent.press(screen.getByRole('button', START));
      expect(screen.getByText('How would you like to talk today?')).toBeTruthy();
      for (const m of [/^Text\./, /^Voice\./, /^Video\./]) expect(screen.getAllByRole('button', { name: m }).length).toBe(1);
      expect(mockMutate).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: /^Video\./ }));
      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'VIDEO' }), expect.anything());
    });

    it('does not offer a mode the program does not allow', async () => {
      mockPrograms = ok([prog({ availableModes: ['TEXT', 'VOICE'] })]);
      await render(wrap(<HomeScreen />));
      await fireEvent.press(screen.getByRole('button', START));
      expect(screen.getByRole('button', { name: /^Voice\./ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Video\./ })).toBeNull();
    });
  });

  it('is available in Bangla', async () => {
    useSettings.setState({ uiLang: 'bn' });
    await render(<HomeScreen />);
    expect(screen.getByText('শুভ সকাল')).toBeTruthy();
    expect(screen.getByText('আজকের পরিকল্পনা')).toBeTruthy();
  });
});
