/**
 * Unit tests for scoreToAvatarState mapping and avatar state logic.
 * These run without any React Native runtime (pure TS logic only).
 */
import { scoreToAvatarState } from '../src/components/sleep/SleepAvatar';

describe('scoreToAvatarState', () => {
  it('returns awake when score is null', () => {
    expect(scoreToAvatarState(null)).toBe('awake');
  });

  it('returns celebrate when hasStreak is true regardless of score', () => {
    expect(scoreToAvatarState(80, true)).toBe('celebrate');
    expect(scoreToAvatarState(null, true)).toBe('celebrate');
    expect(scoreToAvatarState(30, true)).toBe('celebrate');
  });

  it('returns happy for score >= 80', () => {
    expect(scoreToAvatarState(80)).toBe('happy');
    expect(scoreToAvatarState(100)).toBe('happy');
    expect(scoreToAvatarState(95)).toBe('happy');
  });

  it('returns sleepy for score 50-79', () => {
    expect(scoreToAvatarState(50)).toBe('sleepy');
    expect(scoreToAvatarState(65)).toBe('sleepy');
    expect(scoreToAvatarState(79)).toBe('sleepy');
  });

  it('returns tired for score < 50', () => {
    expect(scoreToAvatarState(49)).toBe('tired');
    expect(scoreToAvatarState(0)).toBe('tired');
    expect(scoreToAvatarState(1)).toBe('tired');
  });
});

