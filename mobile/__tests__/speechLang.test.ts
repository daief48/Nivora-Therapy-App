jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => []), isSpeakingAsync: jest.fn(async () => false) }));
jest.mock('../src/api/client', () => ({ apiAudio: jest.fn(async () => new ArrayBuffer(10)) }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => ({ play: jest.fn(), remove: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) })), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: '' } }));

import { detectLang, speak, stopSpeaking } from '../src/utils/speech';

describe('speech language detection for calls', () => {
  it('keeps Latin as English and Bangla script as Bangla', () => {
    expect(detectLang('How are you feeling today?')).toBe('en');
    expect(detectLang('আজ কেমন লাগছে?')).toBe('bn');
    expect(detectLang('আজ কেমন লাগছে? How are you?')).toBe('mixed');
  });
  it('voices Devanagari as Hindi by default and as Nepali once the session language is Nepali', async () => {
    expect(detectLang('आज आप कैसा महसूस कर रहे हैं?')).toBe('hi');
    await speak('', 'ne', {}).catch(() => {}); // records the session language
    expect(detectLang('तपाईंलाई आज कस्तो छ?')).toBe('ne');
    await speak('', 'hi', {}).catch(() => {});
    expect(detectLang('आज आप कैसा महसूस कर रहे हैं?')).toBe('hi');
    stopSpeaking();
  });
});
