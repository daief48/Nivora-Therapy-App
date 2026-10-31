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

describe('reply shape', () => {
  const q = 'That sounds heavy. What is the hardest part?';
  const s = 'That sounds heavy, carrying it alone.';
  const read = (o: object = {}) => ({ ...READ, intensity: 2, need: 'validate', ...o }) as any;

  it('never asks a question after two question endings in a row, and caps question share', async () => {
    const { pickReplyShape, endsWithQuestion } = await import('../services/emotionRead.js');
    expect(endsWithQuestion(q)).toBe(true);
    expect(endsWithQuestion(s)).toBe(false);
    expect(endsWithQuestion('আপনি কেমন আছেন?')).toBe(true);
    for (const need of ['listen', 'validate', 'comfort', 'unclear', 'practical', 'perspective']) {
      for (const recent of [[q, q], [s, q, q], [q, q, q], [q, s, q]]) {
        expect(pickReplyShape(read({ need }), recent), `${need}`).not.toBe('reflect_ask');
      }
    }
    expect(pickReplyShape(null, [q, q])).not.toBe('reflect_ask');
  });

  it('uses no pushing question at high intensity', async () => {
    const { pickReplyShape } = await import('../services/emotionRead.js');
    expect(pickReplyShape(read({ intensity: 5 }), [s])).toBe('ack');
    expect(pickReplyShape(read({ intensity: 4, need: 'practical' }), [s])).toBe('reflect');
    for (const need of ['listen', 'comfort', 'practical', 'unclear']) expect(['ack', 'reflect']).toContain(pickReplyShape(read({ intensity: 4, need }), []));
  });

  it('asks for practical needs when the last replies were not questions, works with a null read, and only connects with context', async () => {
    const { pickReplyShape } = await import('../services/emotionRead.js');
    expect(pickReplyShape(read({ need: 'practical' }), [s, s])).toBe('reflect_ask');
    expect(pickReplyShape(null, [s, s])).toBeTruthy();
    const seen = new Set<string>();
    for (let n = 0; n < 12; n++) seen.add(pickReplyShape(read(), ['x'.repeat(n + 1)], { hasContext: true }));
    expect(seen.has('connect')).toBe(true);
    for (let n = 0; n < 12; n++) expect(pickReplyShape(read(), ['x'.repeat(n + 1)])).not.toBe('connect');
    expect(['ack', 'invite']).toContain(pickReplyShape(read(), [s], { userText: 'ok thanks' }));
  });

  it('shapeBlock is private and instructs no question for ack / reflect / invite', async () => {
    const { shapeBlock } = await import('../services/emotionRead.js');
    expect(shapeBlock('ack')).toMatch(/^REPLY SHAPE \(private, never mention it\)/);
    for (const sh of ['ack', 'reflect', 'invite'] as const) expect(shapeBlock(sh)).toMatch(/No question|NOT end with a question|not a question/);
    expect(shapeBlock('reflect_ask')).toMatch(/ONE soft open question/);
  });
});
