import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import React from 'react';

const mockStream = jest.fn();
jest.mock('../src/api/stream', () => ({ streamMessage: (...a: unknown[]) => mockStream(...a) }));
jest.mock('../src/api/client', () => ({ api: jest.fn(async () => ({ id: 's1' })), ApiError: class extends Error {} }));
jest.mock('../src/api/hooks', () => ({ errorMessageKey: () => 'errorTitle', useSession: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

import { MessageBubble } from '../src/components/MessageBubble';
import { useConversation } from '../src/hooks/useConversation';
import { useSettings } from '../src/store/settings';

const safe = { severity: 'NONE', crisis: false, resources: [] };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { jest.useFakeTimers(); mockStream.mockReset(); useSettings.setState({ reducedMotion: true, uiLang: 'en' }); });
afterEach(() => jest.useRealTimers());

const run = async (humanPacing: boolean, safety: unknown = safe, text = 'Hello there, I am here.') => {
  mockStream.mockImplementation(async (_s: string, _t: string, h: { onDelta: (d: string) => void }) => {
    h.onDelta(text);
    return { message: { id: 'srv-1', content: text, createdAt: '' }, safety };
  });
  return await renderHook(() => useConversation({ sessionId: 's1', language: 'en', sessionType: 'TEXT', humanPacing }));
};
const reply = (r: { current: ReturnType<typeof useConversation> }) => r.current.messages.find((m) => m.role === 'assistant');

describe('minimum natural pause before the first streamed words', () => {
  it('holds the first words until the pause has passed (400 ms for a short reply), then shows them', async () => {
    const { result } = await run(true);
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(reply(result)?.content).toBe('');
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(reply(result)?.content).toBe('');
    await act(async () => { jest.advanceTimersByTime(200); });
    await flush();
    expect(reply(result)?.content).toBe('Hello there, I am here.');
    expect(reply(result)?.id).toBe('srv-1');
  });
  it('is skipped entirely when pacing is off (reduce-motion, voice, tests)', async () => {
    const { result } = await run(false);
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(reply(result)?.content).toBe('Hello there, I am here.');
  });
  it('never delays a safety / crisis reply', async () => {
    const { result } = await run(true, { severity: 'HIGH', crisis: true, resources: [] }, 'You are not alone. Please call the helpline now.');
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(reply(result)?.content).toBe('You are not alone. Please call the helpline now.');
  });
  it('does not delay an error: the failed message is shown at once', async () => {
    mockStream.mockRejectedValue(Object.assign(new (require('../src/api/client').ApiError)('x'), { code: 'AI_DOWN', isNetwork: false }));
    const { result } = await renderHook(() => useConversation({ sessionId: 's1', language: 'en', sessionType: 'TEXT', humanPacing: true }));
    await act(async () => { void result.current.send('hi'); });
    await flush();
    expect(result.current.errorKey).not.toBeNull();
  });
});

const longText = 'That sounds like a lot to carry on your own. It makes sense that you feel tired after a week like that. Let us take it one small step at a time, and you can tell me what feels heaviest right now.';
const msg = { id: 'local-9', role: 'assistant' as const, content: longText };

describe('typing indicator and two-bubble reply', () => {
  it('typing dots appear a beat after send', async () => {
    useSettings.setState({ reducedMotion: false });
    await render(<MessageBubble m={{ id: 'local-1', role: 'assistant', content: '' }} />);
    expect(screen.queryByTestId('typing-dots')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(screen.getByTestId('typing-dots')).toBeTruthy();
  });
  it('shows the dots at once when reduce-motion is on', async () => {
    useSettings.setState({ reducedMotion: true });
    await render(<MessageBubble m={{ id: 'local-1', role: 'assistant', content: '' }} />);
    expect(screen.getByTestId('typing-dots')).toBeTruthy();
  });
  it('splits a fresh finished long reply into two bubbles with a pause, as ONE accessible element with the full text', async () => {
    useSettings.setState({ reducedMotion: false });
    await render(<MessageBubble m={msg} fresh finished />);
    expect(screen.queryByTestId('bubble-second')).toBeNull();
    expect(screen.getAllByLabelText(`AI: ${longText}`)).toHaveLength(1);
    await act(async () => { jest.advanceTimersByTime(1100); });
    expect(screen.getByTestId('bubble-second')).toBeTruthy();
    expect(screen.getAllByLabelText(`AI: ${longText}`)).toHaveLength(1);
  });
  it('shows both bubbles at once under reduced motion; history, streaming and crisis replies are not split', async () => {
    useSettings.setState({ reducedMotion: true });
    const { rerender } = await render(<MessageBubble m={msg} fresh finished />);
    expect(screen.getByTestId('bubble-second')).toBeTruthy();
    await rerender(<MessageBubble m={msg} fresh finished={false} />);
    expect(screen.queryByTestId('bubble-second')).toBeNull();
    await rerender(<MessageBubble m={msg} finished />);
    expect(screen.queryByTestId('bubble-second')).toBeNull();
    await rerender(<MessageBubble m={{ ...msg, crisis: true }} fresh finished />);
    expect(screen.queryByTestId('bubble-second')).toBeNull();
    await rerender(<MessageBubble m={{ ...msg, noSplit: true }} fresh finished />); // ELEVATED: support footer must not wait in a second bubble
    expect(screen.queryByTestId('bubble-second')).toBeNull();
  });
  it('read-aloud acts on the whole reply', async () => {
    useSettings.setState({ reducedMotion: true });
    const onSpeak = jest.fn();
    await render(<MessageBubble m={{ ...msg, id: 'srv-5' }} fresh finished onSpeak={onSpeak} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Read aloud' }));
    expect(onSpeak).toHaveBeenCalledWith(longText);
  });
});
