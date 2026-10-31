import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), dispatch: jest.fn() }),
  useRoute: () => ({ params: { sessionId: 's1' } }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));
const mockStream = jest.fn();
jest.mock('../src/api/stream', () => ({ streamMessage: (...a: unknown[]) => mockStream(...a) }));
const mockApi = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('../src/api/client', () => ({ api: (...a: unknown[]) => mockApi(...a), ApiError: class extends Error {} }));
jest.mock('../src/api/hooks', () => ({
  errorMessageKey: () => 'errorTitle',
  useMe: () => ({ data: { locale: 'en' } }),
  useSession: () => ({ data: { messages: [], status: 'ACTIVE' }, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
}));
jest.mock('../src/api/sessionPrograms', () => ({
  callModeOf: (m: string) => m.toLowerCase(), minutesLeft: () => 1, modesOf: () => ['TEXT'], sittingErrorKey: () => null, switchSittingMode: jest.fn(),
  useProgram: () => ({ data: undefined }),
}));
jest.mock('../src/components/SessionBar', () => ({ SessionBar: () => null, useSittingClock: () => ({ remainingSec: null }) }));
jest.mock('../src/utils/speech', () => ({ speak: jest.fn(), stopSpeaking: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

import type { ActionCardData } from '../src/api/actions';
import { useConversation } from '../src/hooks/useConversation';
import { ChatScreen } from '../src/screens/ChatScreen';
import { useSettings } from '../src/store/settings';

const card = (over: Partial<ActionCardData> = {}): ActionCardData => ({
  offerId: 'o1', id: 'GROUNDING', kind: 'GROUNDING', crisis: false, minutes: 3, deepLink: { route: 'Exercise', params: { kind: 'grounding' } }, surface: 'CHAT',
  title: 'Ground yourself', why: 'It can bring you back to the room.', reason: 'You mentioned racing thoughts.', cta: 'Try it', notNow: 'Not now',
  titleKey: 't', whyKey: 'w', reasonKey: 'r', ...over,
});
const safe = { severity: 'NONE', crisis: false, resources: [] };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { jest.useFakeTimers(); mockStream.mockReset(); mockNavigate.mockClear(); mockApi.mockClear(); useSettings.setState({ reducedMotion: true, uiLang: 'en' }); });
afterEach(() => jest.useRealTimers());

const streamWith = (opts: { sse?: ActionCardData; done?: ActionCardData | null; safety?: unknown; text?: string }) => {
  const text = opts.text ?? 'That sounds heavy. I am here with you.';
  mockStream.mockImplementation(async (_s: string, _t: string, h: { onDelta: (d: string) => void; onAction?: (id: string, a: ActionCardData) => void }) => {
    h.onDelta(text);
    if (opts.sse) h.onAction?.('srv-1', opts.sse);
    return { message: { id: 'srv-1', role: 'assistant', content: text, createdAt: '' }, safety: opts.safety ?? safe, action: opts.done ?? null };
  });
};
const say = async () => {
  await fireEvent.changeText(screen.getByPlaceholderText('Write a message…'), 'my thoughts are racing');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await flush();
};

describe('useConversation action handling', () => {
  it('keeps the card from the SSE action event, keyed by the reply it belongs to', async () => {
    streamWith({ sse: card(), done: card() });
    const { result } = await renderHook(() => useConversation({ sessionId: 's1', language: 'en', sessionType: 'TEXT' }));
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(result.current.actions['srv-1']?.id).toBe('GROUNDING');
    expect(result.current.lastAction?.messageId).toBe('srv-1');
    await act(async () => { result.current.dismissAction('srv-1'); });
    expect(result.current.actions['srv-1']).toBeUndefined();
  });
  it('takes the action from the plain send result too (turn-based path)', async () => {
    streamWith({ done: card({ id: 'SOUNDS' }) });
    const { result } = await renderHook(() => useConversation({ sessionId: 's1', language: 'en', sessionType: 'VOICE' }));
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(result.current.actions['srv-1']?.id).toBe('SOUNDS');
  });
  it('no action means no card', async () => {
    streamWith({});
    const { result } = await renderHook(() => useConversation({ sessionId: 's1', language: 'en', sessionType: 'TEXT' }));
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(result.current.actions).toEqual({});
  });
});

describe('ChatScreen action card', () => {
  it('shows the card under the reply it belongs to and opens the target on Try it', async () => {
    streamWith({ sse: card(), done: card() });
    await render(<ChatScreen />);
    await say();
    expect(screen.getByText('Ground yourself')).toBeTruthy();
    expect(screen.getByText('You mentioned racing thoughts.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try it' }));
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/o1/outcome', { method: 'POST', body: { outcome: 'ACCEPTED', surface: 'CHAT' } });
    expect(mockNavigate).toHaveBeenCalledWith('Exercise', { kind: 'grounding' });
  });
  it('the card thumbs call the action outcome endpoint', async () => {
    streamWith({ done: card() });
    await render(<ChatScreen />);
    await say();
    // two "Helpful" buttons: the message's and the card's; the card's is the last one
    const helpful = screen.getAllByRole('button', { name: 'Helpful' });
    await fireEvent.press(helpful[helpful.length - 1]!);
    await flush();
    expect(mockApi).toHaveBeenCalledWith('/actions/o1/outcome', { method: 'POST', body: { outcome: 'THUMBS_UP', surface: 'CHAT' } });
  });
  it('is hidden in quiet mode (risk / crisis reply)', async () => {
    streamWith({ done: card(), safety: { severity: 'ELEVATED', crisis: false, resources: [{ name: 'Helpline' }] } });
    await render(<ChatScreen />);
    await say();
    expect(screen.queryByText('Ground yourself')).toBeNull();
  });
  it('still shows a crisis (support) card in quiet mode', async () => {
    const sup = card({ crisis: true, id: 'SAFETY_PLAN', kind: 'CRISIS', title: 'Your safety plan', cta: 'Open it', deepLink: { route: 'SafetyPlan' } });
    streamWith({ done: sup, safety: { severity: 'ELEVATED', crisis: false, resources: [{ name: 'Helpline' }] } });
    await render(<ChatScreen />);
    await say();
    expect(screen.getByText('Your safety plan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });
});
