import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

let mockHandlers: any = {};
let avatarProps: any = {};
let mockFrame: any = null;
const mockPlayFiller = jest.fn(async () => true);
const mockSay = jest.fn(async () => {});
const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => ({ StackActions: { replace: (name: string, params: unknown) => ({ name, params }) }, useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), dispatch: mockDispatch }), useRoute: () => ({ params: { mode: 'video', sittingId: 's1', programId: 'p1' } }) }));
jest.mock('../src/components/SessionBar', () => ({ SessionBar: () => null, useSittingClock: () => ({ remainingSec: null }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/api/hooks', () => ({ useMe: () => ({ data: { locale: 'en', displayName: 'Ayesha' } }), errorMessageKey: () => 'errorTitle' }));
jest.mock('../src/hooks/useConversation', () => ({
  useConversation: () => ({ messages: [], busy: false, errorKey: null, sessionId: 's1', send: jest.fn(), cancel: jest.fn(), finish: jest.fn(async () => {}), ensureSession: jest.fn(async () => 's1'), appendTurn: jest.fn() }),
}));
jest.mock('../src/utils/speech', () => ({
  recognition: () => null, speak: (...a: unknown[]) => (mockSay as any)(...a), stopSpeaking: jest.fn(), speechLocale: () => 'en-US',
  playFiller: (...a: unknown[]) => (mockPlayFiller as any)(...a), warmFiller: jest.fn(async () => null),
  speakStream: () => ({ push: jest.fn(), replace: jest.fn(), end: jest.fn(), cancel: jest.fn() }),
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

/**
 * The REAL Avatar is rendered, with two probes: the props it received (affect, reaction, state) and the
 * frame its art actually drew — so the journey asserts real face expressions, not just wiring.
 */
jest.mock('../src/components/AvatarArt', () => {
  const actual = jest.requireActual('../src/components/AvatarArt');
  return { ...actual, AvatarArt: (p: any) => { mockFrame = p.f; return null; } };
});
jest.mock('../src/components/Avatar', () => {
  const actual = jest.requireActual('../src/components/Avatar');
  const Wrapped = (p: any) => { avatarProps = p; return actual.Avatar(p); };
  return { __esModule: true, Avatar: Wrapped, AvatarMini: actual.AvatarMini };
});

import { CallScreen } from '../src/screens/CallScreen';
import { useSettings } from '../src/store/settings';

beforeEach(async () => {
  jest.useFakeTimers(); useSettings.setState({ reducedMotion: false, ttsMuted: false });
  mockPlayFiller.mockClear(); mockSay.mockClear(); avatarProps = {}; mockHandlers = {}; mockDispatch.mockClear(); mockFrame = null;
  await render(<CallScreen />);
  await fireEvent.press(screen.getByRole('button', { name: /Start video call/ }));
  await act(async () => { jest.advanceTimersByTime(1500); });
});
afterEach(() => jest.useRealTimers());
const settle = async (ms = 600) => { for (let i = 0; i < ms / 50; i++) await act(async () => { jest.advanceTimersByTime(50); }); };

/** One full server-driven voice turn, exactly the frame order the relay sends. */
/** The reply starts being spoken (relay order: deltas → audio start). Assertions can run mid-turn here. */
async function speakTurn(opts: { userSays: string; replyParts: string[]; affect?: { emotion: string; intensity: number } }) {
  await act(async () => { mockHandlers.onPartial(opts.userSays.slice(0, 8)); });
  await act(async () => { mockHandlers.onFinal(opts.userSays); });
  if (opts.affect) await act(async () => { mockHandlers.onAffect(opts.affect); });
  await act(async () => { for (const p of opts.replyParts) mockHandlers.onAssistantDelta(p); });
  await act(async () => { mockHandlers.onAudioStart(); });
  await settle(300);
}
/** The reply finishes and the call returns to listening. */
async function endTurn(crisis = false) {
  await act(async () => { mockHandlers.onAssistantDone(crisis); mockHandlers.onPlaybackEnd(); });
  await settle(200);
}
/** One full server-driven voice turn, exactly the frame order the relay sends. */
async function spokenTurn(opts: { userSays: string; replyParts: string[]; affect?: { emotion: string; intensity: number }; crisis?: boolean }) {
  await speakTurn(opts);
  await endTurn(!!opts.crisis);
}

describe('a whole voice/video call, end to end', () => {
  it('follows the full turn: listening nod → thinking → affect softens the face → speaking → back to listening', async () => {
    // While the user speaks the avatar listens and gives small nods on partials.
    expect(avatarProps.state).toBe('listening');
    await act(async () => { mockHandlers.onPartial('I had such a heavy'); });
    const pulsesAfterPartial = avatarProps.listenPulse;
    expect(pulsesAfterPartial).toBeGreaterThanOrEqual(1);

    await act(async () => { mockHandlers.onFinal('I feel so exhausted this week'); });
    expect(avatarProps.state).toBe('thinking'); // listening stops, she processes
    expect(avatarProps.reaction?.type).toBe('empathy'); // distress words get a caring reaction

    await act(async () => { mockHandlers.onAffect({ emotion: 'sad', intensity: 4 }); });
    expect(avatarProps.affect).toEqual({ emotion: 'sad', intensity: 4 });

    await act(async () => { for (const p of ['That sounds really heavy.', ' I am glad you told me.']) mockHandlers.onAssistantDelta(p); });
    await act(async () => { mockHandlers.onAudioStart(); });
    expect(avatarProps.state).toBe('speaking');
    await settle(400);
    // The face while speaking a heavy moment: concerned tone from the reply, mood softening — never a broad smile.
    expect(mockFrame.smile).toBeLessThanOrEqual(0.2);
    expect(mockFrame.brow).toBeLessThan(0.3);

    await act(async () => { mockHandlers.onAssistantDone(false); mockHandlers.onPlaybackEnd(); });
    expect(avatarProps.state).toBe('listening');
  });

  it('a light, glad moment gets the warm face: relaxed smile, gentle brows', async () => {
    await spokenTurn({ userSays: 'I passed my exam today!', replyParts: ['Congratulations.', ' That is wonderful.'], affect: { emotion: 'joy', intensity: 3 } });
    expect(avatarProps.affect).toEqual({ emotion: 'joy', intensity: 3 });
    await settle(400);
    expect(mockFrame.smile).toBeGreaterThan(0.25);
    expect(mockFrame.joy).toBeGreaterThan(0.1);
  });

  it('the crisis wording in the reply is spoken with a serious caring face and never a smile', async () => {
    await speakTurn({ userSays: 'I cannot go on like this', replyParts: ['Your safety matters.', ' Please reach out to someone you trust right now.'] });
    expect(avatarProps.state).toBe('speaking');
    // Safety wording wins over any cheerfulness while she speaks it.
    expect(mockFrame.smile).toBeLessThanOrEqual(0.2);
    await endTurn(true);
    // Crisis replies on a call show the emergency support alongside the call.
    expect(screen.getByRole('button', { name: /Emergency|জরুরি/ })).toBeTruthy();
  });

  it('a filler stays silent once the reply audio has started', async () => {
    await act(async () => { mockHandlers.onFinal('can we slow down a little'); });
    await act(async () => { mockHandlers.onAudioStart(); }); // the reply began speaking
    await act(async () => { mockHandlers.onFiller('mm'); });
    expect(mockPlayFiller).not.toHaveBeenCalled(); // no filler over the reply's voice
  });

  it('a new turn lets go of the previous reply\'s expression instead of holding it', async () => {
    // A safety-toned reply is spoken first.
    await speakTurn({ userSays: 'I cannot go on like this', replyParts: ['Your safety matters.', ' Please reach out to someone you trust right now.'] });
    await endTurn(true);
    expect(avatarProps.replyTone).toBe('concerned');
    // The user starts the next turn: the face returns to neutral listening until the new reply is spoken.
    await act(async () => { mockHandlers.onFinal('thank you, that helped'); });
    expect(avatarProps.speechText).toBeUndefined();
    expect(avatarProps.replyTone).toBeUndefined();
    expect(avatarProps.tone).toBe('warm');
    // And the reply's own tone comes back as soon as its voice starts (realtime tone comes from the streamed text).
    await act(async () => { for (const p of ['I am glad.', ' What helped most?']) mockHandlers.onAssistantDelta(p); });
    await act(async () => { mockHandlers.onAudioStart(); });
    expect(avatarProps.tone).toBe('cheerful'); // "glad" is a glad moment
    await endTurn(false);
    // The point: replyTone is RE-COMPUTED from the new reply ("I am glad. What helped most?" classifies neutral),
    // never left stale from the previous safety-toned one.
    expect(avatarProps.replyTone).toBe('neutral');
  });
});
