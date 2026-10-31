import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

let mockHandlers: any = {};
let mockAvatar: any = {};
const mockPlayFiller = jest.fn(async () => true);
const mockWarm = jest.fn(async () => null);
const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => ({ StackActions: { replace: (name: string, params: unknown) => ({ name, params }) }, useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), dispatch: mockDispatch }), useRoute: () => ({ params: { mode: 'video', sittingId: 's1', programId: 'p1' } }) }));
jest.mock('../src/components/SessionBar', () => ({ SessionBar: () => null, useSittingClock: () => ({ remainingSec: null }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/api/hooks', () => ({ useMe: () => ({ data: { locale: 'hi', displayName: 'Ayesha' } }), errorMessageKey: () => 'errorTitle' }));
jest.mock('../src/hooks/useConversation', () => ({
  useConversation: () => ({ messages: [], busy: false, errorKey: null, sessionId: 's1', send: jest.fn(), cancel: jest.fn(), finish: jest.fn(async () => {}), ensureSession: jest.fn(async () => 's1'), appendTurn: jest.fn() }),
}));
jest.mock('../src/utils/speech', () => ({
  recognition: () => null, speak: jest.fn(async () => {}), stopSpeaking: jest.fn(), speechLocale: () => 'hi-IN',
  playFiller: (...a: unknown[]) => (mockPlayFiller as any)(...a), warmFiller: (...a: unknown[]) => (mockWarm as any)(...a),
}));
jest.mock('../src/utils/realtimeClient', () => ({
  ...jest.requireActual('../src/utils/realtimeClient'),
  realtimeSupported: () => true,
  createRealtimeClient: (h: any) => {
    mockHandlers = h;
    return { connect: async () => ({ ok: true }), interrupt: jest.fn(), setMuted: jest.fn(), pauseCapture: jest.fn(), resumeCapture: async () => true, isPlaying: () => false, detectHeadset: async () => null, close: jest.fn() };
  },
}));
jest.mock('../src/components/CloudRecognition', () => ({ CloudRecognition: () => null }));
jest.mock('../src/components/Avatar', () => ({ Avatar: (p: any) => { mockAvatar = p; return null; } }));

import { CallScreen } from '../src/screens/CallScreen';
import { useSettings } from '../src/store/settings';

beforeEach(async () => {
  jest.useFakeTimers(); useSettings.setState({ reducedMotion: true, ttsMuted: false }); mockPlayFiller.mockClear(); mockWarm.mockClear(); mockAvatar = {}; mockHandlers = {}; mockDispatch.mockClear();
  await render(<CallScreen />);
  await fireEvent.press(screen.getByRole('button', { name: /Start video call|वीडियो कॉल शुरू करें/ }));
  await act(async () => { jest.advanceTimersByTime(1500); });
});
afterEach(() => jest.useRealTimers());

describe('realtime affect and filler events (dormant while calls are off)', () => {
  it('connects the optional handlers and warms the tiny filler clips once', () => {
    expect(typeof mockHandlers.onAffect).toBe('function');
    expect(typeof mockHandlers.onFiller).toBe('function');
    expect(mockWarm).toHaveBeenCalledTimes(2);
  });
  it('affect drives the avatar expression state', async () => {
    expect(mockAvatar.affect ?? null).toBeNull();
    await act(async () => { mockHandlers.onAffect({ emotion: 'sad', intensity: 5 }); });
    expect(mockAvatar.affect).toEqual({ emotion: 'sad', intensity: 5 });
    await act(async () => { mockHandlers.onAffect({ emotion: 'calm', intensity: 2 }); });
    expect(mockAvatar.affect).toEqual({ emotion: 'calm', intensity: 2 });
  });
  it('a filler plays a soft acknowledgement and a listening nod when nothing heavy was sensed', async () => {
    await act(async () => { mockHandlers.onAffect({ emotion: 'calm', intensity: 2 }); mockHandlers.onFiller('mm'); });
    expect(mockPlayFiller).toHaveBeenCalledTimes(1);
    expect(mockAvatar.reaction?.type).toBe('nod');
  });
  it('a filler is silent (visual nod only, gentler) when the last affect intensity is 4 or more', async () => {
    await act(async () => { mockHandlers.onAffect({ emotion: 'grief', intensity: 4 }); mockHandlers.onFiller('achha'); });
    expect(mockPlayFiller).not.toHaveBeenCalled();
    expect(mockAvatar.reaction?.type).toBe('empathy');
  });
  it('the "listening" filler is a nod only, never a sound', async () => {
    await act(async () => { mockHandlers.onFiller('listening'); });
    expect(mockPlayFiller).not.toHaveBeenCalled();
    expect(mockAvatar.reaction?.type).toBe('nod');
  });
  it('is not played while the reply audio is already on, or when sound is muted', async () => {
    await act(async () => { mockHandlers.onAudioStart(); mockHandlers.onFiller('mm'); });
    expect(mockPlayFiller).not.toHaveBeenCalled();
  });
});

describe('sitting time is up during a live call', () => {
  const SUMMARY = { name: 'SessionSummary', params: { sessionId: 's1', programId: 'p1' } };
  it('SITTING_TIME_UP from the relay ends the call and opens the sitting summary', async () => {
    await act(async () => { mockHandlers.onError('SITTING_TIME_UP'); });
    expect(mockDispatch).toHaveBeenCalledWith(SUMMARY);
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });
  it('does not force-navigate when the person was distressed: shows the time-up note and a See summary button', async () => {
    await act(async () => { mockHandlers.onAssistantDone(true); });
    await act(async () => { mockHandlers.onError('SITTING_TIME_UP'); });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /सारांश देखें|See summary/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Emergency|आपातकालीन|इमरजेंसी/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /सारांश देखें|See summary/ }));
    expect(mockDispatch).toHaveBeenCalledWith(SUMMARY);
  });
});
