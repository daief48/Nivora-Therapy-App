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

import { HomeScreen } from '../src/screens/HomeScreen';
import { useSettings } from '../src/store/settings';

const action = { id: 'a1', title: 'Breathe slowly for 2 minutes', description: 'Breathe in for 4, out for 6.', status: 'PLANNED', micro: false };
const checkIn = (kind: string) => ({ id: kind, kind, mood: 7, stress: 4, energy: 6, createdAt: new Date().toISOString() });

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear();
  mockCheckIns = ok([]);
  mockKaizen = ok({ needsGoal: false, goal: { id: 'g', title: 'Stress', category: 'BREATHING' }, action, progress: { stage: 'SEED' } });
  mockPlan = ok({ focus: 'x', bedtime: '22:30', note: null, items: [{ id: 'morning', time: '08:00', done: false, title: '2-minute morning check-in' }] });
  mockSummary = ok({ sleep: { avgScore: 78 } });
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

  it('asks for the evening check-in later in the day, and invites a chat once both are done', async () => {
    jest.setSystemTime(new Date(2026, 9, 31, 19, 0));
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Evening check-in\./ }));
    expect(mockNavigate).toHaveBeenLastCalledWith('CheckIn', { kind: 'EVENING' });
    mockCheckIns = ok([checkIn('MORNING'), checkIn('EVENING')]);
    await render(<HomeScreen />);
    await fireEvent.press(screen.getAllByRole('button', { name: /Talk to Nivora\./ })[0]!);
    expect(mockNavigate).toHaveBeenLastCalledWith('Chat');
  });

  it('shows today\'s single Kaizen step and the plan', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Breathe slowly for 2 minutes')).toBeTruthy();
    expect(screen.getByText('2-minute morning check-in')).toBeTruthy();
  });

  it('offers text, voice and video talk plus quick actions', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Voice' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Call', { mode: 'voice' });
    await fireEvent.press(screen.getByRole('button', { name: 'Video' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Call', { mode: 'video' });
    await fireEvent.press(screen.getByRole('button', { name: 'Breathe' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('Exercise', { kind: 'breathing' });
    await fireEvent.press(screen.getByRole('button', { name: 'Journal' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('JournalEdit');
  });

  it('is available in Bangla', async () => {
    useSettings.setState({ uiLang: 'bn' });
    await render(<HomeScreen />);
    expect(screen.getByText('শুভ সকাল')).toBeTruthy();
    expect(screen.getByText('আজকের পরিকল্পনা')).toBeTruthy();
  });
});
