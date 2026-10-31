import { act, render } from '@testing-library/react-native';
import React from 'react';
import { resetGuideForTests, useGuide } from '../src/guide/guideEngine';
import { useGuideConsent, useGuideFallback, useGuideFeature, useGuideReadAloud } from '../src/guide/hooks';
import { useSettings } from '../src/store/settings';
import * as speech from '../src/utils/speech';

jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: () => void | (() => void)) => { require('react').useEffect(cb, [cb]); } }));
jest.mock('../src/utils/speech', () => ({ speak: jest.fn(async () => {}), stopSpeaking: jest.fn() }));

const g = () => useGuide.getState();
const tick = async (ms = 800) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

function Screen({ id, enabled = true }: { id: string; enabled?: boolean }) { useGuideFeature(id, { enabled }); return null; }
function Fallback({ ai }: { ai?: boolean }) { useGuideFallback('sleepCoach', ai); return null; }
function Consent({ type, visible }: { type: string; visible: boolean }) { useGuideConsent(type, visible); return null; }
let read: (t: string) => boolean = () => false;
function Reader() { read = useGuideReadAloud(); return null; }

beforeEach(() => { jest.useFakeTimers(); resetGuideForTests(); useSettings.setState({ quietOn: false, ttsMuted: false, uiLang: 'en' }); (speech.speak as jest.Mock).mockClear(); });
afterEach(() => { jest.useRealTimers(); });

describe('guide hooks', () => {
  it('a screen opens its intro once after focus, and closes it when leaving', async () => {
    const v = await render(<Screen id="sleep" />);
    expect(g().current).toBeNull();
    await tick();
    expect(g().current?.featureId).toBe('sleep');
    await v.unmount();
    expect(g().current).toBeNull();
  });
  it('home offers the first-run tour before its own intro', async () => {
    await render(<Screen id="home" />);
    await tick();
    expect(g().current?.featureId).toBe('tour');
  });
  it('waits while enabled is false', async () => {
    await render(<Screen id="sleep" enabled={false} />);
    await tick();
    expect(g().current).toBeNull();
  });
  it('explains an ai:false fallback once, but not ai:true', async () => {
    await render(<Fallback ai />);
    expect(g().current).toBeNull();
    await render(<Fallback ai={false} />);
    expect(g().current?.featureId).toBe('fallback');
  });
  it('explains a consent prompt only while it is visible and only for known consents', async () => {
    await render(<Consent type="OTHER" visible />);
    await tick(); expect(g().current).toBeNull();
    await render(<Consent type="WELLNESS_AI_SHARING" visible />);
    await tick(); expect(g().current?.featureId).toBe('consentWellness');
  });
  it('reads a reason aloud only when opted in, voice is on and the guide may appear', async () => {
    await render(<Reader />);
    expect(read('Last night was short')).toBe(false);
    g().setReadAloud(true);
    expect(read('Last night was short')).toBe(true);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    useSettings.setState({ ttsMuted: true }); expect(read('x')).toBe(false);
    useSettings.setState({ ttsMuted: false }); g().setSuppressed('risk', true); expect(read('x')).toBe(false);
    g().setSuppressed('risk', false); g().setLevel('Off'); expect(read('x')).toBe(false);
  });
});
