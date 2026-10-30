import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockSend = jest.fn();
let mockOpts: any;
let mockAvatar: any = {};
let mockSaid = 'I am so happy today!';
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }), useRoute: () => ({ params: { mode: 'video' } }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/api/hooks', () => ({ useMe: () => ({ data: { locale: 'bn', displayName: 'Ayesha' } }) }));
jest.mock('../src/hooks/useConversation', () => ({
  useConversation: (o: any) => { mockOpts = o; return { messages: [], busy: false, errorKey: null, sessionId: 's1', send: mockSend, cancel: jest.fn(), finish: jest.fn(async () => {}) }; },
}));
jest.mock('../src/utils/speech', () => ({ recognition: () => ({ ExpoSpeechRecognitionModule: {} }), speak: jest.fn(async () => {}), stopSpeaking: jest.fn(), speechLocale: () => 'bn-BD' }));
jest.mock('../src/components/Avatar', () => ({ Avatar: (p: any) => { mockAvatar = p; return null; } }));
// Scripted microphone: the user "speaks" a sentence word by word (interim results), then it finalises.
jest.mock('../src/components/CloudRecognition', () => {
  const R = require('react');
  return {
    CloudRecognition: ({ listenNow, onListening, onTranscript }: any) => {
      R.useEffect(() => {
        if (!listenNow) return;
        onListening(true);
        const words = mockSaid.split(' ');
        let acc = '';
        words.forEach((w: string, i: number) => { acc = acc ? `${acc} ${w}` : w; if (i < words.length - 1) onTranscript(acc, false); });
        onListening(false);
        onTranscript(mockSaid, true);
      }, [listenNow]);
      return null;
    },
  };
});

import { CallScreen } from '../src/screens/CallScreen';
import { useSettings } from '../src/store/settings';

const start = async () => {
  await render(<CallScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Start video call' }));
  await act(async () => { jest.advanceTimersByTime(1500); });
};

beforeEach(() => { jest.useFakeTimers(); useSettings.setState({ reducedMotion: true }); mockSend.mockClear(); mockAvatar = {}; });
afterEach(() => jest.useRealTimers());

describe('avatar behaviour during a call', () => {
  it('listens: while the user is speaking she gets nod pulses as the words come in', async () => {
    mockSaid = 'আজ আমার মন খুব খারাপ লাগছে অনেক চাপ';
    await render(<CallScreen />);
    expect(mockAvatar.listenPulse).toBe(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Start video call' }));
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(mockAvatar.listenPulse).toBeGreaterThan(0);
  });

  it('reacts with empathy to sad words, then sends them to the AI', async () => {
    mockSaid = 'আজ আমার মন খারাপ';
    await start();
    expect(mockSend).toHaveBeenCalledWith('আজ আমার মন খারাপ');
    expect(mockAvatar.reaction?.type).toBe('empathy');
  });

  it('reacts with joy to happy news', async () => {
    mockSaid = 'I am so happy, I passed my exam';
    await start();
    expect(mockAvatar.reaction?.type).toBe('joy');
  });

  it('reacts with curiosity to a question', async () => {
    mockSaid = 'why do I feel like this?';
    await start();
    expect(mockAvatar.reaction?.type).toBe('curious');
  });

  it('gives a simple nod to a plain statement', async () => {
    mockSaid = 'I went to the market and bought bread';
    await start();
    expect(mockAvatar.reaction?.type).toBe('nod');
  });

  it('shows a serious, caring face (never a smile) for severe wording', async () => {
    mockSaid = 'ami morte chai';
    await start();
    expect(mockAvatar.reaction?.type).toBe('concern');
  });

  it('speaks her reply with a matching tone', async () => {
    mockSaid = 'hello there';
    await start();
    await act(async () => { mockOpts.onAssistantDone({ id: 'a', role: 'assistant', content: 'That is wonderful news, I am so glad!' }); });
    expect(mockAvatar.tone).toBe('cheerful');
    await act(async () => { mockOpts.onAssistantDone({ id: 'b', role: 'assistant', content: 'I am sorry, that sounds exhausting.' }); });
    expect(mockAvatar.tone).toBe('warm');
    await act(async () => { mockOpts.onAssistantDone({ id: 'c', role: 'assistant', content: 'Please contact emergency services if you are in danger.' }); });
    expect(mockAvatar.tone).toBe('concerned');
  });
});
