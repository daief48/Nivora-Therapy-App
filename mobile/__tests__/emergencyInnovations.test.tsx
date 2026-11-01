import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HeartbeatHeroCard } from '../src/components/emergency/HeartbeatHeroCard';
import { CalmAnchorBreather } from '../src/components/emergency/CalmAnchorBreather';
import { GroundingExercise54321 } from '../src/components/emergency/GroundingExercise54321';
import { SafetyChainCaller } from '../src/components/emergency/SafetyChainCaller';
import { MicroSafetyContract } from '../src/components/emergency/MicroSafetyContract';
import { useSettings } from '../src/store/settings';

describe('Emergency Help Phase 1 & 2 Innovations', () => {
  beforeEach(async () => {
    useSettings.setState({ uiLang: 'en', reducedMotion: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });
  it('renders HeartbeatHeroCard correctly with online and offline state', async () => {
    const { getByText, rerender } = await render(<HeartbeatHeroCard online={true} />);
    expect(getByText('You Are Not Alone')).toBeTruthy();
    expect(getByText('Help is right here. Take this moment one second at a time.')).toBeTruthy();

    await rerender(<HeartbeatHeroCard online={false} />);
    expect(getByText(/You appear to be offline/i)).toBeTruthy();
  });

  it('renders CalmAnchorBreather when visible', async () => {
    const handleClose = jest.fn();
    const { getByText } = await render(
      <CalmAnchorBreather visible={true} onClose={handleClose} />
    );

    expect(getByText('Calm Anchor')).toBeTruthy();
    expect(getByText('Breath 1 of 4')).toBeTruthy();
  });

  it('steps through GroundingExercise54321 with tap to count', async () => {
    const handleClose = jest.fn();
    const { getByText } = await render(
      <GroundingExercise54321 visible={true} onClose={handleClose} />
    );

    expect(getByText('5-4-3-2-1 Grounding')).toBeTruthy();
    expect(getByText('Notice 5 things you can SEE around you')).toBeTruthy();

    // Tap the count button
    const tapBtn = getByText(/Tap to check off/i);
    await act(async () => {
      fireEvent.press(tapBtn);
    });

    expect(getByText('1 of 5 noticed')).toBeTruthy();
  });

  it('cycles through contacts in SafetyChainCaller', async () => {
    const handleClose = jest.fn();
    const mockContacts = [
      { id: '1', name: 'Ayesha', phone: '+8801700000001', relation: 'Sister' },
      { id: '2', name: 'Rahim', phone: '+8801700000002', relation: 'Friend' },
    ];

    const { getByText } = await render(
      <SafetyChainCaller visible={true} contacts={mockContacts} onClose={handleClose} />
    );

    expect(getByText('Safety Chain')).toBeTruthy();
    expect(getByText('Ayesha')).toBeTruthy();
    expect(getByText('+8801700000001')).toBeTruthy();

    // Click next
    const nextBtn = getByText(/Next person/i);
    await act(async () => {
      fireEvent.press(nextBtn);
    });

    expect(getByText('Rahim')).toBeTruthy();
    expect(getByText('+8801700000002')).toBeTruthy();

    // Finish chain
    await act(async () => {
      fireEvent.press(nextBtn);
    });

    expect(getByText('You took brave steps to reach out. We are still with you.')).toBeTruthy();
  });

  it('allows selecting preset and saving in MicroSafetyContract', async () => {
    const { getByText } = await render(<MicroSafetyContract />);

    expect(getByText('A Promise to Yourself')).toBeTruthy();

    // Tap preset pill
    const presetBtn = getByText('One breath at a time 🌸');
    await act(async () => {
      fireEvent.press(presetBtn);
    });

    // Save promise
    const saveBtn = getByText(/Seal this promise/i);
    await act(async () => {
      fireEvent.press(saveBtn);
    });

    expect(getByText(/“One breath at a time 🌸”/)).toBeTruthy();
  });
});
