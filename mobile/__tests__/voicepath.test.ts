jest.mock('../src/api/client', () => ({ apiAudio: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: async () => [] }));

import { isCloudEcho, isGarbageTranscript, isRealBargeIn, looksLikeEcho, textSimilarity, transcriptRejection } from '../src/utils/voiceFilter';
import { adaptiveEndOfSpeechMs, PreRoll, sentenceFinish, shouldUploadClip, SpeechGate } from '../src/utils/voiceVad';
import { chooseRecognizer, reasonFromNativeError } from '../src/utils/voiceRecognizer';
import { isEcho } from '../src/utils/speech';
import { bn, en } from '../src/i18n/ext/voicepath';

describe('voiceFilter: garbage transcripts', () => {
  it.each(['', '   ', '...', '?!', '♪♪', '🎵', 'um', 'Hmm.', 'uh uh', 'উম', 'হুম', 'हम्म', 'aaaa', 'you you you you you'])('drops %p', (t) => {
    expect(isGarbageTranscript(t)).toBe(true);
  });
  it.each([
    'Thank you for watching', 'thanks for watching!', 'Subtitles by the Amara.org community', 'ভিডিওটি দেখার জন্য ধন্যবাদ', 'देखने के लिए धन्यवाद', 'हेर्नुभएकोमा धन्यवाद',
  ])('drops the silence hallucination %p', (t) => {
    expect(transcriptRejection(t)).toBe('hallucination');
  });
  it('never drops real short answers or safety words', () => {
    for (const t of ['no', 'yes', 'help', 'help me', 'না', 'হ্যাঁ', 'আমি আর পারছি না', 'मुझे मदद चाहिए', 'I want to hurt myself', 'thank you for listening to me today, I feel awful']) {
      expect(isGarbageTranscript(t)).toBe(false);
    }
  });
});

describe('echo similarity', () => {
  const said = 'Let us take a slow breath together. Breathe in, and breathe out slowly.';
  it('computes language-agnostic similarity', () => {
    expect(textSimilarity('slow breath together', said).containment).toBe(1);
    expect(textSimilarity('my sister called me today', said).containment).toBeLessThan(0.3);
    expect(textSimilarity('', said)).toEqual({ dice: 0, containment: 0, trigram: 0 });
  });
  it('catches the assistant coming back through the speaker, with recogniser spelling drift', () => {
    expect(looksLikeEcho('take a slow breath together', said)).toBe(true);
    expect(looksLikeEcho('lets take a slow breathe together', said)).toBe(true);
  });
  it('works for Bangla and Devanagari', () => {
    const bnSaid = 'আমি এখানে আছি। আপনার কথা মন দিয়ে শুনছি।';
    expect(looksLikeEcho('আপনার কথা মন দিয়ে শুনছি', bnSaid)).toBe(true);
    expect(looksLikeEcho('আমার খুব ভয় করছে', bnSaid)).toBe(false);
    const hiSaid = 'मैं यहाँ हूँ। मैं आपकी बात ध्यान से सुन रहा हूँ।';
    expect(looksLikeEcho('आपकी बात ध्यान से सुन रहा', hiSaid)).toBe(true);
    expect(looksLikeEcho('मुझे बहुत डर लग रहा है', hiSaid)).toBe(false);
  });
  it('does not call a real interruption an echo', () => {
    expect(looksLikeEcho('wait I need to say something', said)).toBe(false);
    expect(isEcho('wait I need to say something', said)).toBe(false);
    expect(isEcho('lets take a slow breathe together', said)).toBe(true);
    expect(isEcho('take a slow breath', said, false)).toBe(false); // suppressEcho off
  });
  it('gates barge-in: needs confidence, duration and a non-echo', () => {
    const base = { spoken: said, sinceFirstMs: 500 };
    expect(isRealBargeIn({ ...base, text: 'wait I need to stop' })).toBe(true);
    expect(isRealBargeIn({ ...base, text: 'wait I need to stop', confidence: 0.2 })).toBe(false);
    expect(isRealBargeIn({ ...base, text: 'take a slow breath together' })).toBe(false);
    expect(isRealBargeIn({ ...base, text: 'stop', sinceFirstMs: 100 })).toBe(false);
    expect(isRealBargeIn({ ...base, text: 'hmm' })).toBe(false);
    expect(isRealBargeIn({ ...base, text: 'take a slow breath together', suppressEcho: false })).toBe(true);
  });
  it('drops cloud clips that are the assistant\'s own words, but not short or different speech', () => {
    expect(isCloudEcho('take a slow breath together breathe in', said)).toBe(true);
    expect(isCloudEcho('breathe out', said)).toBe(false);
    expect(isCloudEcho('I cannot breathe at all today honestly', said)).toBe(false);
  });
});

describe('pre-roll and speech gate', () => {
  it('keeps only the last 600 ms of levels', () => {
    const r = new PreRoll(600);
    for (let t = 0; t <= 2000; t += 120) r.push(t, -50);
    expect(r.startsAt).toBeGreaterThanOrEqual(2000 - 120 * 5 - 120); // ~600 ms window
    expect(r.size).toBeLessThanOrEqual(6);
    r.clear(); expect(r.size).toBe(0);
  });
  const feed = (g: SpeechGate, levels: number[]) => levels.forEach((db, i) => g.feed(i * 120, db));
  const quiet = [-60, -60, -60, -60, -60, -60];
  it('discards silence', () => {
    const g = new SpeechGate(120);
    feed(g, [...quiet, ...quiet, ...quiet]);
    expect(g.speechMs).toBe(0);
    expect(shouldUploadClip(g.summary())).toBe(false);
  });
  it('discards a click shorter than the minimum speech time', () => {
    const g = new SpeechGate(120);
    feed(g, [...quiet, -20, -20, ...quiet]);
    expect(g.speechMs).toBe(240);
    expect(shouldUploadClip(g.summary(), 350)).toBe(false);
    expect(shouldUploadClip(g.summary(), 200)).toBe(true);
  });
  it('accepts real speech and reports where to trim, including the pre-roll', () => {
    const g = new SpeechGate(120);
    const levels = [...quiet, ...quiet, -20, -18, -22, -19, -21, ...quiet];
    feed(g, levels);
    const s = g.summary(600, 300);
    expect(s.speechMs).toBeGreaterThanOrEqual(600);
    expect(s.trimStartMs).toBe(12 * 120 - 600);
    expect(s.trimEndMs).toBe(16 * 120 + 300);
    expect(shouldUploadClip(s)).toBe(true);
  });
  it('rejects room noise that is loud relative to the floor but below the absolute peak', () => {
    const g = new SpeechGate(120);
    feed(g, [-80, -80, -80, -80, -50, -50, -50, -50, -50]);
    expect(shouldUploadClip(g.summary(), 350)).toBe(false);
  });
  it('never discards when the platform gives no metering', () => {
    expect(shouldUploadClip(new SpeechGate(120).summary())).toBe(true);
  });
});

describe('adaptive end of speech', () => {
  it('is shorter after a finished-sounding sentence and longer mid-thought, within 700-1300 ms', () => {
    const fin = adaptiveEndOfSpeechMs(2000, 'I am feeling better today.');
    const unk = adaptiveEndOfSpeechMs(2000, 'I am feeling better today');
    const open = adaptiveEndOfSpeechMs(2000, 'I am feeling better today but');
    expect(fin).toBeLessThan(unk);
    expect(unk).toBeLessThan(open);
    for (const v of [fin, unk, open, adaptiveEndOfSpeechMs(500, 'ok.'), adaptiveEndOfSpeechMs(9000, 'and')]) { expect(v).toBeGreaterThanOrEqual(700); expect(v).toBeLessThanOrEqual(1300); }
    expect(adaptiveEndOfSpeechMs(2000)).toBe(unk);
  });
  it('understands Bangla, Hindi and Nepali continuations and sentence ends', () => {
    expect(sentenceFinish('আমার খুব খারাপ লাগছে কিন্তু')).toBe('open');
    expect(sentenceFinish('मुझे अच्छा लग रहा है लेकिन')).toBe('open');
    expect(sentenceFinish('मलाई ठीक छ तर')).toBe('open');
    expect(sentenceFinish('আমি ভালো আছি।')).toBe('finished');
    expect(sentenceFinish('well, ')).toBe('open');
    expect(sentenceFinish(undefined)).toBe('unknown');
  });
});

describe('chooseRecognizer', () => {
  it('uses the device recogniser only when it supports the language', () => {
    expect(chooseRecognizer('en-US', { deviceAvailable: true })).toEqual({ kind: 'device' });
    expect(chooseRecognizer('bn-BD', { deviceAvailable: true, supportedLocales: ['en-US', 'bn-IN'] })).toEqual({ kind: 'device' }); // same language
    expect(chooseRecognizer('bn-BD', { deviceAvailable: true, supportedLocales: ['en-US'] })).toEqual({ kind: 'cloud', reason: 'unsupported_language' });
    expect(chooseRecognizer('ne-NP', { deviceAvailable: true })).toEqual({ kind: 'cloud', reason: 'unsupported_language' });
  });
  it('uses the cloud when there is no device recogniser, and always for auto', () => {
    expect(chooseRecognizer('en-US', { deviceAvailable: false })).toEqual({ kind: 'cloud', reason: undefined });
    expect(chooseRecognizer('auto', { deviceAvailable: true, supportedLocales: ['auto', 'en-US'] })).toEqual({ kind: 'cloud' });
  });
  it('reports no_network when nothing can listen offline', () => {
    expect(chooseRecognizer('bn-BD', { deviceAvailable: true, supportedLocales: ['en-US'], online: false })).toEqual({ kind: 'none', reason: 'no_network' });
    expect(chooseRecognizer('auto', { deviceAvailable: true, online: false })).toEqual({ kind: 'none', reason: 'no_network' });
    expect(chooseRecognizer('en-US', { deviceAvailable: true, online: false, onDeviceLocales: ['en-US'] })).toEqual({ kind: 'device' });
  });
  it('maps native errors to reasons', () => {
    expect(reasonFromNativeError('not-allowed')).toBe('denied');
    expect(reasonFromNativeError('language-not-supported')).toBe('unsupported_language');
    expect(reasonFromNativeError('network')).toBe('no_network');
    expect(reasonFromNativeError('no-speech')).toBe('none');
    expect(reasonFromNativeError('audio-capture')).toBe('failed');
  });
});

describe('voicepath strings', () => {
  it('has identical keys in English and Bangla', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).every((k) => k.startsWith('vp'))).toBe(true);
  });
});
