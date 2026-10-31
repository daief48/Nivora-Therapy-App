import { act, render } from '@testing-library/react-native';
import React from 'react';

let mockFrame: any = null;
jest.mock('../src/components/AvatarArt', () => {
  const actual = jest.requireActual('../src/components/AvatarArt');
  return { ...actual, AvatarArt: (p: any) => { mockFrame = p.f; return null; } };
});
import { Avatar } from '../src/components/Avatar';
import { useSettings } from '../src/store/settings';

beforeEach(() => { jest.useFakeTimers(); mockFrame = null; });
afterEach(() => jest.useRealTimers());

const settle = async (ms = 1500) => { for (let i = 0; i < ms / 50; i++) await act(async () => { jest.advanceTimersByTime(50); }); };

describe('avatar follows the affect event', () => {
  it('animated: heavy sadness softens the brows, lowers the smile and lids; light joy relaxes into a smile', async () => {
    useSettings.setState({ reducedMotion: false });
    const view = await render(<Avatar state="speaking" tone="cheerful" affect={null} />);
    await settle();
    const cheerful = { ...mockFrame };
    await view.rerender(<Avatar state="speaking" tone="cheerful" affect={{ emotion: 'sad', intensity: 5 }} />);
    await settle();
    expect(mockFrame.brow).toBeLessThan(-0.3);
    expect(mockFrame.smile).toBeLessThanOrEqual(0.15);
    expect(mockFrame.lid).toBeGreaterThan(cheerful.lid);
    expect(mockFrame.sparkle).toBe(0);
    await view.rerender(<Avatar state="speaking" affect={{ emotion: 'calm', intensity: 2 }} />);
    await settle();
    expect(mockFrame.smile).toBeGreaterThan(0.3);
  });
  it('is never cheerful while distressed, whatever tone or reaction is asked for', async () => {
    useSettings.setState({ reducedMotion: false });
    await render(<Avatar state="speaking" tone="cheerful" replyTone="encouraging" reaction={{ type: 'joy', key: 1 }} affect={{ emotion: 'anxious', intensity: 4 }} />);
    await settle();
    expect(mockFrame.smile).toBeLessThanOrEqual(0.15);
    expect(mockFrame.joy).toBeLessThan(0.1);
  });
  it('reduce-motion: a still, mood-shaped pose with no animation loop', async () => {
    useSettings.setState({ reducedMotion: true });
    await render(<Avatar state="speaking" affect={{ emotion: 'grief', intensity: 5 }} />);
    expect(mockFrame.brow).toBeLessThan(-0.3);
    expect(mockFrame.smile).toBeLessThanOrEqual(0.1);
    const snap = JSON.stringify(mockFrame);
    await settle(600);
    expect(JSON.stringify(mockFrame)).toBe(snap);
  });
  it('unknown emotions and missing affect leave the face as before', async () => {
    useSettings.setState({ reducedMotion: true });
    await render(<Avatar state="speaking" affect={{ emotion: 'zzz', intensity: 5 }} />);
    const a = mockFrame.brow;
    await render(<Avatar state="speaking" />);
    expect(mockFrame.brow).toBe(a);
  });
  it('active listening: while the user speaks she nods slowly and her gaze moves a little', async () => {
    useSettings.setState({ reducedMotion: false });
    await render(<Avatar state="listening" />);
    const xs = new Set<number>(); let maxNod = -9, minNod = 9;
    for (let i = 0; i < 160; i++) { await act(async () => { jest.advanceTimersByTime(50); }); xs.add(Math.round(mockFrame.lookX * 10)); maxNod = Math.max(maxNod, mockFrame.nod); minNod = Math.min(minNod, mockFrame.nod); }
    expect(xs.size).toBeGreaterThan(3);
    expect(maxNod - minNod).toBeGreaterThan(0.5);
    expect(maxNod).toBeLessThan(5);
  });
});
