import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { LivingVineWeek } from '../src/components/kaizen/LivingVineWeek';
import { SlideToBloom } from '../src/components/kaizen/SlideToBloom';
import { WisdomGardenShelf } from '../src/components/kaizen/WisdomGardenShelf';
import { SakuraBreeze } from '../src/components/kaizen/SakuraBreeze';
import { useSettings } from '../src/store/settings';
import AsyncStorage from '@react-native-async-storage/async-storage';

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

describe('Kaizen Modern Animations & Delight UI', () => {
  beforeEach(() => {
    useSettings.setState({ uiLang: 'en', reducedMotion: false });
    jest.clearAllMocks();
  });

  it('renders SakuraBreeze ambient canvas when reducedMotion is off', async () => {
    const { toJSON } = await render(wrap(<SakuraBreeze />));
    expect(toJSON()).not.toBeNull();
  });

  it('renders LivingVineWeek with blossom icons and counts correctly', async () => {
    const mockDays = [
      { date: '2026-11-01', status: 'DONE' },
      { date: '2026-11-02', status: 'SKIPPED' },
      { date: '2026-11-03', status: null },
    ];
    const onSelect = jest.fn();

    const { getByText, getByRole } = await render(
      wrap(<LivingVineWeek days={mockDays} onSelectDay={onSelect} />)
    );

    expect(getByText('🌿 LIVING GARDEN VINE')).toBeTruthy();
    expect(getByText('1/7 প্রস্ফুটিত')).toBeTruthy();

    const dayBtn = getByRole('button', { name: '2026-11-01: DONE' });
    fireEvent.press(dayBtn);
    expect(onSelect).toHaveBeenCalledWith(mockDays[0]);
  });

  it('triggers SlideToBloom onComplete callback when pressed', async () => {
    const onComplete = jest.fn();

    const { getByRole } = await render(
      wrap(<SlideToBloom onComplete={onComplete} />)
    );

    const btn = getByRole('button', { name: 'I did it' });
    await fireEvent.press(btn);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('renders WisdomGardenShelf with saved items', async () => {
    await AsyncStorage.setItem(
      '@nivora_wisdom_garden',
      JSON.stringify([{ title: 'Breath', text: 'Gentle river shapes the stone', date: '2026-11-01' }])
    );

    const { findByText } = await render(wrap(<WisdomGardenShelf />));
    expect(await findByText('Wisdom Garden')).toBeTruthy();
    expect(await findByText(/Gentle river/)).toBeTruthy();
  });
});
