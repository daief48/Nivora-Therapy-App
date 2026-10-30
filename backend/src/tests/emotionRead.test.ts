import { describe, expect, it } from 'vitest';
import { emotionBlock, parseEmotionRead, readEmotion } from '../services/emotionRead.js';
import { fakeGlm } from './helpers.js';

const READ = { emotions: ['overwhelmed', 'tired'], intensity: 4, need: 'listen', theme: 'exam pressure', userWords: ['my mind goes blank'] };

describe('emotion read', () => {
  it('parses strict JSON (also inside prose or code fences) and rejects the rest', () => {
    expect(parseEmotionRead(JSON.stringify(READ))).toMatchObject({ intensity: 4, need: 'listen' });
    expect(parseEmotionRead('```json\n' + JSON.stringify(READ) + '\n```')?.emotions).toEqual(['overwhelmed', 'tired']);
    expect(parseEmotionRead('not json')).toBeNull();
    expect(parseEmotionRead(JSON.stringify({ ...READ, intensity: 9 }))).toBeNull();
    expect(parseEmotionRead(JSON.stringify({ ...READ, need: 'fix-it' }))).toBeNull();
    expect(parseEmotionRead(JSON.stringify({ ...READ, emotions: ['a', 'b', 'c', 'd'] }))).toBeNull();
  });

  it('returns the read from the utility model and sends only the message', async () => {
    const glm = fakeGlm(JSON.stringify(READ));
    const r = await readEmotion(glm, 'my mind goes blank');
    expect(r?.userWords).toEqual(['my mind goes blank']);
    expect(glm.calls).toHaveLength(1);
    expect(glm.calls[0]![1]!.content).toBe('my mind goes blank');
  });

  it('is fail-safe: errors, garbage and timeouts give null', async () => {
    expect(await readEmotion(fakeGlm(new Error('boom')), 'hello')).toBeNull();
    expect(await readEmotion(fakeGlm('I am sorry'), 'hello')).toBeNull();
    const slow = { async chat(_m: unknown, o?: { signal?: AbortSignal }) { await new Promise((_r, rej) => o?.signal?.addEventListener('abort', () => rej(new Error('aborted')))); return { content: '', inputTokens: 0, outputTokens: 0 }; }, stream: async () => { throw new Error('unused'); } };
    const t0 = Date.now();
    expect(await readEmotion(slow as any, 'hello', { timeoutMs: 30 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(await readEmotion(fakeGlm(JSON.stringify(READ)), '   ')).toBeNull();
  });

  it('builds a private block that forbids solutions for listen / validate / comfort and slows down for high intensity', () => {
    const b = emotionBlock(READ as any);
    expect(b).toContain('EMOTION READ (private, never mention it)');
    expect(b).toContain('"my mind goes blank"');
    expect(b).toMatch(/Do NOT give solutions/);
    expect(b).toMatch(/gentle and slow/);
    const practical = emotionBlock({ ...READ, intensity: 2, need: 'practical' } as any);
    expect(practical).not.toMatch(/Do NOT give solutions/);
    expect(practical).not.toMatch(/gentle and slow/);
    expect(emotionBlock(null)).toBe('');
  });
});
