const mockApiAudio = jest.fn();
jest.mock('../src/api/client', () => ({ apiAudio: (...a: any[]) => mockApiAudio(...a) }));

const mockSpeakDevice = jest.fn();
const mockStopDevice = jest.fn();
let mockVoices: any[] = [];
jest.mock('expo-speech', () => ({
  speak: (text: string, opts: any) => { mockSpeakDevice(text, opts); setTimeout(() => opts.onDone?.(), 0); },
  stop: () => mockStopDevice(),
  getAvailableVoicesAsync: async () => mockVoices,
}));

// expo-audio: the player reports "finished" when we call finishAll().
const players: { play: jest.Mock; remove: jest.Mock; pause: jest.Mock; listener?: (s: any) => void }[] = [];
jest.mock('expo-audio', () => ({
  setAudioModeAsync: async () => {},
  createAudioPlayer: (src: any) => {
    const p: any = { src, play: jest.fn(), remove: jest.fn(), pause: jest.fn(), addListener: (_e: string, fn: any) => { p.listener = fn; return { remove: jest.fn() }; } };
    players.push(p);
    return p;
  },
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class { uri: string; constructor(_d: any, name: string) { this.uri = `file:///cache/${name}`; } create() {} write() {} delete() {} },
}));

import { detectLang, prepareSpeech, speak, splitByScript, splitChunks, stopSpeaking, _resetVoiceCache } from '../src/utils/speech';
import { useSettings } from '../src/store/settings';

const finishPlayer = async (i: number) => { await Promise.resolve(); players[i]!.listener?.({ didJustFinish: true }); await new Promise((r) => setTimeout(r, 0)); };
const flush = () => new Promise((r) => setTimeout(r, 5));
const audio = () => Promise.resolve(new ArrayBuffer(2048));

beforeEach(() => {
  mockApiAudio.mockReset(); mockSpeakDevice.mockClear(); mockStopDevice.mockClear(); players.length = 0; mockVoices = []; _resetVoiceCache();
  useSettings.setState({ naturalVoice: true });
});

describe('text preparation', () => {
  it('strips markdown, links and emoji so they are not read aloud', () => {
    expect(prepareSpeech('## হ্যালো **বন্ধু** 😊 দেখুন https://x.co `code`')).toBe('হ্যালো বন্ধু দেখুন code');
  });
  it('detects Bangla, English and mixed text', () => {
    expect(detectLang('আমি এখানে আছি')).toBe('bn');
    expect(detectLang('Take a deep breath')).toBe('en');
    expect(detectLang('আজ একটু breathing exercise করবেন?')).toBe('mixed');
  });
  it('chunks by sentence (including the Bangla danda), with a short first chunk for a fast start', () => {
    const text = 'আমি এখানে আছি। আপনার কথা শুনছি। আজ কেমন লাগছে? ' + 'একটু ধীরে শ্বাস নিন। '.repeat(20);
    const chunks = splitChunks(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.length).toBeLessThanOrEqual(110);
    expect(chunks.every((c) => c.length <= 260)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
  it('splits mixed text into Bangla and English runs', () => {
    expect(splitByScript('আজ একটু breathing exercise করবেন')).toEqual([
      { text: 'আজ একটু', lang: 'bn' }, { text: 'breathing exercise', lang: 'en' }, { text: 'করবেন', lang: 'bn' },
    ]);
  });
});

describe('natural voice', () => {
  it('requests Bangla speech per chunk, prefetches ahead, plays in order, and reports start then done', async () => {
    mockApiAudio.mockImplementation(audio);
    const events: string[] = [];
    const text = 'আমি এখানে আছি, আপনার কথা মন দিয়ে শুনছি। ' + 'একটু ধীরে শ্বাস নিন, তারপর বলুন কী হয়েছে। '.repeat(8);
    const n = splitChunks(text).length;
    const done = speak(text, 'bn', { onPreparing: () => events.push('prep'), onStart: () => events.push('start'), onDone: () => events.push('done') });
    await flush();
    expect(mockApiAudio).toHaveBeenCalledWith('/speech', expect.objectContaining({ language: 'bn' }));
    expect(mockApiAudio.mock.calls.length).toBe(Math.min(n, 3)); // chunk 0 playing + the next two prefetched, so there are no gaps between sentences
    expect(events).toEqual(['prep', 'start']);
    for (let i = 0; i < n; i++) { await flush(); await finishPlayer(i); }
    await done;
    expect(mockApiAudio).toHaveBeenCalledTimes(n);
    expect(events).toEqual(['prep', 'start', 'done']);
    expect(mockSpeakDevice).not.toHaveBeenCalled(); // the phone's voice was never needed
    expect(players[0]!.play).toHaveBeenCalled();
  });

  it('sends the detected language for mixed replies', async () => {
    mockApiAudio.mockImplementation(audio);
    void speak('আজ একটু breathing exercise করবেন?', 'bn', {});
    await flush();
    expect(mockApiAudio).toHaveBeenCalledWith('/speech', { text: 'আজ একটু breathing exercise করবেন?', language: 'mixed' });
  });

  it('falls back to the phone voice (Bangla voice picked) when the service fails, and still finishes', async () => {
    mockApiAudio.mockRejectedValue(new Error('offline'));
    mockVoices = [{ identifier: 'en1', language: 'en-US', quality: 'Default' }, { identifier: 'bn-low', language: 'bn-IN', quality: 'Default' }, { identifier: 'bn-best', language: 'bn-BD', quality: 'Enhanced' }];
    const events: string[] = [];
    await speak('আমি এখানে আছি।', 'bn', { onStart: () => events.push('start'), onDone: () => events.push('done'), onNotice: () => events.push('notice') });
    expect(mockSpeakDevice).toHaveBeenCalledWith('আমি এখানে আছি।', expect.objectContaining({ language: 'bn-BD', voice: 'bn-best' }));
    expect(events).toEqual(['start', 'done']);
  });

  it('warns when the phone has no Bangla voice at all', async () => {
    mockApiAudio.mockRejectedValue(new Error('quota'));
    mockVoices = [{ identifier: 'en1', language: 'en-US' }];
    const notices: string[] = [];
    await speak('আমি এখানে আছি।', 'bn', { onNotice: (k) => notices.push(k) });
    expect(notices).toEqual(['noBanglaVoice']);
  });

  it('uses only the phone voice when Natural voice is turned off (no network call)', async () => {
    useSettings.setState({ naturalVoice: false });
    mockVoices = [{ identifier: 'bn1', language: 'bn-BD' }];
    await speak('আমি এখানে আছি।', 'bn', {});
    expect(mockApiAudio).not.toHaveBeenCalled();
    expect(mockSpeakDevice).toHaveBeenCalled();
  });

  it('speaks mixed text on the phone voice with matching Bangla and English voices', async () => {
    useSettings.setState({ naturalVoice: false });
    mockVoices = [{ identifier: 'bn1', language: 'bn-BD' }, { identifier: 'en1', language: 'en-US' }];
    await speak('আজ একটু breathing exercise করবেন', 'mixed', {});
    expect(mockSpeakDevice.mock.calls.map((c) => [c[1].language, c[1].voice])).toEqual([['bn-BD', 'bn1'], ['en-US', 'en1'], ['bn-BD', 'bn1']]);
  });

  it('stopping mid-playback silences it and never reports done', async () => {
    mockApiAudio.mockImplementation(audio);
    const onDone = jest.fn();
    void speak('আমি এখানে আছি। আরেকটি বাক্য।', 'bn', { onDone });
    await flush();
    stopSpeaking();
    await flush();
    expect(players[0]!.pause).toHaveBeenCalled();
    expect(mockStopDevice).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a new reply replaces the old one instead of overlapping', async () => {
    mockApiAudio.mockImplementation(audio);
    const first = jest.fn(), second = jest.fn();
    void speak('প্রথম বাক্য।', 'bn', { onDone: first });
    await flush();
    void speak('দ্বিতীয় বাক্য।', 'bn', { onDone: second });
    await flush();
    await finishPlayer(1);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('empty text finishes immediately', async () => {
    const onDone = jest.fn();
    await speak('😊 **  **', 'en', { onDone });
    expect(onDone).toHaveBeenCalled();
    expect(mockApiAudio).not.toHaveBeenCalled();
  });
});

describe('natural voice retries', () => {
  it('retries once on a transient failure and does NOT fall back to the phone voice', async () => {
    mockApiAudio.mockRejectedValueOnce(Object.assign(new Error('blip'), { code: 'NETWORK' })).mockImplementation(audio);
    const events: string[] = [];
    void speak('আমি এখানে আছি।', 'bn', { onStart: () => events.push('start'), onDone: () => events.push('done') });
    await new Promise((r) => setTimeout(r, 800));
    expect(mockApiAudio).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['start']);
    await finishPlayer(0);
    await flush();
    expect(events).toEqual(['start', 'done']);
    expect(mockSpeakDevice).not.toHaveBeenCalled();
  });

  it('does not retry quota errors (they will not fix themselves) and falls back straight away', async () => {
    mockApiAudio.mockRejectedValue(Object.assign(new Error('quota'), { code: 'TTS_QUOTA_EXHAUSTED' }));
    mockVoices = [{ identifier: 'bn1', language: 'bn-BD' }];
    await speak('আমি এখানে আছি।', 'bn', {});
    expect(mockApiAudio).toHaveBeenCalledTimes(1);
    expect(mockSpeakDevice).toHaveBeenCalled();
  });

  it('gives up after one retry and uses the phone voice', async () => {
    mockApiAudio.mockRejectedValue(Object.assign(new Error('down'), { code: 'TTS_UNAVAILABLE' }));
    mockVoices = [{ identifier: 'bn1', language: 'bn-BD' }];
    await speak('আমি এখানে আছি।', 'bn', {});
    expect(mockApiAudio).toHaveBeenCalledTimes(2);
    expect(mockSpeakDevice).toHaveBeenCalled();
  });
});
