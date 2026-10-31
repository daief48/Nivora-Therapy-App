import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelay, speechInstructions, speechRules, type RelayDeps, type ServerMsg } from '../modules/realtime/relayCore.js';
import { polishSpoken, shortenForSpeech } from '../services/spokenReply.js';
import { affectInstructions, createTtsClient, isSoftAffect, type Affect } from '../services/ttsClient.js';

// Voice that adapts to the person: affect-aware delivery, the affect / filler events, and calmer spoken endings. No network, no database.
const tick = () => new Promise((r) => setTimeout(r, 0));
const GRIEF: Affect = { emotion: 'grief', intensity: 5 };
const NEUTRAL: Affect = { emotion: 'calm', intensity: 1 };
const transcript = (t: string) => ({ type: 'conversation.item.input_audio_transcription.completed', transcript: t });

function setup(over: Partial<RelayDeps> = {}) {
  const out: ServerMsg[] = [];
  const upstream: any[] = [];
  const calls: { i: any; res: (t: string) => void }[] = [];
  const converse = vi.fn((i: any) => new Promise<string>((res) => { calls.push({ i, res }); }));
  const deps: RelayDeps = {
    send: (m) => out.push(m),
    authenticate: async (t) => (t === 'good' ? { userId: 'u1' } : null),
    openSession: async () => ({ language: 'en' }),
    connectUpstream: async () => ({ send: (e) => upstream.push(e), close: () => {} }),
    converse, crisis: async () => 'Your safety comes first. Please call your local emergency number.',
    ...over,
  };
  const relay = createRelay(deps);
  const hello = () => relay.onClient(JSON.stringify({ type: 'hello', token: 'good', sessionId: 's1' }));
  const of = (t: string) => out.filter((m) => m.type === t);
  const creates = () => upstream.filter((e) => e.type === 'response.create');
  return { relay, out, upstream, calls, hello, of, creates };
}

afterEach(() => { vi.useRealTimers(); });

describe('affectInstructions (TTS delivery)', () => {
  it('no affect or a light mood keeps the original warm, playful style', () => {
    const base = affectInstructions('en');
    expect(affectInstructions('en', undefined)).toBe(base);
    expect(affectInstructions('en', NEUTRAL)).toBe(base);
    expect(affectInstructions('en', { emotion: 'happy', intensity: 3 })).toBe(base);
    expect(base).toContain('cheerful young woman');
    expect(base).toContain('Speak clear, natural English.');
  });

  it('intensity >= 4 or a hurting feeling is softer, slower and not cheerful, yet keeps the persona and the language line', () => {
    const base = affectInstructions('bn');
    for (const a of [GRIEF, { emotion: 'calm', intensity: 4 as const }, { emotion: 'anxious', intensity: 2 as const }, { emotion: 'hopeless', intensity: 3 as const }, { emotion: 'ashamed', intensity: 2 as const }, { emotion: 'sad', intensity: 1 as const }]) {
      expect(isSoftAffect(a)).toBe(true);
      const soft = affectInstructions('bn', a);
      expect(soft).not.toBe(base);
      expect(soft).toMatch(/softer, slower, lower and calmer/);
      expect(soft).toMatch(/Not cheerful, not playful/);
      expect(soft).toContain('sweet, gentle young woman');
      expect(soft).toContain('Speak Bangla (Bengali) as a native speaker from Dhaka');
      expect(soft).toContain('Pronounce any English words in English.');
    }
  });

  it('every language has a soft variant', () => {
    for (const l of ['en', 'bn', 'hi', 'ne', 'mixed', 'auto'] as const) expect(affectInstructions(l, GRIEF)).not.toBe(affectInstructions(l));
  });

  it('createTtsClient sends the soft instructions for a hurting person and the default otherwise (old signal argument still works)', async () => {
    const bodies: any[] = [];
    const f = (async (_u: unknown, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(Buffer.alloc(1200), { status: 200 }); }) as any;
    const tts = createTtsClient({ apiKey: 'k', baseUrl: 'https://x', model: 'm', voice: 'v', timeoutMs: 5000 }, f);
    await tts.synthesize('I am here', 'en');
    await tts.synthesize('I am here', 'en', new AbortController().signal);
    await tts.synthesize('I am here', 'en', { affect: GRIEF });
    expect(bodies[0].instructions).toBe(affectInstructions('en'));
    expect(bodies[1].instructions).toBe(affectInstructions('en'));
    expect(bodies[2].instructions).toBe(affectInstructions('en', GRIEF));
  });
});

describe('relay speech rules by affect', () => {
  it('default is the original text; grief is softer', () => {
    expect(speechRules()).toContain('cute, sweet, cheerful young woman around 18 years old: light, slightly higher, playful');
    expect(speechRules()).toContain('pause only briefly at punctuation');
    expect(speechInstructions('Hi')).toBe(`${speechRules()}\n<<<TEXT\nHi\nTEXT>>>`);
    expect(speechRules(NEUTRAL)).toBe(speechRules());
    expect(speechRules(GRIEF)).not.toBe(speechRules());
    expect(speechRules(GRIEF)).toMatch(/softer, slower, lower and calmer/);
    expect(speechRules(GRIEF)).toContain('EXACTLY as written');
  });
});

describe('relay: affect event and delivery', () => {
  it('emits one affect event per reply, right before the first speech, and softens the instructions for grief vs neutral', async () => {
    for (const [a, soft] of [[GRIEF, true], [NEUTRAL, false]] as const) {
      const s = setup({ readAffect: async () => a });
      await s.hello();
      s.relay.onUpstream(transcript('my mother passed away last week'));
      await tick();
      s.calls[0]!.i.onDelta('I am so sorry. ');
      s.calls[0]!.i.onDelta('I am here with you. ');
      s.calls[0]!.res('I am so sorry. I am here with you. What would you like to say about her?');
      await tick(); await tick();
      const aff = s.of('affect');
      expect(aff).toEqual([{ type: 'affect', emotion: a.emotion, intensity: a.intensity }]);
      const firstCreate = s.out.findIndex((m) => m.type === 'state' && (m as any).state === 'speaking');
      expect(s.out.findIndex((m) => m.type === 'affect')).toBeLessThan(firstCreate);
      const ins = s.creates()[0].response.instructions as string;
      expect(/softer, slower, lower and calmer/.test(ins)).toBe(soft);
      expect(s.creates()[0].response.instructions).toContain(soft ? 'not cheerful, not playful' : 'cheerful young woman');
      s.relay.close();
    }
  });

  it('the first speech waits for the read only briefly and never blocks when the read fails or hangs', async () => {
    vi.useFakeTimers();
    const hang = setup({ readAffect: () => new Promise(() => {}), affectWaitMs: 700 });
    await hang.hello();
    hang.relay.onUpstream(transcript('how are you today my friend'));
    await vi.advanceTimersByTimeAsync(1);
    hang.calls[0]!.i.onDelta('Doing well. Thanks for asking. ');
    expect(hang.creates()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(hang.creates()).toHaveLength(1);
    expect(hang.of('affect')).toHaveLength(0); // unknown: no event, default voice
    expect(hang.creates()[0].response.instructions).toContain('cheerful young woman');

    const bad = setup({ readAffect: async () => { throw new Error('boom'); } });
    await bad.hello();
    bad.relay.onUpstream(transcript('how are you today my friend'));
    await vi.advanceTimersByTimeAsync(1);
    bad.calls[0]!.res('Doing well. Thanks for asking.');
    await vi.advanceTimersByTimeAsync(1);
    expect(bad.creates()).toHaveLength(1);
    expect(bad.of('affect')).toHaveLength(0);
  });

  it('without readAffect nothing changes: no affect event, original instructions', async () => {
    const s = setup();
    await s.hello();
    s.relay.onUpstream(transcript('how are you today my friend'));
    await tick();
    s.calls[0]!.res('Doing well. Thanks for asking.');
    await tick();
    expect(s.of('affect')).toHaveLength(0);
    expect(s.creates()[0].response.instructions).toBe(speechInstructions('Doing well. Thanks for asking.'));
  });

  it('a crisis reply is spoken softly and announces distress, without any model read', async () => {
    const readAffect = vi.fn(async () => NEUTRAL);
    const s = setup({ readAffect });
    await s.hello();
    s.relay.onUpstream(transcript('I want to kill myself tonight'));
    await tick(); await tick();
    expect(readAffect).not.toHaveBeenCalled();
    expect(s.of('affect')).toEqual([{ type: 'affect', emotion: 'distress', intensity: 5 }]);
    expect(s.creates()[0].response.instructions).toMatch(/softer, slower, lower and calmer/);
  });
});

describe('relay: thinking-gap filler', () => {
  const gapSetup = (affect: Affect | null, over: Partial<RelayDeps> = {}) =>
    setup({ fillerAfterMs: 1200, readAffect: async () => affect, ...over });

  it('sends one filler only after the threshold when the reply is still silent', async () => {
    vi.useFakeTimers();
    const s = gapSetup(NEUTRAL);
    await s.hello();
    s.relay.onUpstream(transcript('what do you think about my day'));
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.of('filler')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.of('filler')).toEqual([{ type: 'filler', kind: 'mm' }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.of('filler')).toHaveLength(1); // once per turn
  });

  it('is not sent when the reply starts speaking in time', async () => {
    vi.useFakeTimers();
    const s = gapSetup(NEUTRAL);
    await s.hello();
    s.relay.onUpstream(transcript('what do you think about my day'));
    await vi.advanceTimersByTimeAsync(500);
    s.calls[0]!.res('That sounds like a full day. Tell me more.');
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.of('filler')).toHaveLength(0);
  });

  it('is never sent for a high-intensity distress, or while the read is still unknown, or for a crisis', async () => {
    vi.useFakeTimers();
    const hurting = gapSetup(GRIEF);
    await hurting.hello();
    hurting.relay.onUpstream(transcript('my mother passed away last week'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(hurting.of('filler')).toHaveLength(0);

    const unknown = gapSetup(null, { readAffect: () => new Promise(() => {}) });
    await unknown.hello();
    unknown.relay.onUpstream(transcript('my mother passed away last week'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(unknown.of('filler')).toHaveLength(0);

    const crisis = gapSetup(NEUTRAL, { converse: () => new Promise(() => {}) });
    await crisis.hello();
    crisis.relay.onUpstream(transcript('I want to kill myself tonight'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(crisis.of('filler')).toHaveLength(0);
  });

  it('picks the kind: moderate feeling = listening, Bangla / Hindi / Nepali session = achha', async () => {
    vi.useFakeTimers();
    const mid = gapSetup({ emotion: 'worried', intensity: 3 });
    await mid.hello();
    mid.relay.onUpstream(transcript('I have an exam tomorrow and I am worried'));
    await vi.advanceTimersByTimeAsync(1300);
    expect(mid.of('filler')).toEqual([{ type: 'filler', kind: 'listening' }]);

    const bn = gapSetup(null, { readAffect: undefined, openSession: async () => ({ language: 'bn' }) });
    await bn.hello();
    bn.relay.onUpstream(transcript('আজকের দিনটা কেমন গেল আপনার'));
    await vi.advanceTimersByTimeAsync(1300);
    expect(bn.of('filler')).toEqual([{ type: 'filler', kind: 'achha' }]);
  });

  it('is off by default (fillerAfterMs unset) and a barge-in cancels the pending filler', async () => {
    vi.useFakeTimers();
    const off = setup();
    await off.hello();
    off.relay.onUpstream(transcript('what do you think about my day'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(off.of('filler')).toHaveLength(0);

    const s = gapSetup(NEUTRAL);
    await s.hello();
    s.relay.onUpstream(transcript('what do you think about my day'));
    await vi.advanceTimersByTimeAsync(500);
    s.relay.onClient(JSON.stringify({ type: 'interrupt' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.of('filler')).toHaveLength(0);
  });
});

describe('spoken-form polish', () => {
  it('never ends on a dangling conjunction or comma, and drops written-register openers', () => {
    expect(polishSpoken('That sounds really heavy, and')).toBe('That sounds really heavy.');
    expect(polishSpoken('I hear you. It makes sense to feel tired,')).toBe('I hear you. It makes sense to feel tired.');
    expect(polishSpoken('Furthermore, it is okay to rest. Moreover, you are not alone.')).toBe('It is okay to rest. You are not alone.');
    expect(polishSpoken('আমি শুনছি। আপনি ক্লান্ত এবং')).toBe('আমি শুনছি। আপনি ক্লান্ত।');
  });

  it('leaves ordinary text byte-identical and keeps the question when shortening', () => {
    const t = 'That sounds heavy.\nWhat part felt hardest?';
    expect(polishSpoken(t)).toBe(t);
    const long = 'I hear you. This is hard. It makes sense. Many people feel it. Would you like to talk about it?';
    const out = shortenForSpeech(long);
    expect(out.endsWith('Would you like to talk about it?')).toBe(true);
    expect(out.startsWith('I hear you.')).toBe(true);
  });
});
