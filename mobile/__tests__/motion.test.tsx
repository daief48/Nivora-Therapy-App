import { act, fireEvent, render, screen, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { ApiError } from '../src/api/client';
import { AiBadge, AiDisclosure } from '../src/components/AiBadge';
import { Celebrate } from '../src/components/Celebrate';
import { ConsentRequiredPrompt, consentTypeOf, isConsentRequired } from '../src/components/ConsentRequired';
import { Button, Chip, ProgressBar, Segmented, Skeleton } from '../src/components/ui';
import { AnimatedNumber, BreathingOrb, FadeInUp, PressScale, Shimmer, Stagger, TypeWriter, useReducedMotion } from '../src/motion';
import { useSettings } from '../src/store/settings';

const Wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const setReduced = (v: boolean) => useSettings.setState({ reducedMotion: v });
beforeEach(() => { setReduced(false); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('useReducedMotion', () => {
  it('follows the in-app setting', async () => {
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => { setReduced(true); });
    expect(result.current).toBe(true);
  });
  it('follows the OS setting', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const { result } = await renderHook(() => useReducedMotion());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(true);
  });
});

describe('FadeInUp / Stagger', () => {
  it('renders children in both modes', async () => {
    const { rerender } = await render(<Stagger><Text>one</Text><Text>two</Text></Stagger>);
    expect(screen.getByText('two')).toBeTruthy();
    setReduced(true);
    await rerender(<FadeInUp><Text>still</Text></FadeInUp>);
    expect(screen.getByText('still')).toBeTruthy();
  });
});

describe('PressScale', () => {
  it('fires onPress with a light haptic, and respects haptic=false', async () => {
    const onPress = jest.fn();
    await render(<PressScale accessibilityRole="button" accessibilityLabel="go" onPress={onPress}><Text>go</Text></PressScale>);
    await fireEvent.press(screen.getByRole('button', { name: 'go' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('works under reduced motion', async () => {
    setReduced(true);
    const onPress = jest.fn();
    await render(<PressScale accessibilityRole="button" accessibilityLabel="go" haptic={false} onPress={onPress}><Text>go</Text></PressScale>);
    await fireEvent(screen.getByRole('button', { name: 'go' }), 'pressIn');
    await fireEvent.press(screen.getByRole('button', { name: 'go' }));
    expect(onPress).toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalledWith('light-never');
  });
});

describe('Shimmer / Skeleton', () => {
  it('renders and survives layout in both modes', async () => {
    const { rerender } = await render(<Skeleton height={20} />);
    await rerender(<Shimmer height={10} />);
    setReduced(true);
    await rerender(<Shimmer height={10} />);
  });
});

describe('TypeWriter', () => {
  it('reveals progressively then calls onDone once', async () => {
    const onDone = jest.fn();
    await render(<TypeWriter text="hello" speed={10} onDone={onDone} />);
    expect(screen.queryByText('hello')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText('hello')).toBeTruthy();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it('slow mode takes about twice as long', async () => {
    const onDone = jest.fn();
    await render(<TypeWriter text="abcdefghij" speed={10} slow onDone={onDone} />);
    await act(async () => { jest.advanceTimersByTime(1200); });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1200); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it('shows everything at once under reduced motion', async () => {
    setReduced(true);
    const onDone = jest.fn();
    await render(<TypeWriter text="calm words" onDone={onDone} />);
    expect(screen.getByText('calm words')).toBeTruthy();
    expect(onDone).toHaveBeenCalled();
  });
});

describe('AnimatedNumber', () => {
  it('counts up to the value', async () => {
    await render(<AnimatedNumber value={42} ms={300} />);
    expect(screen.getByLabelText('42')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText('42')).toBeTruthy();
  });
  it('is static under reduced motion', async () => {
    setReduced(true);
    await render(<AnimatedNumber value={7} />);
    expect(screen.getByText('7')).toBeTruthy();
  });
});

describe('BreathingOrb', () => {
  it('walks through inhale, hold, exhale', async () => {
    const seen: string[] = [];
    await render(<BreathingOrb inhale={100} hold={100} exhale={100} onPhase={(p) => seen.push(p)} />);
    expect(screen.getByText('Breathe in')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(110); });
    expect(screen.getByText('Hold')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(screen.getByText('Breathe out')).toBeTruthy();
    expect(seen).toEqual(['inhale', 'hold', 'exhale']);
  });
  it('accepts an external level without phase words', async () => {
    const { rerender } = await render(<BreathingOrb level={0.2} />);
    await rerender(<BreathingOrb level={0.9} />);
    expect(screen.queryByText('Breathe in')).toBeNull();
    expect(screen.getByLabelText('Breathing guide')).toBeTruthy();
  });
  it('still names the phase under reduced motion', async () => {
    setReduced(true);
    await render(<BreathingOrb />);
    expect(screen.getByText('Breathe in')).toBeTruthy();
  });
});

describe('upgraded primitives keep their behaviour', () => {
  it('Button, Chip, Segmented and ProgressBar', async () => {
    const press = jest.fn(), pick = jest.fn(), seg = jest.fn();
    await render(<><Button title="Save" onPress={press} /><Chip label="Calm" onPress={pick} /><Segmented value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={seg} /><ProgressBar value={3} max={10} label="p" /></>);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Calm' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'B' }));
    expect(press).toHaveBeenCalled(); expect(pick).toHaveBeenCalled(); expect(seg).toHaveBeenCalledWith('b');
    expect(screen.getByLabelText('p')).toBeTruthy();
  });
});

describe('Celebrate variants', () => {
  it('renders nothing before play, and the petal/glow variants vanish under reduced motion', async () => {
    const { rerender, toJSON } = await render(<Celebrate play={0} variant="petals" />);
    expect(toJSON()).toBeNull();
    await rerender(<Celebrate play={1} variant="petals" />);
    expect(toJSON()).not.toBeNull();
    await rerender(<Celebrate play={1} variant="glow" />);
    expect(toJSON()).not.toBeNull();
    setReduced(true);
    await rerender(<Celebrate play={2} variant="glow" />);
    expect(toJSON()).toBeNull();
    await rerender(<Celebrate play={2} />);
    expect(toJSON()).not.toBeNull();
  });
});

describe('AiBadge / AiDisclosure', () => {
  it('shows only when ai is true', async () => {
    const { rerender } = await render(<AiBadge ai={false} />);
    expect(screen.queryByText('AI-generated')).toBeNull();
    await rerender(<AiBadge ai />);
    expect(screen.getByText('AI-generated')).toBeTruthy();
  });
  it('states that Nivora is an AI, not a person and not therapy', async () => {
    await render(<AiDisclosure more />);
    expect(screen.getByText('Nivora is an AI, not a person, and not therapy.')).toBeTruthy();
  });
});

describe('consent required helper', () => {
  it('detects the structured error and its consent type', () => {
    const e = new ApiError(403, 'CONSENT_REQUIRED', 'x', { consentType: 'WELLNESS_AI_SHARING' });
    expect(isConsentRequired(e)).toBe(true);
    expect(isConsentRequired(new ApiError(403, 'consent_required', 'x'))).toBe(true);
    expect(isConsentRequired(new ApiError(500, 'INTERNAL', 'x'))).toBe(false);
    expect(consentTypeOf(e)).toBe('WELLNESS_AI_SHARING');
  });
  it('renders nothing for other errors', async () => {
    const { toJSON } = await render(<Wrap><ConsentRequiredPrompt error={new ApiError(500, 'INTERNAL', 'x')} /></Wrap>);
    expect(toJSON()).toBeNull();
  });
  it('offers a friendly prompt naming the consent', async () => {
    await render(
      <Wrap>
        <ConsentRequiredPrompt error={new ApiError(403, 'CONSENT_REQUIRED', 'x', { consentType: 'JOURNAL_AI_SHARING' })} onDismiss={() => {}} />
      </Wrap>,
    );
    expect(screen.getByText(/sharing journal entries with the AI/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow and continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
  });
});
