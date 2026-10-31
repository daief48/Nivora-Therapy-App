import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) }));

const mockRecorder = { prepareToRecordAsync: jest.fn(async () => {}), record: jest.fn(), stop: jest.fn(async () => {}), uri: 'file:///v.m4a', getStatus: () => ({ metering: -20 }) };
const mockPerm = jest.fn(async () => ({ granted: true }));
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: () => mockPerm(),
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: () => mockRecorder,
}));

const mockPost = jest.fn();
const mockEmotions = jest.fn();
const mockUpdate = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('../src/api/voiceJournal', () => ({
  postVoiceJournal: (...a: unknown[]) => mockPost(...a),
  readEmotions: (...a: unknown[]) => mockEmotions(...a),
  updateJournalEntry: (...a: unknown[]) => mockUpdate(...a),
}));
const mockApi = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: (...a: unknown[]) => mockApi(...a) }));

import { ApiError } from '../src/api/client';
import { VoiceJournalCard, VoiceMarker } from '../src/components/VoiceJournal';
import { vjTranslate, bn, en, hi, ne } from '../src/i18n/ext/voicejournal';
import { useSettings } from '../src/store/settings';

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
const entry = { id: 'e1', entryType: 'FREE', content: 'আমি আজ ক্লান্ত', createdAt: '', updatedAt: '', source: 'voice' as const };
const ok = (over: object = {}) => ({ crisis: false, entry, emotions: { emotions: ['ক্লান্তি', 'চাপ'], reflection: 'A heavy day.', suggestion: 'Drink water.', ai: true }, consentNeeded: null, ...over });

async function record() {
  await render(wrap(<VoiceJournalCard onTypeInstead={jest.fn()} />));
  await fireEvent.press(screen.getByRole('button', { name: 'Start speaking' }));
  await waitFor(() => expect(mockRecorder.record).toHaveBeenCalled());
  await fireEvent.press(screen.getByRole('button', { name: 'Done speaking' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPerm.mockResolvedValue({ granted: true });
  useSettings.setState({ reducedMotion: false, uiLang: 'bn' });
  (global as any).fetch = jest.fn(async () => ({ blob: async () => ({ type: 'audio/mp4', arrayBuffer: async () => new ArrayBuffer(2000) }) }));
});

describe('voice journal flow', () => {
  it('records, transcribes, shows editable transcript, emotion chips and the AI-flagged reflection, then saves edits', async () => {
    useSettings.setState({ uiLang: 'en' });
    mockPost.mockResolvedValue(ok());
    await record();
    await waitFor(() => expect(screen.getByLabelText('Your words')).toBeTruthy());
    expect(mockPost.mock.calls[0]![1]).toBe('audio/mp4');
    expect(mockPost.mock.calls[0]![2]).toMatchObject({ language: 'en' });
    expect(screen.getByText('ক্লান্তি')).toBeTruthy();
    expect(screen.getByText('A heavy day.')).toBeTruthy();
    expect(screen.getByText('Drink water.')).toBeTruthy();
    expect(screen.getByLabelText('This was written by an AI')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Your words'), 'I am a little tired');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('e1', 'I am a little tired'));
    await waitFor(() => expect(screen.getByText(vjTranslate('en', 'vjSaved'))).toBeTruthy());
  });

  it('shows the timer and a stop button while recording, and Cancel discards without uploading', async () => {
    await render(wrap(<VoiceJournalCard />));
    await fireEvent.press(screen.getByRole('button', { name: 'বলতে শুরু করুন' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'বলা শেষ' })).toBeTruthy());
    expect(screen.getByRole('timer')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'বাদ দিন' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'বলতে শুরু করুন' })).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('crisis payload shows support, stores nothing and offers the emergency screen', async () => {
    useSettings.setState({ uiLang: 'en' });
    mockPost.mockResolvedValue({ crisis: true, entry: null, emotions: null, safety: { severity: 'HIGH', crisis: true, message: 'Please reach out now.', resources: [{ name: 'Helpline', contactDetails: '999' }] } });
    await record();
    await waitFor(() => expect(screen.getByText('Please reach out now.')).toBeTruthy());
    expect(screen.getByText('999')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'See support options' }));
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });

  it('offers consent after saving; granting it replays the emotion reading', async () => {
    useSettings.setState({ uiLang: 'en' });
    mockPost.mockResolvedValue(ok({ emotions: null, consentNeeded: 'JOURNAL_AI_SHARING' }));
    mockEmotions.mockResolvedValue({ crisis: false, emotions: ['calm'], reflection: 'Quiet.', suggestion: 'Stretch.', ai: true });
    await record();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow and continue' })).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Allow and continue' }));
    await waitFor(() => expect(mockEmotions).toHaveBeenCalledWith(entry.content, entry.id));
    await waitFor(() => expect(screen.getByText('Quiet.')).toBeTruthy());
    expect(mockApi).toHaveBeenCalledWith('/consents', expect.objectContaining({ method: 'POST' }));
  });

  it('permission denied is a calm message with a type-instead way out', async () => {
    useSettings.setState({ uiLang: 'en' });
    mockPerm.mockResolvedValue({ granted: false });
    const onType = jest.fn();
    await render(wrap(<VoiceJournalCard onTypeInstead={onType} />));
    await fireEvent.press(screen.getByRole('button', { name: 'Start speaking' }));
    await waitFor(() => expect(screen.getByText(vjTranslate('en', 'vjMicDenied'))).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
    expect(onType).toHaveBeenCalled();
    expect(mockRecorder.record).not.toHaveBeenCalled();
  });

  it('offline keeps the recording and retries it', async () => {
    useSettings.setState({ uiLang: 'en' });
    mockPost.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'x')).mockResolvedValueOnce(ok());
    await record();
    await waitFor(() => expect(screen.getByText(vjTranslate('en', 'vjOffline'))).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('Your words')).toBeTruthy());
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);
  });

  it('maps server errors to gentle messages (NO_SPEECH)', async () => {
    useSettings.setState({ uiLang: 'en' });
    mockPost.mockRejectedValue(new ApiError(422, 'NO_SPEECH', 'x'));
    await record();
    await waitFor(() => expect(screen.getByText(vjTranslate('en', 'vjNoSpeech'))).toBeTruthy());
  });

  it('works with reduced motion', async () => {
    useSettings.setState({ reducedMotion: true, uiLang: 'en' });
    mockPost.mockResolvedValue(ok());
    await record();
    await waitFor(() => expect(screen.getByLabelText('Your words')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByText(vjTranslate('en', 'vjSaved'))).toBeTruthy());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('VoiceMarker and strings', () => {
  it('marks only voice entries', async () => {
    useSettings.setState({ uiLang: 'en' });
    const { rerender } = await render(<VoiceMarker source="text" />);
    expect(screen.queryByText('Voice')).toBeNull();
    await rerender(<VoiceMarker source="voice" />);
    expect(screen.getByText('Voice')).toBeTruthy();
  });
  it('every language covers every English key', () => {
    for (const d of [bn, hi, ne]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
  });
});
