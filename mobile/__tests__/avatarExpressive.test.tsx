import { act, render } from '@testing-library/react-native';
import React from 'react';
import { Avatar } from '../src/components/Avatar';
import { useSettings } from '../src/store/settings';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('expressive avatar renders', () => {
  it.each([true, false])('renders with speech props (reducedMotion=%s)', async (reduced) => {
    useSettings.setState({ reducedMotion: reduced });
    const push: { fn?: (v: number) => void } = {};
    const src = (p: (v: number) => void) => { push.fn = p; return () => { push.fn = undefined; }; };
    const view = await render(<Avatar state="speaking" speechText="I hear you. আমি আছি।" replyTone="concerned" amplitudeSource={src} speechEnergy={0.4} />);
    await act(async () => { jest.advanceTimersByTime(600); push.fn?.(0.8); jest.advanceTimersByTime(300); });
    await view.rerender(<Avatar state="listening" replyTone="neutral" listenPulse={1} />);
    await act(async () => { jest.advanceTimersByTime(300); });
    view.unmount();
    expect(push.fn).toBeUndefined();
  });
});
