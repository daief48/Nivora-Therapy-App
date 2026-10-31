import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { MessageBubble } from '../src/components/MessageBubble';
import { useSettings } from '../src/store/settings';

const reply = { id: 'srv-1', role: 'assistant' as const, content: 'আমি এখানে আছি। I am here with you.' };

beforeEach(() => useSettings.setState({ reducedMotion: true, uiLang: 'en' }));

describe('MessageBubble', () => {
  it("marks Nivora's messages with her identity and shows mixed Bangla/English text", async () => {
    await render(<MessageBubble m={reply} />);
    expect(screen.getByText('AI · Nivora')).toBeTruthy();
    expect(screen.getByText('আমি এখানে আছি। I am here with you.')).toBeTruthy();
  });

  it('read-aloud toggles into stop-reading while that reply is playing', async () => {
    const onSpeak = jest.fn();
    const { rerender } = await render(<MessageBubble m={reply} onSpeak={onSpeak} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Read aloud' }));
    expect(onSpeak).toHaveBeenCalledWith(reply.content);
    await rerender(<MessageBubble m={reply} onSpeak={onSpeak} speaking />);
    expect(screen.queryByRole('button', { name: 'Read aloud' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Stop reading' }));
    expect(onSpeak).toHaveBeenCalledTimes(2);
  });

  it('crisis replies get an emergency shortcut and the user can rate replies', async () => {
    const onEmergency = jest.fn(), onFeedback = jest.fn();
    await render(<MessageBubble m={{ ...reply, crisis: true }} onEmergency={onEmergency} onFeedback={onFeedback} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Emergency help' }));
    expect(onEmergency).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Helpful' }));
    expect(onFeedback).toHaveBeenCalledWith('srv-1', 1);
  });

  it('shows the thinking indicator while a reply is still empty, and retry for failed sends', async () => {
    const { rerender } = await render(<MessageBubble m={{ id: 'local-1', role: 'assistant', content: '' }} />);
    expect(screen.getByLabelText('AI: Thinking…')).toBeTruthy();
    const onRetry = jest.fn();
    await rerender(<MessageBubble m={{ id: 'local-2', role: 'user', content: 'hello', failed: true }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('MessageBubble chat polish', () => {
  const full = { id: 'srv-9', role: 'assistant' as const, content: 'Take your time. I am here.' };

  it('history replies render as plain text with no typing indicator', async () => {
    await render(<MessageBubble m={full} />);
    expect(screen.getByText(full.content)).toBeTruthy();
    expect(screen.queryByTestId('typing-dots')).toBeNull();
  });

  it('shows soft typing dots while waiting, with the thinking label', async () => {
    await render(<MessageBubble m={{ id: 'local-1', role: 'assistant', content: '' }} fresh />);
    expect(screen.getByTestId('typing-dots')).toBeTruthy();
    expect(screen.getByLabelText('AI: Thinking…')).toBeTruthy();
  });

  it('a new reply is revealed gradually, not all at once; reduced motion shows it instantly', async () => {
    jest.useFakeTimers();
    useSettings.setState({ reducedMotion: false });
    await render(<MessageBubble m={full} fresh />);
    expect(screen.queryByText(full.content)).toBeNull(); // still revealing
    expect(screen.getByLabelText(`AI: ${full.content}`)).toBeTruthy(); // full text stays available to screen readers
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(screen.getByText(full.content)).toBeTruthy();
    jest.useRealTimers();
  });

  it('quiet mode reveals more slowly', async () => {
    jest.useFakeTimers();
    useSettings.setState({ reducedMotion: false });
    const long = 'x'.repeat(80);
    await render(<MessageBubble m={{ ...full, content: long }} fresh quiet />);
    await act(async () => { jest.advanceTimersByTime(2000); }); // normal pace (40/s) would be done; quiet is 20/s
    expect(screen.queryByText(long)).toBeNull();
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(screen.getByText(long)).toBeTruthy();
    jest.useRealTimers();
  });

  it('text that streams in live is not re-typed', async () => {
    useSettings.setState({ reducedMotion: false });
    const { rerender } = await render(<MessageBubble m={{ id: 'local-3', role: 'assistant', content: 'Hel' }} fresh />);
    await rerender(<MessageBubble m={{ id: 'local-3', role: 'assistant', content: 'Hello there' }} fresh />);
    expect(screen.getByText('Hello there')).toBeTruthy();
  });

  it('shows the AI badge only when the message carries the ai flag', async () => {
    const { rerender } = await render(<MessageBubble m={full} />);
    expect(screen.queryByText('AI-generated')).toBeNull();
    await rerender(<MessageBubble m={{ ...full, ai: true }} />);
    expect(screen.getByText('AI-generated')).toBeTruthy();
    expect(screen.getByText('AI · Nivora')).toBeTruthy();
  });
});
