import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: unknown[]) => mockApi(...a) }));

let mockAdapter: any = null;
jest.mock('../src/utils/healthNative', () => ({ ...jest.requireActual('../src/utils/healthNative'), getHealthAdapter: () => mockAdapter }));

import { HealthSyncScreen } from '../src/screens/HealthSyncScreen';
import { NightEditor, RecentNights, type NightEntry } from '../src/components/SleepNights';
import { nightsFromSessions, sessionsFromSleepSamples } from '../src/utils/healthData';
import { useSettings } from '../src/store/settings';

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
let status: any;
const fakeAdapter = (over: Record<string, unknown> = {}) => ({
  source: 'healthconnect', availability: jest.fn(async () => 'ready'), request: jest.fn(async () => true),
  read: jest.fn(async () => ({ sleep: [{ date: '2026-10-30', bedtime: '23:10', wakeTime: '06:50', awakenings: 1 }], activity: [{ date: '2026-10-30', steps: 5400 }] })), ...over,
});

beforeEach(() => {
  useSettings.setState({ reducedMotion: true, uiLang: 'en' });
  mockApi.mockReset(); mockAdapter = null;
  status = { connected: false, importedSleepNights: 0, importedActivityDays: 0 };
  mockApi.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/health/status') return status;
    if (path === '/consents') return {};
    if (path === '/health/import' && opts?.method === 'POST') return { source: 'healthconnect', imported: { sleep: 1, activity: 1 }, skippedManual: { sleep: 2, activity: 0 } };
    if (path === '/health/import' && opts?.method === 'DELETE') return { deleted: { sleep: 5, activity: 9 }, consentWithdrawn: true };
    return undefined;
  });
});

describe('Health sync', () => {
  it('falls back gracefully when the native module is absent', async () => {
    await render(wrap(<HealthSyncScreen />));
    expect(await screen.findByText(/needs the full Nivora app/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect and import' })).toBeNull();
    // The real loader never throws in Jest / Expo Go.
    jest.doMock('@kingstinct/react-native-healthkit', () => { throw new Error('native module missing'); });
    jest.doMock('react-native-health-connect', () => { throw new Error('native module missing'); });
    const real = jest.requireActual('../src/utils/healthNative');
    expect(real.getHealthAdapter()).toBeNull();
  });

  it('asks for its own consent first, then imports and reports skipped manual nights', async () => {
    mockAdapter = fakeAdapter();
    await render(wrap(<HealthSyncScreen />));
    const connect = await screen.findByRole('button', { name: 'Connect and import' });
    expect(connect.props.accessibilityState.disabled).toBe(true);
    expect(mockAdapter.request).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: 'Connect and import' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/health/import', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ source: 'healthconnect' }) })));
    const paths = mockApi.mock.calls.map((c) => c[0] + ':' + (c[1]?.method ?? 'GET'));
    expect(paths.indexOf('/consents:POST')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('/consents:POST')).toBeLessThan(paths.indexOf('/health/import:POST'));
    expect(mockApi).toHaveBeenCalledWith('/consents', { method: 'POST', body: { consentType: 'HEALTH_IMPORT' } });
    expect(await screen.findByText(/Imported 1 nights and 1 days of steps\. 2 nights you entered yourself/)).toBeTruthy();
  });

  it('reads nothing when the OS permission is declined', async () => {
    mockAdapter = fakeAdapter({ request: jest.fn(async () => false) });
    await render(wrap(<HealthSyncScreen />));
    await fireEvent.press(await screen.findByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: 'Connect and import' }));
    expect(await screen.findByText(/Nothing was read/)).toBeTruthy();
    expect(mockAdapter.read).not.toHaveBeenCalled();
  });

  it('shows a calm message when Health Connect is missing', async () => {
    mockAdapter = fakeAdapter({ availability: jest.fn(async () => 'needs_app') });
    await render(wrap(<HealthSyncScreen />));
    await fireEvent.press(await screen.findByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: 'Connect and import' }));
    expect(await screen.findByText(/Health Connect is not set up/)).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalledWith('/consents', expect.anything());
  });

  it('disconnect needs a confirmation and then deletes imported data', async () => {
    status = { connected: true, importedSleepNights: 5, importedActivityDays: 9 };
    mockAdapter = fakeAdapter();
    await render(wrap(<HealthSyncScreen />));
    expect(await screen.findByText('Connected. 5 imported nights, 9 days of steps.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Disconnect and delete imported data' }));
    expect(mockApi).not.toHaveBeenCalledWith('/health/import', { method: 'DELETE' });
    await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
    expect(mockApi).not.toHaveBeenCalledWith('/health/import', { method: 'DELETE' });
    await fireEvent.press(screen.getByRole('button', { name: 'Disconnect and delete imported data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete and disconnect' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/health/import', { method: 'DELETE' }));
    expect(await screen.findByText('Disconnected. 5 nights and 9 days were deleted.')).toBeTruthy();
  });

  it('disconnect still works with no native module', async () => {
    status = { connected: true, importedSleepNights: 1, importedActivityDays: 0 };
    await render(wrap(<HealthSyncScreen />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Disconnect and delete imported data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete and disconnect' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/health/import', { method: 'DELETE' }));
  });
});

describe('Sleep nights from phone', () => {
  const imported: NightEntry = { id: 'n1', date: '2026-10-30', bedtime: '23:10', wakeTime: '06:50', durationMin: 460, latencyMin: 0, awakenings: 1, rested: null, score: 70, note: null, source: 'healthconnect' };

  it('marks imported nights and handles a null rested value', async () => {
    await render(wrap(<RecentNights entries={[imported, { ...imported, id: 'n2', date: '2026-10-29', rested: 7, source: 'manual' }]} />));
    expect(screen.getAllByText('from your phone')).toHaveLength(1);
    expect(screen.getByText('23:10 → 06:50')).toBeTruthy();
    expect(screen.getByText('23:10 → 06:50 · 7/10')).toBeTruthy();
  });

  it('editing an imported night PATCHes without inventing a rested value', async () => {
    mockApi.mockResolvedValue({});
    const onClose = jest.fn();
    await render(wrap(<NightEditor entry={imported} onClose={onClose} />));
    expect(screen.getByText('How rested: not recorded')).toBeTruthy();
    expect(screen.getByText(/saving makes this night your own entry/i)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('/sleep/n1', { method: 'PATCH', body: { bedtime: '23:10', wakeTime: '06:50', latencyMin: 0, awakenings: 1 } }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('health data conversion', () => {
  it('keeps the longest session per wake date and drops naps', () => {
    const nights = nightsFromSessions([
      { start: new Date(2026, 9, 29, 23, 0), end: new Date(2026, 9, 30, 7, 0), awakenings: 2 },
      { start: new Date(2026, 9, 30, 14, 0), end: new Date(2026, 9, 30, 14, 40) },
      { start: new Date(2026, 9, 30, 13, 0), end: new Date(2026, 9, 30, 15, 0) },
    ]);
    expect(nights).toEqual([{ date: '2026-10-30', bedtime: '23:00', wakeTime: '07:00', awakenings: 2 }]);
  });

  it('turns HealthKit samples into sessions and counts awake periods', () => {
    const s = sessionsFromSleepSamples([
      { start: new Date(2026, 9, 29, 23, 0), end: new Date(2026, 9, 30, 2, 0), value: 3 },
      { start: new Date(2026, 9, 30, 2, 0), end: new Date(2026, 9, 30, 2, 10), value: 2 },
      { start: new Date(2026, 9, 30, 2, 10), end: new Date(2026, 9, 30, 6, 30), value: 4 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]!.awakenings).toBe(1);
  });
});
