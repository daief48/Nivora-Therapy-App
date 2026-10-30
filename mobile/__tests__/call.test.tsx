import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import React from 'react';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSend = jest.fn();
const mockFinish = jest.fn(async () => {});
let mockMode: 'voice' | 'video' = 'voice';
let mockOpts: any;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { mode: mockMode } }),
}));
jest.mock('../src/components/SessionBar', () => ({ SessionBar: () => null })); // the session bar has its own tests and needs a query client
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/api/hooks', () => ({ useMe: () => ({ data: { locale: 'en', countryCode: 'BD', displayName: 'Ayesha' } }) }));
jest.mock('../src/hooks/useConversation', () => ({
  useConversation: (o: any) => { mockOpts = o; return { messages: [], busy: false, errorKey: null, sessionId: 's1', send: mockSend, cancel: jest.fn(), finish: mockFinish }; },
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

import { stopSpeaking } from '../src/utils/speech';
import { CallScreen } from '../src/screens/CallScreen';
import { useSettings } from '../src/store/settings';

const START_VOICE = { name: 'Start voice call' };
const START_VIDEO = { name: 'Start video call' };
const connect = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });

describe('CallScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSettings.setState({ reducedMotion: true, ttsMuted: false });
    [mockSend, mockSpeak, mockNavigate, mockGoBack, mockFinish].forEach((m) => m.mockClear());
    mockRecogAvailable = true; mockRecogBehavior = 'hear'; mockMode = 'voice';
  });
  afterEach(() => { jest.useRealTimers(); });

  it('does nothing until the user presses Start (mic is never on by default)', async () => {
    await render(<CallScreen />);
    await connect(3000);
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Start voice call/ })).toBeTruthy();
  });

  it('voice call: rings first ("Calling Nivora…"), then listens, sends, speaks the reply, and listens again', async () => {
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', START_VOICE));
    expect(screen.getByText('Calling Nivora…')).toBeTruthy();
    await connect(300);
    expect(mockSend).not.toHaveBeenCalled(); // still ringing: the mic is not open yet
    await connect(1000);
    expect(mockSend).toHaveBeenCalledWith('I feel anxious');
    await act(async () => { mockOpts.onAssistantDone({ id: 'a', role: 'assistant', content: 'I am here.' }); });
    expect(mockSpeak).toHaveBeenCalledWith('I am here.', 'en', expect.any(Object));
    mockSend.mockClear();
    await act(async () => { mockSpeak.mock.calls[0][2].onDone(); jest.advanceTimersByTime(200); }); // mic only reopens after the AI stops talking
    expect(mockSend).toHaveBeenCalledWith('I feel anxious');
  });

  it('voice call looks like a phone call: shows a running timer, and typing is tucked behind a keypad button', async () => {
    mockRecogBehavior = 'silence';
    await render(<CallScreen />);
    expect(screen.queryByLabelText('Or type instead')).toBeNull();
    await fireEvent.press(screen.getByRole('button', START_VOICE));
    await connect(1000);
    await connect(2500);
    expect(screen.getByText(/^00:0[1-3]$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Type a message' }));
    expect(screen.getByLabelText('Or type instead')).toBeTruthy();
  });

  it('video call looks like a video call: connecting state, "You · camera off" tile, no camera', async () => {
    mockMode = 'video';
    mockRecogBehavior = 'silence';
    await render(<CallScreen />);
    expect(screen.getByText(/not a real person\. Your camera is not used/)).toBeTruthy();
    expect(screen.queryByLabelText('You · Camera off')).toBeNull(); // no self tile before the call
    await fireEvent.press(screen.getByRole('button', START_VIDEO));
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.getByLabelText('You · Camera off')).toBeTruthy();
    await connect(1500);
    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
  });

  it('permission denial ends the call, explains why, offers settings, and typing still works', async () => {
    mockRecogBehavior = 'denied';
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', START_VOICE));
    await connect(1100);
    expect(screen.getByText(/permission was denied/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /End call/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Or type instead'), 'typing instead');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(mockSend).toHaveBeenCalledWith('typing instead');
  });

  it('pauses after repeated silence instead of keeping the mic open', async () => {
    mockRecogBehavior = 'silence';
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', START_VOICE));
    for (let i = 0; i < 16; i++) await act(async () => { jest.advanceTimersByTime(300); }); // each silent turn needs its own act()
    expect(screen.getAllByText(/Paused/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Tap to talk/ })).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('falls back to text when speech recognition is unavailable', async () => {
    mockRecogAvailable = false;
    await render(<CallScreen />);
    expect(screen.getByText(/Speech recognition is not available/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Or type instead'), 'typed message');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(mockSend).toHaveBeenCalledWith('typed message');
  });

  it('End call stops the call, closes the session, and offers to call again', async () => {
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', START_VOICE));
    await connect(1100);
    await fireEvent.press(screen.getByRole('button', { name: 'End call' }));
    expect(mockFinish).toHaveBeenCalledWith(false);
    expect(screen.getByText('Call ended')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Call again' })).toBeTruthy();
  });

  it('can switch to text chat and go back', async () => {
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to text' }));
    expect(mockNavigate).toHaveBeenCalledWith('Chat', { sessionId: 's1' });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('goes quiet and pauses when the app goes to the background, and never listens on its own afterwards', async () => {
    let onChange: ((s: string) => void) | undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, h: (s: string) => void) => { onChange = h; return { remove: jest.fn() }; }) as any);
    mockRecogBehavior = 'silence';
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', START_VOICE));
    await connect(1100);
    (stopSpeaking as jest.Mock).mockClear();
    await act(async () => { onChange?.('background'); });
    expect(stopSpeaking).toHaveBeenCalled();
    expect(screen.getAllByText(/Paused/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Tap to talk/ })).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();
    spy.mockImplementation((() => ({ remove: jest.fn() })) as any);
  });

  it('video call has optional live captions that can be switched off', async () => {
    mockMode = 'video';
    mockRecogBehavior = 'hear';
    await render(<CallScreen />);
    await fireEvent.press(screen.getByRole('button', START_VIDEO));
    await connect(1500);
    expect(screen.getByText(/I feel anxious/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Captions' }));
    expect(screen.queryByText(/I feel anxious/)).toBeNull();
  });
});
