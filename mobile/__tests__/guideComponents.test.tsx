import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';
import { GuideBubble } from '../src/guide/GuideBubble';
import { GuideHost } from '../src/guide/GuideHost';
import { GuideReaction } from '../src/guide/GuideReaction';
import { GuideSettingsSection } from '../src/guide/GuideSettingsSection';
import { GuideSpotlight } from '../src/guide/GuideSpotlight';
import { GuideTip } from '../src/guide/GuideTip';
import { GuideTour } from '../src/guide/GuideTour';
import { resetGuideForTests, useGuide, type Moment } from '../src/guide/guideEngine';
import { useGuideSuppress, useGuideTarget } from '../src/guide/hooks';
import { useSettings } from '../src/store/settings';

jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: () => void | (() => void)) => { require('react').useEffect(cb, [cb]); } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const moment = (featureId: string, step = 0, kind: Moment['kind'] = 'intro'): Moment => ({ featureId, kind, step, owner: featureId });
const g = () => useGuide.getState();

beforeEach(() => { resetGuideForTests(); useSettings.setState({ reducedMotion: false, uiLang: 'en', quietOn: false }); });

describe('GuideBubble', () => {
  it('shows step text, dots, Next, Skip and "Don\'t show tips"', async () => {
    const onNext = jest.fn(), onSkip = jest.fn(), onHide = jest.fn();
    await render(<GuideBubble moment={moment('home')} onNext={onNext} onSkip={onSkip} onHide={onHide} />);
    expect(screen.getByText('Start here: tell me how you feel in a few taps. It is always optional.')).toBeTruthy();
    expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' })); expect(onNext).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' })); expect(onSkip).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: "Don't show tips" })); expect(onHide).toHaveBeenCalled();
  });
  it('last step says Got it, hides Skip, and offers Try it only with a safe route', async () => {
    const onTry = jest.fn();
    await render(<GuideBubble moment={moment('garden', 1)} onNext={jest.fn()} onSkip={jest.fn()} onHide={jest.fn()} onTryIt={onTry} />);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Try it now' })); expect(onTry).toHaveBeenCalled();
  });
  it('has no Try it for features without a route, and for what-is-new', async () => {
    await render(<GuideBubble moment={moment('kaizen', 2)} onNext={jest.fn()} onSkip={jest.fn()} onHide={jest.fn()} onTryIt={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try it now' })).toBeNull();
  });
  it('is a live region and says it is an AI companion; works in Bengali', async () => {
    useSettings.setState({ uiLang: 'bn' });
    await render(<GuideBubble moment={moment('tour', 0)} onNext={jest.fn()} onSkip={jest.fn()} onHide={jest.fn()} />);
    expect(screen.getByText('হাই, আমি Nivora, আপনার AI সঙ্গী। আমি মানুষ নই, আর এটি থেরাপি নয়।').props.accessibilityLiveRegion).toBe('polite');
  });
  it('renders statically under reduced motion', async () => {
    useSettings.setState({ reducedMotion: true });
    await render(<GuideBubble moment={moment('home', 1)} onNext={jest.fn()} onSkip={jest.fn()} onHide={jest.fn()} />);
    expect(screen.getByText('Your Today feed holds a few gentle ideas. Each one says why it is there.')).toBeTruthy();
  });
});

describe('GuideSpotlight', () => {
  it('falls back to a centred bubble when the target is not measurable', async () => {
    await render(<GuideSpotlight targetId="nope.missing"><Text>bubble</Text></GuideSpotlight>);
    expect(await screen.findByText('bubble')).toBeTruthy();
    expect(screen.getByTestId('guide-centered')).toBeTruthy();
    expect(screen.queryByTestId('guide-spot')).toBeNull();
  });
  it('is centred without a target and under reduced motion', async () => {
    useSettings.setState({ reducedMotion: true });
    await render(<GuideSpotlight targetId="home.checkin"><Text>bubble</Text></GuideSpotlight>);
    expect(await screen.findByTestId('guide-centered')).toBeTruthy();
  });
  it('points at a measurable target without blocking touches', async () => {
    function Target() {
      const ref = useGuideTarget('t.ok');
      React.useEffect(() => { (ref.current as unknown as { measureInWindow: unknown }).measureInWindow = (cb: (...a: number[]) => void) => cb(20, 100, 200, 60); });
      return <View ref={ref} collapsable={false}><Text>target</Text></View>;
    }
    await render(<><Target /><GuideSpotlight targetId="t.ok"><Text>bubble</Text></GuideSpotlight></>);
    const spot = await screen.findByTestId('guide-spot');
    expect(spot.props.pointerEvents).toBe('box-none');
    expect(screen.getByText('bubble')).toBeTruthy();
  });
});

describe('GuideTip', () => {
  it('replays the feature guide on tap, even when tips are off', async () => {
    g().setLevel('Off');
    await render(<GuideTip featureId="sleep" />);
    await fireEvent.press(screen.getByRole('button', { name: 'What is this? Sleep' }));
    expect(g().current).toMatchObject({ featureId: 'sleep', kind: 'replay' });
  });
  it('does nothing while a safety suppression is active', async () => {
    g().setSuppressed('risk', true);
    await render(<GuideTip featureId="sleep" />);
    await fireEvent.press(screen.getByRole('button', { name: 'What is this? Sleep' }));
    expect(g().current).toBeNull();
  });
});

describe('GuideReaction / GuideTour / settings', () => {
  it('reaction auto-hides', async () => {
    jest.useFakeTimers();
    const done = jest.fn();
    await render(<GuideReaction textKey="gReactGarden" onDone={done} ms={1000} />);
    expect(screen.getByText('A flower for your garden.')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1100); });
    expect(done).toHaveBeenCalled();
    jest.useRealTimers();
  });
  it('tour walks four steps and can be skipped', async () => {
    g().replay('tour');
    await render(<GuideTour />);
    expect(await screen.findByText(/I'm Nivora, your AI companion/)).toBeTruthy();
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Step 4 of 4')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    expect(g().current).toBeNull();
  });
  it('settings: change level, toggle read-aloud, replay tour, reset tips', async () => {
    g().request('sleep'); g().skip();
    await render(<GuideSettingsSection />);
    await fireEvent.press(screen.getByRole('radio', { name: /^Hints only/ })); expect(g().guideLevel).toBe('Hints');
    await fireEvent.press(screen.getByRole('radio', { name: /^Off/ })); expect(g().guideLevel).toBe('Off');
    await fireEvent.press(screen.getByRole('switch', { name: /Read reasons aloud/ })); expect(g().readAloud).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Reset tips' }));
    expect(g().seen.sleep).toBeUndefined(); expect(g().guideLevel).toBe('Full');
    expect(screen.getByText('Tips reset. Intros will show again.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Replay the tour' }));
    expect(g().current?.featureId).toBe('tour');
  });
});

describe('GuideHost', () => {
  it('renders the current moment with an Emergency button that stays tappable', async () => {
    const onEmergency = jest.fn();
    g().request('sleep');
    await render(<GuideHost routeName="Tabs" onEmergency={onEmergency} onNavigate={jest.fn()} />);
    expect(await screen.findByText(/Log last night in Sleep/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Emergency help' }));
    expect(onEmergency).toHaveBeenCalled();
    expect(g().current).toBeNull();
  });
  it('Try it navigates to the existing route and closes the guide', async () => {
    const nav = jest.fn();
    useGuide.setState({ current: moment('garden', 1) });
    await render(<GuideHost routeName="Tabs" onNavigate={nav} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Try it now' }));
    expect(nav).toHaveBeenCalledWith('Garden', undefined);
    expect(g().current).toBeNull();
  });
  it.each(['Emergency', 'SafetyPlan', 'Call', 'SignIn', 'Welcome'])('never renders on %s', async (route) => {
    useGuide.setState({ current: moment('sleep') });
    await render(<GuideHost routeName={route} />);
    expect(screen.queryByText(/Log last night/)).toBeNull();
  });
  it('never renders when disabled (signed out / onboarding)', async () => {
    useGuide.setState({ current: moment('sleep') });
    await render(<GuideHost enabled={false} />);
    expect(screen.queryByText(/Log last night/)).toBeNull();
  });
  it('disappears while a screen reports a call, recording, exercise or crisis state', async () => {
    function Busy({ reason }: { reason: 'call' | 'recording' | 'exercise' | 'risk' }) { useGuideSuppress(reason); return null; }
    for (const reason of ['call', 'recording', 'exercise', 'risk'] as const) {
      resetGuideForTests();
      g().request('sleep');
      const view = await render(<><GuideHost routeName="Chat" /><Busy reason={reason} /></>);
      expect(screen.queryByText(/Log last night/)).toBeNull();
      expect(g().request('kaizen')).toBe(false);
      await view.unmount();
      expect(g().suppressed[reason]).toBe(0); // cleaned up on unmount
    }
  });
  it('shows a reaction chip without an Emergency overlay', async () => {
    g().react('breathe');
    await render(<GuideHost routeName="Tabs" onEmergency={jest.fn()} />);
    expect(await screen.findByText('Nice. A calm minute, just for you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emergency help' })).toBeNull();
  });
});
