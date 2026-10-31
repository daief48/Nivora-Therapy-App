import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// The ~20 s /state poll (it also tells the server the sitting screen is open) must keep running during an active call.
const mockApi = jest.fn(async (path: string) => (path.endsWith('/state')
  ? { phase: 'CORE', elapsedMin: 7, remainingMin: 23, phaseHint: 'hintCore', isIntake: false, moodBefore: null, remainingSec: 1380, endsAt: null }
  : {}));
jest.mock('../src/api/client', () => ({ api: (...a: [string]) => mockApi(...a), ApiError: class extends Error {} }));
jest.mock('@react-navigation/native', () => ({
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() }),
  useRoute: () => ({ params: { mode: 'voice', sittingId: 's1', programId: 'p1' } }),
}));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/api/hooks', () => ({ useMe: () => ({ data: { locale: 'en', displayName: 'A' } }), errorMessageKey: () => 'errorTitle' }));
jest.mock('../src/hooks/useConversation', () => ({
  useConversation: () => ({ messages: [], busy: false, errorKey: null, errorCode: null, crisisResources: null, sessionId: 's1', send: jest.fn(), cancel: jest.fn(), finish: jest.fn(async () => {}) }),
}));
jest.mock('../src/utils/speech', () => ({ recognition: () => null, speak: jest.fn(), stopSpeaking: jest.fn(), speechLocale: () => 'en-US' }));

import { CallScreen } from '../src/screens/CallScreen';
import { useSettings } from '../src/store/settings';

it('keeps the /sessions/:id/state poll (every 20 s) mounted while a call is active', async () => {
  useSettings.setState({ reducedMotion: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(<QueryClientProvider client={client}><CallScreen /></QueryClientProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Start voice call' }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/sessions/s1/state'));
  const q = client.getQueryCache().find({ queryKey: ['therapy', 'state', 's1'] })!;
  expect(q.getObserversCount()).toBeGreaterThan(0); // an active observer is what keeps the interval running
  expect(q.observers.every((o) => o.options.refetchInterval === 20_000)).toBe(true);
  client.clear();
});
