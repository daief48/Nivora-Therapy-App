import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import {
  contentTokens, decodeMemory, enforceSessionMemoryCap, extractSessionMemories, factIsStorable, hasSecret, listMemories, packSessionMemory,
  rankRelevant, similarity, SESSION_MEMORY_CAP, SESSION_MEMORY_FLOOR,
} from '../services/memoryService.js';
import { config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const app = makeApp();
const facts = (...f: [string, string][]) => JSON.stringify({ facts: f.map(([kind, text]) => ({ kind, text })) });

async function setup(opts: { optedIn?: boolean; remember?: boolean; userMsgs?: number; prefs?: Record<string, unknown> } = {}) {
  const u = await register(app);
  if (opts.optedIn !== false) await db.userProfile.update({ where: { userId: u.userId }, data: { preferencesJson: { continuityOptIn: true, ...opts.prefs } } });
  const s = await db.therapySession.create({ data: { userId: u.userId, rememberThis: opts.remember ?? true } });
  const n = opts.userMsgs ?? 4;
  for (let i = 0; i < n * 2; i++) {
    await db.sessionMessage.create({ data: { sessionId: s.id, role: i % 2 ? 'assistant' : 'user', encryptedContent: cipher.encrypt(`message ${i}`) } });
  }
  return { u, s };
}
const rows = async (userId: string) => listMemories(db, cipher, userId, { source: 'SESSION' });

describe('text helpers', () => {
  it('normalises Latin, Bangla and Devanagari and drops stop words', () => {
    expect(contentTokens('My exam is on Friday')).toEqual(['exam', 'friday']);
    expect(contentTokens('আমার মায়ের পরীক্ষা')).toEqual(['মা', 'পরীক্ষা']);
    expect(contentTokens('मेरी माँ टीचर हैं')).toEqual(['मा', 'टीचर']);
    expect(contentTokens('आमाको')).toEqual(['आमा']);
  });
  it('similarity separates duplicates, updates and unrelated facts', () => {
    expect(similarity('My exam is on Friday', 'my exam is on friday!')).toBe(1);
    expect(similarity('My exam is on Friday', 'My exam is on Monday')).toBeGreaterThanOrEqual(0.5);
    expect(similarity('My mother works at a bank', 'My mother loves cooking')).toBeLessThan(0.5);
  });
  it('ranks only related items, with a recency boost', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 200 * 86_400_000);
    const items = [{ text: 'The QUOKKA argument with a friend', at: old }, { text: 'Sleep walk routine', at: now }, { text: 'QUOKKA photos', at: now }];
    const out = rankRelevant('tell me about the quokka', items, 5, now);
    expect(out.map((x) => x.text)).toEqual(['QUOKKA photos', 'The QUOKKA argument with a friend']);
    expect(rankRelevant('hello there', items, 5, now)).toEqual([]);
  });
  it('refuses to store secrets, crisis content or diagnoses', () => {
    expect(hasSecret('my password is hunter2')).toBe(true);
    expect(hasSecret('card 4111 1111 1111 1111')).toBe(true);
    expect(hasSecret('আমার পাসওয়ার্ড 1234')).toBe(true);
    expect(hasSecret('My sister Rima lives in Dhaka')).toBe(false);
    expect(factIsStorable('I want to kill myself tonight')).toBe(false);
    expect(factIsStorable('My sister Rima lives in Dhaka')).toBe(true);
  });
});

describe('extractSessionMemories', () => {
  it('stores encrypted SESSION facts with a kind, scrubs secrets and caps at 8', async () => {
    const { u, s } = await setup();
    const many = ['gardening roses', 'cycling hills', 'baking sourdough', 'painting landscapes', 'chess openings', 'fishing rivers', 'hiking mountains', 'singing choir', 'pottery wheel', 'sailing boats', 'knitting scarves', 'archery targets']
      .map((t) => ['FACT', t] as [string, string]);
    const glm = fakeGlm(facts(['PERSON', 'My sister Rima lives in Dhaka'], ['FACT', 'My password is hunter2'], ['FACT', 'Card number 4111111111111111'], ...many));
    expect(await extractSessionMemories({ db, glm, cipher }, s.id)).toBe(8);
    const list = await rows(u.userId);
    expect(list).toHaveLength(8);
    expect(list.some((m) => /hunter2|4111/.test(m.text))).toBe(false);
    expect(list.find((m) => m.text.includes('Rima'))).toMatchObject({ kind: 'PERSON', source: 'SESSION', sessionId: s.id, updated: false });
    const raw = await db.memory.findFirstOrThrow({ where: { userId: u.userId } });
    expect(raw.encryptedContent).not.toContain('Rima'); // encrypted at rest
    expect(raw.source).toBe('SESSION');
  });

  it('de-duplicates identical facts and updates contradicting ones (newest wins)', async () => {
    const { u, s } = await setup();
    await extractSessionMemories({ db, glm: fakeGlm(facts(['EVENT', 'My exam is on Friday'], ['PERSON', 'My mother works at a bank'])), cipher }, s.id);
    const s2 = await db.therapySession.create({ data: { userId: u.userId } });
    for (let i = 0; i < 6; i++) await db.sessionMessage.create({ data: { sessionId: s2.id, role: i % 2 ? 'assistant' : 'user', encryptedContent: cipher.encrypt(`m ${i}`) } });
    const glm = fakeGlm(facts(['EVENT', 'My exam is on Monday'], ['PERSON', 'my mother works at a bank.']));
    expect(await extractSessionMemories({ db, glm, cipher }, s2.id)).toBe(1); // the duplicate is skipped, the exam date is updated
    const list = await rows(u.userId);
    expect(list).toHaveLength(2);
    const exam = list.find((m) => m.kind === 'EVENT')!;
    expect(exam).toMatchObject({ text: 'My exam is on Monday', updated: true, sessionId: s2.id });
    expect(list.filter((m) => /Friday/.test(m.text))).toHaveLength(0);
  });

  it('does nothing without continuity, rememberThis, enough messages, after a crisis, or with memory switched off', async () => {
    const reply = facts(['PERSON', 'My sister Rima lives in Dhaka']);
    const cases: Awaited<ReturnType<typeof setup>>[] = [
      await setup({ optedIn: false }), await setup({ remember: false }), await setup({ userMsgs: 2 }), await setup({ prefs: { memoryEnabled: false } }),
    ];
    for (const c of cases) {
      const glm = fakeGlm(reply);
      expect(await extractSessionMemories({ db, glm, cipher }, c.s.id)).toBe(0);
      expect(glm.calls).toHaveLength(0);
      expect(await rows(c.u.userId)).toHaveLength(0);
    }
    const crisis = await setup();
    await db.safetyEvent.create({ data: { userId: crisis.u.userId, sessionId: crisis.s.id, severity: 'HIGH', actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
    const glm = fakeGlm(reply);
    expect(await extractSessionMemories({ db, glm, cipher }, crisis.s.id)).toBe(0);
    expect(glm.calls).toHaveLength(0);
  });

  it('fails safe on invalid output or model errors', async () => {
    const { u, s } = await setup();
    expect(await extractSessionMemories({ db, glm: fakeGlm('not json'), cipher }, s.id)).toBe(0);
    expect(await extractSessionMemories({ db, glm: fakeGlm(new Error('down')), cipher }, s.id)).toBe(0);
    expect(await extractSessionMemories({ db, glm: fakeGlm('{"facts":"x"}'), cipher }, s.id)).toBe(0);
    expect(await rows(u.userId)).toHaveLength(0);
  });
});

describe('session memory cap', () => {
  it(`merges the oldest facts into one life summary once more than ${SESSION_MEMORY_CAP} exist`, async () => {
    const u = await register(app);
    const base = Date.now() - 1_000_000;
    const n = SESSION_MEMORY_CAP + 5;
    await db.memory.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        userId: u.userId, source: 'SESSION', createdAt: new Date(base + i * 1000),
        encryptedContent: packSessionMemory(cipher, { t: `Factmarker${String(i).padStart(3, '0')} about something`, k: 'FACT' }),
      })),
    });
    const merged = await enforceSessionMemoryCap({ db, glm: fakeGlm(new Error('no model')), cipher }, u.userId);
    expect(merged).toBe(n - SESSION_MEMORY_FLOOR);
    const list = await rows(u.userId);
    expect(list.filter((m) => m.kind !== 'SUMMARY')).toHaveLength(SESSION_MEMORY_FLOOR);
    const summary = list.filter((m) => m.kind === 'SUMMARY');
    expect(summary).toHaveLength(1);
    expect(summary[0]!.text).toContain('Factmarker000');
    expect(summary[0]!.text).not.toContain(`Factmarker${String(n - 1).padStart(3, '0')}`);
    // a second run is a no-op
    expect(await enforceSessionMemoryCap({ db, glm: fakeGlm(new Error('no model')), cipher }, u.userId)).toBe(0);
  });
});

describe('decodeMemory', () => {
  it('reads plain USER rows and tolerates plain-text SESSION rows', async () => {
    const u = await register(app);
    const a = await db.memory.create({ data: { userId: u.userId, encryptedContent: cipher.encrypt('I like tea') } });
    const b = await db.memory.create({ data: { userId: u.userId, source: 'SESSION', encryptedContent: cipher.encrypt('legacy plain text') } });
    expect(decodeMemory(cipher, a)).toMatchObject({ text: 'I like tea', source: 'USER', kind: 'FACT' });
    expect(decodeMemory(cipher, b)).toMatchObject({ text: 'legacy plain text', source: 'SESSION', kind: 'FACT' });
  });
});
