import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockHandlers: Record<string, (e: any) => void> = {};
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockAbort = jest.fn();
// per-instance handlers (index = mount order), to simulate several mics hearing the same global event
const mockInst: Record<string, ((e: any) => void)[]> = {};
let mockGranted = true;
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    getPermissionsAsync: async () => ({ granted: mockGranted }),
    requestPermissionsAsync: async () => ({ granted: mockGranted }),
    start: (o: any) => mockStart(o),
    stop: () => mockStop(),
    abort: () => mockAbort(),
  },
  useSpeechRecognitionEvent: (name: string, fn: (e: any) => void) => {
    const R = require('react');
    const idx = R.useRef(-1);
    const list = (mockInst[name] ??= []);
    if (idx.current < 0) { idx.current = list.length; list.push(fn); }
    list[idx.current] = fn;
    mockHandlers[name] = fn;
  },
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
  mockGranted = true; mockStart.mockClear(); mockStop.mockClear(); mockAbort.mockClear(); for (const k of Object.keys(mockInst)) delete mockInst[k];
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

describe('GoalVoiceMic lifecycle and isolation', () => {
  it('aborts native recognition on unmount', async () => {
    await open();
    await act(async () => { cleanup(); });
    expect(mockAbort).toHaveBeenCalled();
  });

  it('clears a pending language-pick restart when the panel is closed', async () => {
    await open();
    const calls = mockStart.mock.calls.length;
    jest.useFakeTimers();
    await fireEvent.press(screen.getByText('বাংলা'));
    await fireEvent.press(screen.getByText(nvEn.kzVcCancel));
    await act(async () => { jest.advanceTimersByTime(600); });
    jest.useRealTimers();
    expect(mockStart.mock.calls.length).toBe(calls);
  });

  it('clears a pending restart on unmount', async () => {
    await open();
    const calls = mockStart.mock.calls.length;
    jest.useFakeTimers();
    await fireEvent.press(screen.getByText('বাংলা'));
    await act(async () => { cleanup(); });
    await act(async () => { jest.advanceTimersByTime(600); });
    jest.useRealTimers();
    expect(mockStart.mock.calls.length).toBe(calls);
  });

  it('a closed instance ignores events while the open one collects them', async () => {
    await render(<><GoalVoiceMic onText={jest.fn()} /><GoalVoiceMic onText={jest.fn()} /></>);
    await fireEvent.press(screen.getAllByLabelText(nvEn.kzUpVoice)[0]!);
    await flush();
    await act(async () => { for (const h of mockInst.result!) h({ isFinal: true, results: [{ transcript: 'only mine' }] }); });
    expect(screen.getAllByDisplayValue('only mine')).toHaveLength(1);
    expect(screen.getAllByPlaceholderText(nvEn.kzVcEdit)).toHaveLength(1);
  });

  it('clears the draft when reopened', async () => {
    await open();
    await act(async () => { mockHandlers.result!({ isFinal: true, results: [{ transcript: 'old words' }] }); });
    expect(screen.getByDisplayValue('old words')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(nvEn.kzUpVoice)); // close
    await fireEvent.press(screen.getByLabelText(nvEn.kzUpVoice)); // reopen
    await flush();
    expect(screen.queryByDisplayValue('old words')).toBeNull();
  });

  it('an old session end after a language switch does not stop the live session', async () => {
    await open();
    jest.useFakeTimers();
    await fireEvent.press(screen.getByText('বাংলা'));
    await act(async () => { jest.advanceTimersByTime(400); });
    jest.useRealTimers();
    await flush();
    await act(async () => { mockHandlers.end!({}); }); // old session
    expect(screen.getByText(nvEn.kzVcListening)).toBeTruthy();
    await act(async () => { mockHandlers.end!({}); }); // live session
    expect(screen.queryByText(nvEn.kzVcListening)).toBeNull();
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
