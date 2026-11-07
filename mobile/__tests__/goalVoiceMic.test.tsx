import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockHandlers: Record<string, (e: any) => void> = {};
const mockStart = jest.fn();
const mockStop = jest.fn();
let mockGranted = true;
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    getPermissionsAsync: async () => ({ granted: mockGranted }),
    requestPermissionsAsync: async () => ({ granted: mockGranted }),
    start: (o: any) => mockStart(o),
    stop: () => mockStop(),
  },
  useSpeechRecognitionEvent: (name: string, fn: (e: any) => void) => { mockHandlers[name] = fn; },
}));

import { GoalVoiceMic } from '../src/components/kaizen/GoalVoiceMic';
import { translate } from '../src/i18n';
import { nvBn, nvEn } from '../src/i18n/nivora';
import { useSettings } from '../src/store/settings';
import { speechLocale } from '../src/utils/speech';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const open = async (onText = jest.fn()) => {
  await render(<GoalVoiceMic onText={onText} />);
  await fireEvent.press(screen.getByLabelText(translate(useSettings.getState().uiLang, 'kzUpVoice')));
  await flush();
  return onText;
};

beforeEach(() => {
  mockGranted = true; mockStart.mockClear(); mockStop.mockClear();
  useSettings.setState({ uiLang: 'en' } as never);
});
afterEach(() => cleanup());

describe('GoalVoiceMic', () => {
  it('shows a visible message when microphone permission is denied', async () => {
    mockGranted = false;
    await open();
    expect(screen.getByText(nvEn.kzVcDenied)).toBeTruthy();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('shows messages for no speech and recognition errors', async () => {
    await open();
    await act(async () => { mockHandlers.error!({ error: 'no-speech' }); });
    expect(screen.getByText(nvEn.kzVcNoSpeech)).toBeTruthy();
    await act(async () => { mockHandlers.error!({ error: 'network' }); });
    expect(screen.getByText(nvEn.kzVcError)).toBeTruthy();
  });

  it('starts continuous recognition in the app language by default, in Bangla for bn', async () => {
    useSettings.setState({ uiLang: 'bn' } as never);
    await open();
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ lang: 'bn-BD', continuous: true, interimResults: true }));
  });

  it('passes the chosen spoken language to start(), independent of the app language', async () => {
    await open();
    expect(mockStart).toHaveBeenLastCalledWith(expect.objectContaining({ lang: 'en-US' }));
    jest.useFakeTimers();
    await fireEvent.press(screen.getByText('বাংলা'));
    await act(async () => { jest.advanceTimersByTime(400); });
    jest.useRealTimers();
    expect(mockStop).toHaveBeenCalled();
    expect(mockStart).toHaveBeenLastCalledWith(expect.objectContaining({ lang: 'bn-BD' }));
  });

  it('omits lang for auto', async () => {
    await open();
    jest.useFakeTimers();
    await fireEvent.press(screen.getByText(nvEn.kzVcAuto));
    await act(async () => { jest.advanceTimersByTime(400); });
    jest.useRealTimers();
    expect(mockStart.mock.calls.at(-1)![0].lang).toBeUndefined();
  });

  it('accumulates final results, lets the user edit, and only submits on confirm', async () => {
    const onText = await open();
    await act(async () => { mockHandlers.result!({ isFinal: true, results: [{ transcript: 'read one page' }] }); });
    await act(async () => { mockHandlers.result!({ isFinal: true, results: [{ transcript: 'before bed' }] }); });
    expect(onText).not.toHaveBeenCalled();
    const box = screen.getByDisplayValue('read one page before bed');
    await fireEvent.changeText(box, 'read two pages before bed');
    expect(onText).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText(nvEn.kzVcUse));
    expect(onText).toHaveBeenCalledWith('read two pages before bed');
  });
});

describe('speechLocale and strings', () => {
  it('maps th to th-TH', () => {
    expect(speechLocale('th')).toBe('th-TH');
    expect(speechLocale('bn')).toBe('bn-BD');
    expect(speechLocale('auto')).toBe('auto');
  });

  it('has Bangla strings for every new voice key', () => {
    const keys = Object.keys(nvEn).filter((k) => k.startsWith('kzVc')) as (keyof typeof nvEn)[];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      expect(nvBn[k]).toBeTruthy();
      expect(nvBn[k]).toMatch(/[ঀ-৿]/);
      expect(nvBn[k]).not.toMatch(/[À-ÿ�]/); // no mojibake
    }
  });
});
