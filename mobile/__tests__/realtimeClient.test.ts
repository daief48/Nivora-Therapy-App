import { base64ToPcm16, floatToPcm16, paceWait, pcm16ToBase64, pcm16ToFloat, realtimeSupported, realtimeUrl, replyPauseMs, resample, turnStarted } from '../src/utils/realtimeClient';

describe('realtime client helpers', () => {
  it('is not supported on native (Expo managed has no PCM microphone stream) so the turn-based path is used', () => {
    expect(realtimeSupported()).toBe(false);
  });
  it('builds a ws URL without any token in it', () => {
    expect(realtimeUrl('https://api.example.com/')).toBe('wss://api.example.com/api/v1/realtime');
    expect(realtimeUrl('http://localhost:4010')).toBe('ws://localhost:4010/api/v1/realtime');
  });
  it('resamples 48 kHz to 24 kHz (half the samples) and keeps the shape', () => {
    const input = new Float32Array(4800).map((_, i) => Math.sin(i / 20));
    const out = resample(input, 48000, 24000);
    expect(out.length).toBe(2400);
    expect(out[10]).toBeCloseTo(input[20]!, 3);
    expect(resample(input, 24000, 24000)).toBe(input);
  });
  it('round-trips PCM16 through base64', () => {
    const f = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
    const p = floatToPcm16(f);
    expect(p[3]).toBe(0x7fff); expect(p[4]).toBe(-0x8000); expect(p[5]).toBe(0x7fff); // clipped
    const back = base64ToPcm16(pcm16ToBase64(p));
    expect(Array.from(back)).toEqual(Array.from(p));
    expect(pcm16ToFloat(back)[1]).toBeCloseTo(0.5, 2);
  });
  it('leaves a longer natural beat after a longer message, and never waits once the model was already slow', () => {
    expect(replyPauseMs('ok')).toBeLessThan(replyPauseMs('x'.repeat(200)));
    jest.useFakeTimers();
    turnStarted('x'.repeat(200));
    expect(paceWait()).toBeGreaterThan(0);
    jest.advanceTimersByTime(2000);
    expect(paceWait()).toBe(0);
    jest.useRealTimers();
  });
});
