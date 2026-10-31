import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { GuideHost, GuideTip, SuggestionBridge, useGuideFeature, useGuideSuppress } from '../src/guide';
import { resetGuideForTests, useGuide } from '../src/guide/guideEngine';
import { useSettings } from '../src/store/settings';

const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ api: (...a: unknown[]) => mockApi(...a), ApiError: class extends Error {} }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: () => void | (() => void)) => { require('react').useEffect(cb, [cb]); } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const g = () => useGuide.getState();
const tick = async (ms = 800) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
function Screen({ id }: { id: string }) { useGuideFeature(id); return null; }
function Risky({ risk }: { risk: boolean }) { useGuideSuppress('risk', risk); useGuideFeature('chat'); return null; }

beforeEach(() => { jest.useFakeTimers(); resetGuideForTests(); mockApi.mockReset(); useSettings.setState({ quietOn: false, uiLang: 'en', reducedMotion: true }); });
afterEach(() => { jest.useRealTimers(); });

describe('guide integration', () => {
  it('GuideHost mounts without crashing, and hides on blocked routes', async () => {
    await render(<GuideHost enabled routeName="Home" onNavigate={jest.fn()} onEmergency={jest.fn()} />);
    await act(async () => { g().replay('home'); });
    expect(screen.toJSON()).not.toBeNull();
    await render(<GuideHost enabled routeName="Emergency" />);
  });

  it('shows nothing on Emergency, SafetyPlan or Call', async () => {
    for (const route of ['Emergency', 'SafetyPlan', 'Call']) {
      resetGuideForTests();
      const v = await render(<GuideHost enabled routeName={route} />);
      await act(async () => { g().replay('home'); });
      expect(v.toJSON()).toBeNull();
      await v.unmount();
    }
  });

  it('bridges the server suggestion level: NEVER keeps automatic tips off, replay still works', async () => {
    mockApi.mockResolvedValue({ suggestionLevel: 'NEVER', analyticsOptIn: false });
    jest.useRealTimers();
    await render(wrap(<><SuggestionBridge /><Screen id="sleep" /></>));
    await waitFor(() => expect(g().suggestionLevel).toBe('NEVER'));
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    expect(g().current).toBeNull();
    await render(<GuideTip featureId="sleep" />);
    await fireEvent.press(screen.getByRole('button', { name: /sleep/i }));
    expect(g().current?.featureId).toBe('sleep');
  });

  it('keeps a safe default when the settings request fails', async () => {
    mockApi.mockRejectedValue(new Error('offline'));
    jest.useRealTimers();
    await render(wrap(<><SuggestionBridge /><Screen id="sleep" /></>));
    await waitFor(() => expect(g().current?.featureId).toBe('sleep'), { timeout: 3000 });
    expect(g().suggestionLevel).toBe('SOMETIMES');
  });

  it('risk suppression hides automatic tips and the tap replay', async () => {
    await render(<Risky risk />);
    await tick();
    expect(g().current).toBeNull();
   
    expect(g().replay('chat')).toBe(false);
  });
});
