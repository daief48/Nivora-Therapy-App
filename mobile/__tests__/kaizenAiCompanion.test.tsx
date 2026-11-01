import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { SoulBatterySlider } from '../src/components/kaizen/SoulBatterySlider';
import { ZenPearlRewardModal } from '../src/components/kaizen/ZenPearlRewardModal';
import { PlantChronicleCard } from '../src/components/kaizen/PlantChronicleCard';
import { SoulWeatherModal } from '../src/components/kaizen/SoulWeatherModal';
import { OmikujiBloomModal } from '../src/components/kaizen/OmikujiBloomModal';
import { SocraticSoulMirrorModal } from '../src/components/kaizen/SocraticSoulMirrorModal';
import { useSettings } from '../src/store/settings';
import * as client from '../src/api/client';

jest.mock('../src/api/client', () => ({
  api: jest.fn(),
}));

jest.mock('../src/components/Avatar', () => ({
  Avatar: () => null,
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (p: any) => React.createElement(View, p),
    Svg: (p: any) => React.createElement(View, p),
    Circle: (p: any) => React.createElement(View, p),
    Defs: (p: any) => React.createElement(View, p),
    RadialGradient: (p: any) => React.createElement(View, p),
    Stop: (p: any) => React.createElement(View, p),
    Path: (p: any) => React.createElement(View, p),
    G: (p: any) => React.createElement(View, p),
  };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

describe('Kaizen AI Companion Features (Frontend)', () => {
  beforeEach(() => {
    useSettings.setState({ uiLang: 'en', reducedMotion: true });
    jest.clearAllMocks();
  });

  describe('Feature 1: Soul Battery Slider', () => {
    it('renders 3 energy options and triggers onAlchemize when Low', async () => {
      const onAlchemize = jest.fn();

      function BatteryWrapper() {
        const [lvl, setLvl] = React.useState<'LOW' | 'MED' | 'HIGH'>('MED');
        return (
          <SoulBatterySlider
            level={lvl}
            onChangeLevel={setLvl}
            onAlchemize={onAlchemize}
          />
        );
      }

      const { getByText, getAllByText, getByRole } = await render(
        wrap(<BatteryWrapper />)
      );

      expect(getByText('Soul Battery')).toBeTruthy();
      expect(getAllByText('50%').length).toBeGreaterThan(0);

      // Press Low option
      await act(async () => {
        fireEvent.press(getByRole('button', { name: "Exhausted / Can't get out of bed" }));
      });

      // When level becomes LOW, the Alchemize button emerges
      const alchemizeBtn = getByRole('button', { name: '🪄 Transform into micro-ritual' });
      expect(alchemizeBtn).toBeTruthy();
      await act(async () => {
        fireEvent.press(alchemizeBtn);
      });
      expect(onAlchemize).toHaveBeenCalledTimes(1);
    });
  });

  describe('Feature 1: Zen Pearl Reward Modal', () => {
    it('renders Zen Pearl celebration and handles close', async () => {
      const onClose = jest.fn();
      const { getByText, getByRole } = await render(
        wrap(<ZenPearlRewardModal visible={true} onClose={onClose} />)
      );

      expect(getByText('Zen Pearl collected in your garden!')).toBeTruthy();
      fireEvent.press(getByRole('button', { name: 'গ্রহণ করলাম' }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Feature 2: Soul Weather Modal', () => {
    it('toggles mood emojis and requests sensory ritual', async () => {
      const onClose = jest.fn();
      const onAdopt = jest.fn();

      (client.api as jest.Mock).mockResolvedValue({
        validation: 'A heavy morning fog parts slowly.',
        ritualTitle: 'Warm Cup Touch',
        ritualStep: 'Hold a warm cup and breathe gently.',
      });

      const { getByText, getByRole } = await render(
        wrap(
          <SoulWeatherModal
            visible={true}
            onClose={onClose}
            onAdoptRitual={onAdopt}
          />
        )
      );

      expect(getByText('Soul Weather')).toBeTruthy();

      // Select emoji
      await act(async () => {
        fireEvent.press(getByRole('button', { name: 'Rainy' }));
      });

      // Brew button should be pressable
      const brewBtn = getByRole('button', { name: 'Brew Sensory Ritual' });
      await act(async () => {
        fireEvent.press(brewBtn);
      });

      await waitFor(() => {
        expect(getByText('Warm Cup Touch')).toBeTruthy();
      });

      expect(getByText('A heavy morning fog parts slowly.')).toBeTruthy();
      expect(getByText('Hold a warm cup and breathe gently.')).toBeTruthy();

      // Adopt button
      await act(async () => {
        fireEvent.press(getByRole('button', { name: "Adopt as Today's Step" }));
      });
      expect(onAdopt).toHaveBeenCalledWith('Warm Cup Touch', 'Hold a warm cup and breathe gently.');
    });
  });

  describe('Feature 3: Plant Chronicle Card', () => {
    it('opens plant keepsake card with letter and haiku on tap', async () => {
      (client.api as jest.Mock).mockResolvedValue({
        letter: 'Dear friend, I watched you try even when tired.',
        haiku: 'Quiet little steps,\nGreen leaves greet the morning sun,\nPeace blooms in your heart.',
      });

      const { getByText, findByText } = await render(
        wrap(<PlantChronicleCard stage="GROWING" />)
      );

      const triggerBtn = getByText('Letter from your plant');
      expect(triggerBtn).toBeTruthy();

      await act(async () => {
        fireEvent.press(triggerBtn);
      });

      expect(await findByText('Sakura Keepsake Card')).toBeTruthy();
      expect(getByText('Dear friend, I watched you try even when tired.')).toBeTruthy();
      expect(getByText(/Quiet little steps/)).toBeTruthy();
    });
  });

  describe('Feature 4: Socratic Soul Mirror Modal', () => {
    it('sends user doubt and displays Nivora CBT response', async () => {
      const onClose = jest.fn();
      (client.api as jest.Mock).mockResolvedValue({
        reply: 'That thought is very common. Is it an absolute certainty, or could there be a gentler explanation?',
      });

      const { getByText, getByRole, getByPlaceholderText, findByText } = await render(
        wrap(
          <SocraticSoulMirrorModal
            visible={true}
            onClose={onClose}
            programId="stress-7"
            day={1}
            lessonTitle="Notice the breath"
            lessonContext="Breathing calms the autonomic nervous system."
          />
        )
      );

      expect(getByText('Socratic Soul Mirror')).toBeTruthy();

      await act(async () => {
        fireEvent.changeText(
          getByPlaceholderText('Type a thought, worry, or hesitation from this lesson...'),
          'I cannot focus my breath at all'
        );
      });

      await act(async () => {
        fireEvent.press(getByRole('button', { name: 'Examine' }));
      });

      expect(
        await findByText(
          'That thought is very common. Is it an absolute certainty, or could there be a gentler explanation?'
        )
      ).toBeTruthy();
    });
  });

  describe('Feature 5: Omikuji Bloom Modal', () => {
    it('reveals traditional Omikuji fortune upon completion and saves to Wisdom Garden', async () => {
      const onClose = jest.fn();
      (client.api as jest.Mock).mockResolvedValue({
        omikuji: 'A river shapes the stone not by force, but by quiet persistence.',
        blessingType: 'SERENITY',
      });

      const { getByText, getByRole, findByText } = await render(
        wrap(
          <OmikujiBloomModal
            visible={true}
            actionTitle="2 quiet breaths"
            streakCount={3}
            onClose={onClose}
          />
        )
      );

      expect(getByText(/KAIZEN BLESSING/)).toBeTruthy();

      expect(
        await findByText('A river shapes the stone not by force, but by quiet persistence.')
      ).toBeTruthy();

      const saveBtn = getByRole('button', { name: 'Keep in Wisdom Garden' });
      await act(async () => {
        fireEvent.press(saveBtn);
      });

      expect(await findByText('সংরক্ষিত হয়েছে ✨')).toBeTruthy();
    });
  });
});
