import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ApiError } from '../src/api/client';
import * as practice from '../src/api/practice';
import { BreathingPacer } from '../src/components/practice/BreathingPacer';
import { GroundingFlow } from '../src/components/practice/GroundingFlow';
import { ThoughtRecordFlow } from '../src/components/practice/ThoughtRecordFlow';
import { en, bn, hi, ne } from '../src/i18n/ext/practice';
import { useSettings } from '../src/store/settings';

jest.mock('../src/api/practice', () => ({
  ...jest.requireActual('../src/api/practice'),
  completeBreathing: jest.fn(), completeGrounding: jest.fn(), saveThoughtRecord: jest.fn(), suggestAlternative: jest.fn(),
}));
const m = practice as jest.Mocked<typeof practice>;

const Wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const ui = (n: React.ReactElement) => <Wrap>{n}</Wrap>;
const press = async (name: string | RegExp) => { await fireEvent.press(screen.getByRole('button', { name })); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const crisisPayload = { crisis: true as const, safety: { severity: 'HIGH', crisis: true as const, message: 'Please reach out now.', resources: [{ name: 'Helpline X', contactDetails: '999' }] } };

beforeEach(() => { jest.useFakeTimers(); useSettings.setState({ reducedMotion: false, uiLang: 'en' }); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

describe('practice strings', () => {
  it('has every key in every language', () => {
    for (const d of [bn, hi, ne]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
  });
});

async function fillToAlt() {
  await fireEvent.changeText(screen.getByLabelText('Just the situation, in a sentence or two.'), 'A hard meeting');
  await press('Next');
  await fireEvent.changeText(screen.getByLabelText('Write the thought as it came, no editing.'), 'I always fail');
  await press('Next');
  await press('Skip');
}

describe('ThoughtRecordFlow', () => {
  it('walks the steps, saves, and celebrates a counted flower', async () => {
    m.saveThoughtRecord.mockResolvedValue({ crisis: false, entryId: 'e1', kaizen: { counted: true, flowers: 4 } });
    await render(ui(<ThoughtRecordFlow />));
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState?.disabled).toBe(true);
    await fillToAlt();
    await fireEvent.changeText(screen.getByLabelText('A gentler way to see it'), 'I did my best');
    await press('Next');
    await fireEvent.press(screen.getByRole('radio', { name: 'Before this exercise 3' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Right now 6' }));
    await press('Save thought record');
    await flush();
    expect(m.saveThoughtRecord).toHaveBeenCalledWith(expect.objectContaining({ situation: 'A hard meeting', thought: 'I always fail', alternative: 'I did my best', moodBefore: 3, moodAfter: 6, save: true }));
    expect(screen.getByText('A flower was added to your garden.')).toBeTruthy();
    expect(screen.getByText('4 flowers in your garden')).toBeTruthy();
  });

  it('shows a gentle already-counted note when not counted', async () => {
    m.saveThoughtRecord.mockResolvedValue({ crisis: false, entryId: 'e1', kaizen: { counted: false, flowers: 4 } });
    await render(ui(<ThoughtRecordFlow />));
    await fillToAlt(); await press('Skip'); await press('Save thought record'); await flush();
    expect(screen.getByText(/Already counted today/)).toBeTruthy();
    expect(screen.queryByText('A flower was added to your garden.')).toBeNull();
  });

  it('shows an AI suggestion with a badge that can be accepted and edited', async () => {
    m.suggestAlternative.mockResolvedValue({ crisis: false, alternative: 'I can handle one step at a time.', ai: true });
    await render(ui(<ThoughtRecordFlow />));
    await fillToAlt();
    expect(screen.getByLabelText('A gentler way to see it')).toBeTruthy();
    await press('Help me phrase one'); await flush();
    expect(m.suggestAlternative).toHaveBeenCalledWith({ thought: 'I always fail', situation: 'A hard meeting' });
    expect(screen.getByText('AI-generated')).toBeTruthy();
    await press('Use this');
    expect(screen.getByLabelText('A gentler way to see it').props.value).toBe('I can handle one step at a time.');
  });

  it('shows a non-AI reflective question without a badge or accept button', async () => {
    m.suggestAlternative.mockResolvedValue({ crisis: false, alternative: 'What would you say to a friend?', ai: false });
    await render(ui(<ThoughtRecordFlow />));
    await fillToAlt();
    await press('Help me phrase one'); await flush();
    expect(screen.getByText('What would you say to a friend?')).toBeTruthy();
    expect(screen.queryByText('AI-generated')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('asks for consent on 403 and the flow still works without AI', async () => {
    m.suggestAlternative.mockRejectedValue(new ApiError(403, 'CONSENT_REQUIRED', 'x', { consentType: 'JOURNAL_AI_SHARING' }));
    m.saveThoughtRecord.mockResolvedValue({ crisis: false, entryId: 'e', kaizen: { counted: true, flowers: 1 } });
    await render(ui(<ThoughtRecordFlow />));
    await fillToAlt();
    await press('Help me phrase one'); await flush();
    expect(screen.getByText(/sharing journal entries with the AI/)).toBeTruthy();
    await press('Not now');
    expect(screen.queryByText('One small thing first')).toBeNull();
    await press('Skip'); await press('Save thought record'); await flush();
    expect(m.saveThoughtRecord).toHaveBeenCalled();
  });

  it('stops gently on a crisis payload from the helper and stores nothing', async () => {
    m.suggestAlternative.mockResolvedValue(crisisPayload);
    const onEmergency = jest.fn();
    await render(ui(<ThoughtRecordFlow onEmergency={onEmergency} />));
    await fillToAlt();
    await press('Help me phrase one'); await flush();
    expect(screen.getByText('You matter, and support is here')).toBeTruthy();
    expect(screen.getByText('Helpline X')).toBeTruthy();
    expect(screen.getByText(/Nothing was saved/)).toBeTruthy();
    await press('Open emergency help');
    expect(onEmergency).toHaveBeenCalled();
    expect(m.saveThoughtRecord).not.toHaveBeenCalled();
  });

  it('stops on a crisis payload from saving', async () => {
    m.saveThoughtRecord.mockResolvedValue(crisisPayload);
    await render(ui(<ThoughtRecordFlow />));
    await fillToAlt(); await press('Skip'); await press('Save thought record'); await flush();
    expect(screen.getByText('You matter, and support is here')).toBeTruthy();
    expect(screen.queryByText('A flower was added to your garden.')).toBeNull();
  });

  it('keeps the words and offers a retry when saving fails', async () => {
    m.saveThoughtRecord.mockRejectedValue(new ApiError(500, 'X', 'x'));
    await render(ui(<ThoughtRecordFlow />));
    await fillToAlt(); await press('Skip'); await press('Save thought record'); await flush();
    expect(screen.getByText(/We could not save that just now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save thought record' })).toBeTruthy();
  });
});

describe('GroundingFlow', () => {
  it('counts taps per sense, gives gentle haptics, and records on completion', async () => {
    m.completeGrounding.mockResolvedValue({ kaizen: { counted: true, flowers: 2 } });
    await render(ui(<GroundingFlow />));
    await press('Begin');
    expect(screen.getByText('5 things you can see')).toBeTruthy();
    for (let k = 0; k < 5; k++) await press('I noticed one');
    expect(screen.getByText('5 of 5 noticed')).toBeTruthy();
    expect((Haptics.impactAsync as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
    await press('Continue');
    expect(screen.getByText('4 things you can feel')).toBeTruthy();
    for (const label of ['4 things you can feel', '3 things you can hear', '2 things you can smell']) {
      expect(screen.getByText(label)).toBeTruthy();
      await press('Continue');
    }
    expect(screen.getByText('1 thing you can taste')).toBeTruthy();
    await press('Finish'); await flush();
    expect(m.completeGrounding).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    expect(screen.getByText('A flower was added to your garden.')).toBeTruthy();
  });

  it('says already counted when the day was already done', async () => {
    m.completeGrounding.mockResolvedValue({ kaizen: { counted: false, flowers: 2 } });
    useSettings.setState({ reducedMotion: true });
    await render(ui(<GroundingFlow />));
    await press('Begin');
    for (let k = 0; k < 4; k++) await press('Continue');
    await press('Finish'); await flush();
    expect(screen.getByText(/Already counted today/)).toBeTruthy();
    expect(screen.queryByText('A flower was added to your garden.')).toBeNull();
  });
});

describe('BreathingPacer', () => {
  it('offers 1/2/5 minutes, taps haptics on phases, and records after the full time', async () => {
    m.completeBreathing.mockResolvedValue({ kaizen: { counted: true, flowers: 9 } });
    await render(ui(<BreathingPacer />));
    expect(screen.getByRole('button', { name: '1 min' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '5 min' })).toBeTruthy();
    await press('1 min');
    await press('Start breathing');
    expect(screen.getByText('Breathe in')).toBeTruthy();
    const taps = () => (Haptics.impactAsync as jest.Mock).mock.calls.length;
    const atInhale = taps();
    expect(atInhale).toBeGreaterThan(0);
    await act(async () => { jest.advanceTimersByTime(4000); });
    expect(screen.getByText('Hold')).toBeTruthy();
    expect(taps()).toBe(atInhale); // no haptic on hold
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getByText('Breathe out')).toBeTruthy();
    expect(taps()).toBe(atInhale + 1); // soft tap on the out-breath
    await act(async () => { jest.advanceTimersByTime(60000); });
    await flush();
    expect(m.completeBreathing).toHaveBeenCalledWith(1);
    expect(screen.getByText('A flower was added to your garden.')).toBeTruthy();
  });

  it('does not record when stopped early, and stays kind', async () => {
    await render(ui(<BreathingPacer />));
    await press('Start breathing');
    await act(async () => { jest.advanceTimersByTime(5000); });
    await press('Stop');
    expect(screen.getByText('That is okay. You can come back any time.')).toBeTruthy();
    expect(m.completeBreathing).not.toHaveBeenCalled();
  });

  it('shows a static orb with words under reduced motion, and a gentle note when already counted', async () => {
    useSettings.setState({ reducedMotion: true });
    m.completeBreathing.mockResolvedValue({ kaizen: { counted: false, flowers: 9 } });
    await render(ui(<BreathingPacer />));
    await press('1 min'); await press('Start breathing');
    expect(screen.getByText('Motion is reduced. Follow the words.')).toBeTruthy();
    expect(screen.getByText('Breathe in')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(61000); });
    await flush();
    expect(screen.getByText(/Already counted today/)).toBeTruthy();
    expect(screen.queryByText('A flower was added to your garden.')).toBeNull();
  });

  it('is gentle when recording fails', async () => {
    m.completeBreathing.mockRejectedValue(new ApiError(0, 'NETWORK', 'x'));
    await render(ui(<BreathingPacer />));
    await press('1 min'); await press('Start breathing');
    await act(async () => { jest.advanceTimersByTime(61000); });
    await flush();
    expect(screen.getByText(/still counts for you/)).toBeTruthy();
  });
});
