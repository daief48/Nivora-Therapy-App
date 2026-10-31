import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import React from 'react';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSend = jest.fn();
const mockFinish = jest.fn(async () => {});
const mockDispatch = jest.fn();
const mockSwitch = jest.fn(async (..._a: unknown[]) => ({}));
const mockPause = jest.fn(async (..._a: unknown[]) => {});
let mockParams: any = null;
let mockLeft: number | null = null;
let mockErrCode: string | null = null;
let mockCrisis: any = null;
let mockMode: 'voice' | 'video' = 'voice';
let mockOpts: any;
let mockLast: any = null;
jest.mock('@react-navigation/native', () => ({
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, dispatch: mockDispatch }),
  useRoute: () => ({ params: mockParams ?? { mode: mockMode, sittingId: 's1', programId: 'p1' } }),
}));
jest.mock('../src/api/sessionPrograms', () => ({ switchSittingMode: (...a: unknown[]) => mockSwitch(...a) }));
jest.mock('../src/utils/pauseSitting', () => ({ pauseSitting: (...a: unknown[]) => mockPause(...a) }));
jest.mock('../src/components/SessionBar', () => ({ SessionBar: () => null, useSittingClock: () => ({ remainingSec: mockLeft }) })); // the session bar has its own tests and needs a query client
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/api/hooks', () => ({ useMe: () => ({ data: { locale: 'en', countryCode: 'BD', displayName: 'Ayesha' } }) }));
jest.mock('../src/hooks/useConversation', () => ({
  useConversation: (o: any) => { mockOpts = o; return { lastAction: mockLast, messages: [], busy: false, errorKey: null, errorCode: mockErrCode, crisisResources: mockCrisis, sessionId: 's1', send: mockSend, cancel: jest.fn(), finish: mockFinish }; },
}));

let mockRecogAvailable = true;
let mockRecogBehavior: 'denied' | 'hear' | 'silence' = 'hear';
const mockSpeak = jest.fn();
jest.mock('../src/utils/speech', () => ({
  recognition: () => (mockRecogAvailable ? { ExpoSpeechRecognitionModule: {} } : null),
  speak: (...a: any[]) => mockSpeak(...a), stopSpeaking: jest.fn(), speechLocale: () => 'en-US',
}));
// Fake call-mode recognizer: reacts when the screen opens the "listening turn" (listenNow=true).
jest.mock('../src/components/RecognitionControls', () => {
  const R = require('react');
  return {
    RecognitionControls: ({ listenNow, onError, onTranscript }: any) => {
      R.useEffect(() => {
        if (!listenNow) return;
        if (mockRecogBehavior === 'denied') onError('denied');
        else if (mockRecogBehavior === 'hear') onTranscript('I feel anxious', true);
        else onError('none');
      }, [listenNow]);
      return null;
    },
  };
});

const mockApiPost = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('../src/api/client', () => ({ api: (...a: unknown[]) => mockApiPost(...a), ApiError: class extends Error {} }));
import { CallScreen } from '../src/screens/CallScreen';
import { useSettings } from '../src/store/settings';

const card = (over: object = {}) => ({
  offerId: 'o1', id: 'GRATITUDE_NOTE', kind: 'JOURNAL', crisis: false, minutes: 2, deepLink: { route: 'Exercise', params: { kind: 'gratitude' } }, surface: 'CALL',
  title: 'One good thing', why: 'A moment of thanks can soften a hard day.', reason: 'You mentioned feeling stretched.', cta: 'Try it', notNow: 'Not now',
  titleKey: 't', whyKey: 'w', reasonKey: 'r', ...over,
});
const connect = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });

describe('CallScreen action overlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSettings.setState({ reducedMotion: true, ttsMuted: false, uiLang: 'en' });
    [mockSend, mockNavigate, mockGoBack, mockFinish, mockDispatch, mockApiPost].forEach((m) => m.mockClear());
    mockParams = { mode: 'voice', sittingId: 's1' }; mockLeft = null; mockErrCode = null; mockCrisis = null; mockLast = null;
    mockRecogAvailable = true; mockRecogBehavior = 'silence';
  });
  afterEach(() => { jest.useRealTimers(); });
  const ui = () => <QueryClientProvider client={new QueryClient()}><CallScreen /></QueryClientProvider>;
  const startAndOffer = async () => {
    const r = await render(ui());
    await fireEvent.press(screen.getByRole('button', { name: 'Start voice call' }));
    await connect(1500);
    mockLast = { messageId: 'm1', action: card() };
    await r.rerender(ui());
    return r;
  };

  it('shows the card as an overlay without navigating and keeps Emergency and hang-up reachable', async () => {
    await startAndOffer();
    expect(screen.getByText('One good thing')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Emergency help' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('Try it keeps the action for after the call and only opens it once the call has ended', async () => {
    await startAndOffer();
    await fireEvent.press(screen.getByRole('button', { name: 'Try it' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("I'll keep this for after our call.")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'End call' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(mockDispatch).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('ActionGratitude');
  });

  it('Not now hides the card and records the dismissal; nothing opens', async () => {
    await startAndOffer();
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('One good thing')).toBeNull();
    expect(mockApiPost).toHaveBeenCalledWith('/actions/o1/outcome', expect.objectContaining({ body: expect.objectContaining({ outcome: 'DISMISSED' }) }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('a non-crisis card is hidden once the person is in a crisis view', async () => {
    mockCrisis = [{ name: 'Helpline' }];
    await startAndOffer();
    expect(screen.queryByText('One good thing')).toBeNull();
  });
});
