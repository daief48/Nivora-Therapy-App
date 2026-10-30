import { fireEvent, render, screen } from '@testing-library/react-native';
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
