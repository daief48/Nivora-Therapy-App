import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }), useRoute: () => ({ params: undefined }) }));
const ok = (data: unknown) => ({ isLoading: false, isError: false, error: null, data, refetch: jest.fn() });
jest.mock('../src/api/hooks', () => ({
  useMe: () => ok({ displayName: 'Ayesha', email: 'a@example.com', locale: 'en' }),
  useConsents: () => ok([]), useDevices: () => ok([]),
  useInvalidatingMutation: () => ({ mutateAsync: jest.fn(async () => ({})), mutate: jest.fn(), isPending: false }),
}));
jest.mock('../src/utils/reminders', () => ({ setDailyReminder: jest.fn(async () => true) }));

import { PrivacyScreen } from '../src/screens/PrivacyScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { useSettings } from '../src/store/settings';

beforeEach(() => { useSettings.setState({ reducedMotion: true, uiLang: 'en', naturalVoice: true }); mockNavigate.mockClear(); });

describe('Profile', () => {
  it('groups settings clearly and keeps every group reachable', async () => {
    await render(<SettingsScreen />);
    for (const heading of ['Language & appearance', 'Natural voice', 'Text & accessibility', 'Reminders', 'Privacy & safety']) {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Ayesha')).toBeTruthy();
  });

  it('privacy, devices and data rows open the privacy screen; emergency and about work', async () => {
    await render(<SettingsScreen />);
    for (const name of ['Privacy & consent', 'Devices & sessions', 'Export or delete my data']) {
      await fireEvent.press(screen.getByRole('button', { name }));
      expect(mockNavigate).toHaveBeenLastCalledWith('Privacy');
    }
    await fireEvent.press(screen.getAllByRole('button', { name: 'Emergency help' })[0]!);
    expect(mockNavigate).toHaveBeenLastCalledWith('Emergency');
    await fireEvent.press(screen.getByRole('button', { name: 'About Nivora' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('About');
  });

  it('natural voice can be turned off and explains what it sends', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByText(/reply text is sent to OpenAI/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Natural voice' }));
    expect(useSettings.getState().naturalVoice).toBe(false);
  });

  it('text size and reduced motion are real settings', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '130%' }));
    expect(useSettings.getState().fontScale).toBe(1.3);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Reduce motion' }));
    expect(useSettings.getState().reducedMotion).toBe(false);
  });
});

describe('Privacy screen', () => {
  it('tells the user plainly that reply text goes to the voice provider (and mic audio does not)', async () => {
    await render(<PrivacyScreen />);
    expect(screen.getByText(/sent to our voice provider \(OpenAI\)/)).toBeTruthy();
    expect(screen.getByText(/microphone audio is not sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export my data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeTruthy();
  });
});
