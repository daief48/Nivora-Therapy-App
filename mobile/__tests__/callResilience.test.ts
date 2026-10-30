import {
  backoffDelay, createRingBuffer, isAuthErrorCode, looksLikeHeadset, reconcilePhase, rmsOfBytes, shouldShowEchoHint, smoothEnergy, watchdogDecision,
} from '../src/utils/callResilience';

describe('pre-roll ring buffer', () => {
  it('keeps only the most recent samples, oldest first', () => {
    const r = createRingBuffer(5);
    r.push(Float32Array.from([1, 2, 3]));
    r.push(Float32Array.from([4, 5, 6, 7]));
    expect(r.size()).toBe(5);
    expect(Array.from(r.drain())).toEqual([3, 4, 5, 6, 7]);
    expect(r.size()).toBe(0);
  });
  it('handles a single chunk larger than the buffer and clears', () => {
    const r = createRingBuffer(3);
    r.push(Float32Array.from([1, 2, 3, 4, 5]));
    expect(Array.from(r.drain())).toEqual([3, 4, 5]);
    r.push(Float32Array.from([9])); r.clear();
    expect(r.drain().length).toBe(0);
  });
});

describe('reconnect backoff', () => {
  it('is 0.5, 1, 2, 4 s then gives up after 5 tries', () => {
    expect([0, 1, 2, 3, 4].map(backoffDelay)).toEqual([500, 1000, 2000, 4000, 4000]);
    expect(backoffDelay(5)).toBeNull();
    expect(backoffDelay(-1)).toBeNull();
  });
  it('recognises token errors', () => {
    expect(isAuthErrorCode('TOKEN_EXPIRED')).toBe(true);
    expect(isAuthErrorCode('UNAUTHORIZED')).toBe(true);
    expect(isAuthErrorCode('RATE_LIMITED')).toBe(false);
  });
});

describe('watchdog', () => {
  const base = { now: 100_000, phaseSince: 100_000, lastAudioAt: 0, doneAt: 0, playing: false };
  it('leaves a normal wait alone and recovers a stuck Thinking after 25 s', () => {
    expect(watchdogDecision({ ...base, phase: 'thinking', now: 120_000 })).toBe('ok');
    expect(watchdogDecision({ ...base, phase: 'thinking', now: 126_000 })).toBe('recover');
  });
  it('recovers a silent speaking state 8 s after assistant_done, but not while audio plays', () => {
    const sp = { ...base, phase: 'speaking' as const, doneAt: 100_000 };
    expect(watchdogDecision({ ...sp, now: 105_000 })).toBe('ok');
    expect(watchdogDecision({ ...sp, now: 109_000 })).toBe('recover');
    expect(watchdogDecision({ ...sp, now: 109_000, playing: true })).toBe('ok');
    expect(watchdogDecision({ ...sp, now: 109_000, lastAudioAt: 107_000 })).toBe('ok');
    expect(watchdogDecision({ ...sp, doneAt: 0, now: 200_000 })).toBe('ok'); // still being written, not done
  });
  it('never touches listening', () => {
    expect(watchdogDecision({ ...base, phase: 'listening', now: 999_999 })).toBe('ok');
  });
});

describe('reconcile and misc heuristics', () => {
  it('follows the server, except while the last sound is still draining', () => {
    expect(reconcilePhase('speaking', { audioPlaying: false })).toBe('speaking');
    expect(reconcilePhase('thinking', { audioPlaying: false })).toBe('thinking');
    expect(reconcilePhase('listening', { audioPlaying: false })).toBe('listening');
    expect(reconcilePhase('listening', { audioPlaying: true })).toBe('speaking');
    expect(reconcilePhase('weird', { audioPlaying: false })).toBe('listening');
  });
  it('turns audio into a smooth 0..1 loudness', () => {
    expect(rmsOfBytes(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsOfBytes(Uint8Array.from([0, 255, 0, 255]))).toBeGreaterThan(0.9);
    const up = smoothEnergy(0, 0.2);
    expect(up).toBeGreaterThan(0.3); expect(up).toBeLessThanOrEqual(1);
    expect(smoothEnergy(up, 0)).toBeLessThan(up);
    expect(smoothEnergy(0.01, 0)).toBe(0);
  });
  it('detects headsets by label and shows the headphones hint once', () => {
    expect(looksLikeHeadset(['Default - MacBook Speakers', 'AirPods Pro'])).toBe(true);
    expect(looksLikeHeadset(['Built-in Microphone'])).toBe(false);
    expect(shouldShowEchoHint({ alreadyShown: false, echoFrames: 0, headset: false })).toBe(true);
    expect(shouldShowEchoHint({ alreadyShown: false, echoFrames: 2, headset: null })).toBe(true);
    expect(shouldShowEchoHint({ alreadyShown: false, echoFrames: 1, headset: true })).toBe(false);
    expect(shouldShowEchoHint({ alreadyShown: true, echoFrames: 9, headset: false })).toBe(false);
  });
});
