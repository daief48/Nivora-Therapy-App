import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
let mockParams: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), dispatch: mockDispatch }),
  useRoute: () => ({ params: mockParams }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));

type Handler = (path: string, opts?: { method?: string; body?: any }) => unknown;
let mockHandler: Handler;
const mockApi = jest.fn(async (path: string, opts?: { method?: string; body?: any }) => {
  const r = mockHandler(path, opts);
  if (r instanceof Error) throw r;
  return r;
});
jest.mock('../src/api/client', () => ({ api: (...a: [string, any]) => mockApi(...a), ApiError: class extends Error {} }));

const mockTrack = jest.fn();
jest.mock('../src/utils/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
import { AssessmentResultScreen } from '../src/screens/AssessmentResultScreen';
import { AssessmentTakeScreen } from '../src/screens/AssessmentTakeScreen';
import { AssessmentsScreen } from '../src/screens/AssessmentsScreen';
import { useSettings } from '../src/store/settings';

const opts4 = [0, 1, 2, 3].map((v) => ({ value: v, label: { en: `opt${v}`, bn: `bn${v}` } }));
const mk = (id: string, n: number, max: number) => ({
  id, title: { en: `${id} title`, bn: id }, intro: { en: 'intro', bn: 'intro' }, timeframe: { en: 'Last 2 weeks', bn: 'x' }, maxScore: max, attribution: { en: 'attr', bn: 'attr' },
  items: Array.from({ length: n }, (_, i) => ({ text: { en: `${id} question ${i + 1}`, bn: `q${i + 1}` }, options: opts4 })),
});
const DEFS = [mk('PHQ9', 9, 27), mk('GAD7', 7, 21), mk('AUDIT', 10, 40)];
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>
);
const old = new Date(Date.now() - 45 * 86_400_000).toISOString();

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockNavigate.mockClear(); mockApi.mockClear(); mockDispatch.mockClear(); mockParams = undefined;
  mockHandler = (p, o) => {
    if (p === '/assessments/instruments') return DEFS;
    if (p.startsWith('/assessments?')) return [{ id: 'a1', instrument: 'GAD7', total: 12, severity: 'moderate', createdAt: old }];
    if (p === '/assessments' && o?.method === 'POST') return { id: 'n1', instrument: o.body.instrument, total: 9, severity: 'mild', createdAt: new Date().toISOString(), item9Flag: o.body.answers[8] > 0, resources: [] };
    return new Error('unmocked ' + p);
  };
});

describe('Assessments list', () => {
  it('shows all three instruments, last result and a due flag for results over 30 days old', async () => {
    await render(wrap(<AssessmentsScreen />));
    expect(await screen.findByText('PHQ9 title')).toBeTruthy();
    expect(screen.getByText('GAD7 title')).toBeTruthy();
    expect(screen.getByText('AUDIT title')).toBeTruthy();
    expect(screen.getAllByText('Not taken yet')).toHaveLength(2);
    expect(screen.getByText('Due for a retake')).toBeTruthy();
    expect(screen.getByText(/Last: 12 \(moderate\)/)).toBeTruthy();
    expect(screen.getAllByText(/not a diagnosis/).length).toBeGreaterThan(0);
  });
});

describe('Take flow', () => {
  it('walks one question at a time and shows the support card when item 9 is above zero', async () => {
    mockParams = { instrument: 'PHQ9' };
    await render(wrap(<AssessmentTakeScreen />));
    for (let q = 1; q <= 8; q++) {
      expect(await screen.findByText(`PHQ9 question ${q}`)).toBeTruthy();
      expect(screen.getByText(`Question ${q} of 9`, { exact: false })).toBeTruthy();
      await fireEvent.press(screen.getByText('opt0'));
      await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    }
    expect(await screen.findByText('PHQ9 question 9')).toBeTruthy();
    expect(screen.queryByText('You are not alone')).toBeNull();
    await fireEvent.press(screen.getByText('opt1'));
    expect(screen.getByText('You are not alone')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open my safety plan' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Get help now' }));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
    await fireEvent.press(screen.getByRole('button', { name: 'See my result' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/assessments', expect.objectContaining({ method: 'POST', body: { instrument: 'PHQ9', answers: [0, 0, 0, 0, 0, 0, 0, 0, 1] } })));
    await waitFor(() => expect(mockTrack).toHaveBeenCalledWith('assessment_completed', { kind: 'phq9' }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ name: 'AssessmentResult', params: expect.objectContaining({ item9Flag: true, total: 9 }) }));
  });

  it('requires an answer before moving on', async () => {
    mockParams = { instrument: 'GAD7' };
    await render(wrap(<AssessmentTakeScreen />));
    expect(await screen.findByText('GAD7 question 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await fireEvent.press(screen.getByText('opt2'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});

describe('Result', () => {
  it('uses supportive wording and states it is not a diagnosis', async () => {
    mockParams = { instrument: 'GAD7', total: 12, severity: 'moderate', item9Flag: false };
    await render(wrap(<AssessmentResultScreen />));
    expect(await screen.findByText('Score 12 out of 21')).toBeTruthy();
    expect(screen.getByText('moderate')).toBeTruthy();
    expect(screen.getByText(/Only a qualified professional can diagnose/)).toBeTruthy();
    expect(screen.getByText('What you could do next')).toBeTruthy();
    expect(screen.queryByText('You are not alone')).toBeNull();
  });
  it('shows the support card when flagged', async () => {
    mockParams = { instrument: 'PHQ9', total: 9, severity: 'mild', item9Flag: true };
    await render(wrap(<AssessmentResultScreen />));
    expect(await screen.findByText('You are not alone')).toBeTruthy();
  });
});
