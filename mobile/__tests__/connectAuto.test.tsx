import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }), useFocusEffect: jest.fn() }));
const mockPlayer = () => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn(), loop: false, volume: 1 });
jest.mock('expo-audio', () => ({ createAudioPlayer: () => mockPlayer(), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('../src/utils/wakeAlarm', () => ({
  loadWake: jest.fn(async () => ({ enabled: false, hour: 7, minute: 0, window: 0 })), setWakeWindow: jest.fn(async () => true), WAKE_DEFAULT: { enabled: false, hour: 7, minute: 0, window: 0 },
}));
const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: unknown[]) => mockApi(...a) }));

import { BreathingPacer } from '../src/components/practice/BreathingPacer';
import { ThoughtRecordFlow } from '../src/components/practice/ThoughtRecordFlow';
import { SoundsScreen } from '../src/screens/SoundsScreen';
import { useSettings } from '../src/store/settings';

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const press = async (name: string | RegExp) => { await fireEvent.press(screen.getByRole('button', { name })); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const undo = { method: 'PUT', path: '/sleep/routine/done/breathing', body: { done: false } };

beforeEach(() => { jest.useFakeTimers(); useSettings.setState({ reducedMotion: true, uiLang: 'en' }); mockApi.mockReset(); });
afterEach(() => { jest.useRealTimers(); });

describe('breathing auto-tick', () => {
  it('shows the quiet tick line with Undo, and no flower when already counted', async () => {
    mockApi.mockImplementation(async (path: string) => (path === '/practice/breathing' ? { kaizen: { counted: false, flowers: 3 }, routine: { stepId: 'breathing', marked: true, undo } } : {}));
    await render(wrap(<BreathingPacer />));
    await press('1 min'); await press('Start breathing');
    await act(async () => { jest.advanceTimersByTime(61000); });
    await flush();
    expect(screen.getByText("Ticked off in tonight's routine.")).toBeTruthy();
    expect(screen.queryByText('A flower was added to your garden.')).toBeNull();
    await press('Undo'); await flush();
    expect(mockApi).toHaveBeenCalledWith('/sleep/routine/done/breathing', { method: 'PUT', body: { done: false } });
  });
  it('shows nothing about the routine when it was not marked', async () => {
    mockApi.mockImplementation(async (path: string) => (path === '/practice/breathing' ? { kaizen: { counted: true, flowers: 3 }, routine: null } : {}));
    await render(wrap(<BreathingPacer />));
    await press('1 min'); await press('Start breathing');
    await act(async () => { jest.advanceTimersByTime(61000); });
    await flush();
    expect(screen.getByText('A flower was added to your garden.')).toBeTruthy();
    expect(screen.queryByText("Ticked off in tonight's routine.")).toBeNull();
  });
});

describe('sounds auto-tick', () => {
  it('posts minutes after listening and shows the tick line with Undo', async () => {
    mockApi.mockImplementation(async (path: string) => (path === '/practice/sounds'
      ? { kaizen: { counted: true, flowers: 4 }, routine: { stepId: 'audio', marked: true, undo: { ...undo, path: '/sleep/routine/done/audio' } } } : {}));
    await render(wrap(<SoundsScreen />));
    await fireEvent.press(screen.getByRole('button', { name: /Soft rain.*Play/ }));
    await flush();
    await act(async () => { jest.advanceTimersByTime(3 * 60_000); });
    await press('Stop all'); await flush();
    const call = mockApi.mock.calls.find((c) => c[0] === '/practice/sounds');
    expect(call).toBeTruthy();
    expect(call![1].method).toBe('POST');
    expect(call![1].body.minutes).toBe(3);
    expect(typeof call![1].body.sleepRelated).toBe('boolean');
    expect(screen.getByText('Counted for today.')).toBeTruthy();
    expect(screen.getByText("Ticked off in tonight's routine.")).toBeTruthy();
    await press('Undo'); await flush();
    expect(mockApi).toHaveBeenCalledWith('/sleep/routine/done/audio', { method: 'PUT', body: { done: false } });
  });
  it('stays silent when recording fails', async () => {
    mockApi.mockRejectedValue(new Error('x'));
    await render(wrap(<SoundsScreen />));
    await fireEvent.press(screen.getByRole('button', { name: /Soft rain.*Play/ }));
    await flush();
    await act(async () => { jest.advanceTimersByTime(2 * 60_000); });
    await press('Stop all'); await flush();
    expect(screen.queryByText('Counted for today.')).toBeNull();
  });
});

describe('thought record journal offer', () => {
  async function fill() {
    await fireEvent.changeText(screen.getByLabelText('Just the situation, in a sentence or two.'), 'A hard meeting');
    await press('Next');
    await fireEvent.changeText(screen.getByLabelText('Write the thought as it came, no editing.'), 'I always fail');
    await press('Next'); await press('Skip'); await press('Skip');
    await press('Save thought record'); await flush();
  }
  it('offers the note, saves it with Save, and never claims improvement', async () => {
    const text = 'Today I noticed the thought: I always fail.';
    mockApi.mockImplementation(async (path: string) => (path === '/practice/thought-record'
      ? { crisis: false, entryId: 'e1', kaizen: { counted: true, flowers: 2 }, journalOffer: { entryType: 'DAILY_REFLECTION', text }, routine: null } : {}));
    await render(wrap(<ThoughtRecordFlow />));
    await fill();
    expect(screen.getByText('Save a short note in your journal?')).toBeTruthy();
    expect(screen.queryByText(/better|improv/i)).toBeNull();
    await press('Save note'); await flush();
    expect(mockApi).toHaveBeenCalledWith('/journal', { method: 'POST', body: { entryType: 'DAILY_REFLECTION', content: text } });
  });
  it('shows no offer when journalOffer is null', async () => {
    mockApi.mockImplementation(async (path: string) => (path === '/practice/thought-record' ? { crisis: false, entryId: 'e1', kaizen: { counted: false, flowers: 2 }, journalOffer: null, routine: null } : {}));
    await render(wrap(<ThoughtRecordFlow />));
    await fill();
    expect(screen.queryByText('Save a short note in your journal?')).toBeNull();
  });
});
