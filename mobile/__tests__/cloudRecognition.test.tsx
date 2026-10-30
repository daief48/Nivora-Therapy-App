import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { CloudRecognition } from '../src/components/CloudRecognition';

const mockTranscribe = jest.fn();
const mockRecorder = { prepareToRecordAsync: jest.fn(async () => {}), record: jest.fn(), stop: jest.fn(async () => {}), uri: 'file:///x.m4a', getStatus: () => ({ metering: -20 }) };
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: () => mockRecorder,
}));
jest.mock('../src/api/client', () => ({ apiTranscribe: (...a: unknown[]) => mockTranscribe(...a) }));

const props = (over = {}) => ({ locale: 'bn-BD', listening: false, onListening: jest.fn(), onTranscript: jest.fn(), onError: jest.fn(), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = jest.fn(async () => ({ blob: async () => ({ type: 'audio/mp4', arrayBuffer: async () => new ArrayBuffer(2000) }) }));
});

describe('CloudRecognition (Bangla listening through the server)', () => {
  it('records while held, sends Bangla audio to the server and returns the words', async () => {
    mockTranscribe.mockResolvedValue('আমি আজ খুব ক্লান্ত');
    const p = props();
    await render(<CloudRecognition {...p} />);
    const btn = screen.getByRole('button');
    await fireEvent(btn, 'pressIn');
    await waitFor(() => expect(mockRecorder.record).toHaveBeenCalled());
    await fireEvent(btn, 'pressOut');
    await waitFor(() => expect(p.onTranscript).toHaveBeenCalledWith('আমি আজ খুব ক্লান্ত', true));
    expect(mockTranscribe.mock.calls[0]![1]).toBe('audio/mp4');
    expect(mockTranscribe.mock.calls[0]![2]).toBe('bn');
    expect(p.onListening).toHaveBeenLastCalledWith(false);
  });

  it('reports "heard nothing" for an empty transcript and "failed" when the server errors', async () => {
    mockTranscribe.mockResolvedValueOnce('');
    const p = props();
    await render(<CloudRecognition {...p} />);
    let btn = screen.getByRole('button');
    await fireEvent(btn, 'pressIn');
    await waitFor(() => expect(mockRecorder.record).toHaveBeenCalled());
    await fireEvent(btn, 'pressOut');
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('none'));

    mockTranscribe.mockRejectedValueOnce(new Error('boom'));
    btn = screen.getByRole('button');
    await fireEvent(btn, 'pressIn');
    await waitFor(() => expect(mockRecorder.record).toHaveBeenCalledTimes(2));
    await fireEvent(btn, 'pressOut');
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('failed'));
  });
});
