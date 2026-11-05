import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
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

  describe('Socratic Soul Mirror Modal', () => {
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
});
