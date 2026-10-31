import { describe, expect, it } from 'vitest';
import { createCipher } from '../utils/crypto.js';
import { handleMemoryCommand, parseMemoryCommand, type CommandLang } from '../services/memoryCommands.js';
import { listMemories, packSessionMemory } from '../services/memoryService.js';
import { bumpTheme, EMPTY_NOTE } from '../services/therapyData.js';
import { config, db, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const app = makeApp();

describe('parseMemoryCommand', () => {
  const cases: [string, ReturnType<typeof parseMemoryCommand>][] = [
    // English
    ['forget that', { type: 'FORGET_LAST' }],
    ['Hey, forget that please.', { type: 'FORGET_LAST' }],
    ["don't remember this", { type: 'FORGET_SESSION' }],
    ['forget this session', { type: 'FORGET_SESSION' }],
    ['forget what I said about my mother', { type: 'FORGET_ABOUT', topic: 'my mother' }],
    ['Remember that my exam is on Friday', { type: 'REMEMBER', fact: 'my exam is on Friday' }],
    ["that's wrong, it was my uncle not my father", { type: 'CORRECT', oldText: 'father', newText: 'uncle' }],
    ['what do you remember about me?', { type: 'LIST' }],
    // Bangla
    ['এটা মনে রেখো না', { type: 'FORGET_SESSION' }],
    ['এটা ভুলে যাও', { type: 'FORGET_LAST' }],
    ['আমার মা সম্পর্কে যা বলেছি ভুলে যাও', { type: 'FORGET_ABOUT', topic: 'আমার মা' }],
    ['মনে রেখো আমার পরীক্ষা শুক্রবার', { type: 'REMEMBER', fact: 'আমার পরীক্ষা শুক্রবার' }],
    ['ভুল, ওটা আমার বাবা না, আমার কাকা ছিল', { type: 'CORRECT', oldText: 'বাবা', newText: 'কাকা' }],
    ['তুমি আমার সম্পর্কে কী মনে রেখেছ?', { type: 'LIST' }],
    // Hindi
    ['इसे याद मत रखो', { type: 'FORGET_SESSION' }],
    ['इसे भूल जाओ', { type: 'FORGET_LAST' }],
    ['मेरी माँ के बारे में जो कहा भूल जाओ', { type: 'FORGET_ABOUT', topic: 'मेरी माँ' }],
    ['याद रखना कि मेरी परीक्षा शुक्रवार को है', { type: 'REMEMBER', fact: 'मेरी परीक्षा शुक्रवार को है' }],
    ['गलत है, वो पापा नहीं चाचा थे', { type: 'CORRECT', oldText: 'पापा', newText: 'चाचा' }],
    ['तुम मेरे बारे में क्या याद रखते हो?', { type: 'LIST' }],
    // Nepali
    ['यो याद नगर्नु', { type: 'FORGET_SESSION' }],
    ['यो बिर्सिदेऊ', { type: 'FORGET_LAST' }],
    ['आमाको बारेमा मैले भनेको बिर्सिदेऊ', { type: 'FORGET_ABOUT', topic: 'आमा' }],
    ['याद राख्नु मेरो परीक्षा शुक्रबार छ', { type: 'REMEMBER', fact: 'मेरो परीक्षा शुक्रबार छ' }],
    ['गलत हो, बुवा होइन काका हो', { type: 'CORRECT', oldText: 'बुवा', newText: 'काका' }],
    ['तिमीले मेरो बारेमा के याद राखेका छौ?', { type: 'LIST' }],
  ];
  for (const [text, want] of cases) it(`parses "${text}"`, () => expect(parseMemoryCommand(text)).toEqual(want));

  it('never treats ambiguous or ordinary text as a command', () => {
    for (const t of [
      'forget it', 'forget about it', 'I always forget things', 'I forget what I said', 'remember to call mum', 'remember when we talked about school',
      'do you remember my name?', 'it was my uncle not my father', 'I am so tired today', 'notebook is on the table', 'remember me', 'Remember that?',
      'actually I am not that tired', '', 'x'.repeat(500), 'আমি ভুলে গেছি', 'मैं भूल गया', 'আজ খুব ক্লান্ত লাগছে',
    ]) expect(parseMemoryCommand(t), t).toBeNull();
  });
});

async function world(opts: { remember?: boolean; prefs?: Record<string, unknown> } = {}) {
  const u = await register(app);
  if (opts.prefs) await db.userProfile.update({ where: { userId: u.userId }, data: { preferencesJson: opts.prefs as any } });
  const s = await db.therapySession.create({ data: { userId: u.userId, rememberThis: opts.remember ?? true } });
  const say = (text: string, lang: CommandLang = 'en', sessionId = s.id) => handleMemoryCommand({ db, cipher }, { userId: u.userId, sessionId, text, lang });
  const userMem = (text: string) => db.memory.create({ data: { userId: u.userId, encryptedContent: cipher.encrypt(text) } });
  const sessMem = (text: string, k = 'FACT', sid?: string) =>
    db.memory.create({ data: { userId: u.userId, source: 'SESSION', encryptedContent: packSessionMemory(cipher, { t: text, k: k as any, ...(sid ? { s: sid } : {}) }) } });
  const texts = async () => (await listMemories(db, cipher, u.userId)).map((m) => m.text).sort();
  return { u, s, say, userMem, sessMem, texts };
}

describe('handleMemoryCommand: forgetting', () => {
  const langs: [CommandLang, string, string, string, string][] = [
    ['en', 'My mother is a teacher', 'forget what I said about my mother', 'My dog is called Rex', 'Mother'],
    ['bn', 'আমার মা শিক্ষক', 'আমার মা সম্পর্কে যা বলেছি ভুলে যাও', 'আমার কুকুরের নাম রেক্স', 'মা'],
    ['hi', 'मेरी माँ टीचर हैं', 'मेरी माँ के बारे में जो कहा भूल जाओ', 'मेरे कुत्ते का नाम रेक्स है', 'माँ'],
    ['ne', 'मेरो आमा शिक्षक हुनुहुन्छ', 'आमाको बारेमा मैले भनेको बिर्सिदेऊ', 'मेरो कुकुरको नाम रेक्स हो', 'आमा'],
  ];
  for (const [lang, mem, cmd, other] of langs) {
    it(`${lang}: removes matching USER and SESSION memories, keeps the rest, replies in the language`, async () => {
      const w = await world();
      await w.userMem(mem);
      await w.sessMem(mem + ' (again)');
      await w.sessMem(other);
      const r = await w.say(cmd, lang);
      expect(r.handled).toBe(true);
      expect(r.reply!.length).toBeGreaterThan(10);
      expect(await w.texts()).toEqual([other]);
      if (lang !== 'en') expect(r.reply).toMatch(lang === 'bn' ? /[ঀ-৿]/ : /[ऀ-ॿ]/);
    });
  }

  it('is handled even when nothing matches, and never touches another user', async () => {
    const a = await world(), b = await world();
    await b.userMem('My mother is a teacher');
    const r = await a.say('forget what I said about my mother');
    expect(r).toMatchObject({ handled: true });
    expect(await b.texts()).toEqual(['My mother is a teacher']);
  });

  it('rewrites notes without the topic sentences, and drops matching homework and themes', async () => {
    const w = await world();
    const old = await db.therapySession.create({ data: { userId: w.u.userId, status: 'ENDED', finalizedAt: new Date() } });
    await db.sessionNote.create({
      data: {
        sessionId: old.id, userId: w.u.userId,
        encryptedContent: cipher.encrypt(JSON.stringify({ ...EMPTY_NOTE, summary: 'We talked about my mother. We also planned study time.', unresolved: ['mother visit'], themes: ['exams'] })),
      },
    });
    await db.homework.create({ data: { userId: w.u.userId, titleEncrypted: cipher.encrypt('Call mother') } });
    await bumpTheme(db, cipher, w.u.userId, 'mother');
    await w.say('forget what I said about my mother');
    const note = JSON.parse(cipher.decrypt((await db.sessionNote.findFirstOrThrow({ where: { sessionId: old.id } })).encryptedContent));
    expect(note.summary).toBe('We also planned study time.');
    expect(note.unresolved).toEqual([]);
    expect(note.themes).toEqual(['exams']);
    expect(await db.homework.count({ where: { userId: w.u.userId } })).toBe(0);
    expect(await db.themeTracker.count({ where: { userId: w.u.userId } })).toBe(0);
  });

  it('"forget that" drops the previous user message and a matching memory', async () => {
    const w = await world();
    await db.sessionMessage.create({ data: { sessionId: w.s.id, role: 'user', encryptedContent: cipher.encrypt('My brother Karim moved to Sylhet') } });
    await w.userMem('My brother Karim moved to Sylhet');
    await w.userMem('I like tea');
    const r = await w.say('forget that');
    expect(r.handled).toBe(true);
    expect(await db.sessionMessage.count({ where: { sessionId: w.s.id } })).toBe(0);
    expect(await w.texts()).toEqual(['I like tea']);
  });

  it('"don\'t remember this" switches the session to private and retracts its contribution', async () => {
    const w = await world();
    await db.userProfile.update({ where: { userId: w.u.userId }, data: { preferencesJson: { continuityOptIn: true } } });
    await db.sessionNote.create({ data: { sessionId: w.s.id, userId: w.u.userId, encryptedContent: cipher.encrypt(JSON.stringify({ ...EMPTY_NOTE, summary: 'x', themes: ['sleep'] })) } });
    await db.homework.create({ data: { userId: w.u.userId, sessionId: w.s.id, titleEncrypted: cipher.encrypt('walk') } });
    await bumpTheme(db, cipher, w.u.userId, 'sleep');
    await bumpTheme(db, cipher, w.u.userId, 'sleep');
    await w.sessMem('From this session', 'FACT', w.s.id);
    await w.sessMem('From another session', 'FACT', '00000000-0000-4000-8000-000000000000');
    await w.userMem('Mine');
    const r = await w.say("don't remember this");
    expect(r.handled).toBe(true);
    expect((await db.therapySession.findUniqueOrThrow({ where: { id: w.s.id } })).rememberThis).toBe(false);
    expect(await db.sessionNote.count({ where: { sessionId: w.s.id } })).toBe(0);
    expect(await db.homework.count({ where: { sessionId: w.s.id } })).toBe(0);
    expect((await db.themeTracker.findFirstOrThrow({ where: { userId: w.u.userId } })).count).toBe(1);
    expect(await w.texts()).toEqual(['From another session', 'Mine']);
  });
});

describe('handleMemoryCommand: remembering', () => {
  const cases: [CommandLang, string, string][] = [
    ['en', 'remember that my exam is on Friday', 'my exam is on Friday'],
    ['bn', 'মনে রেখো আমার পরীক্ষা শুক্রবার', 'আমার পরীক্ষা শুক্রবার'],
    ['hi', 'याद रखना कि मेरी परीक्षा शुक्रवार को है', 'मेरी परीक्षा शुक्रवार को है'],
    ['ne', 'याद राख्नु मेरो परीक्षा शुक्रबार छ', 'मेरो परीक्षा शुक्रबार छ'],
  ];
  for (const [lang, cmd, fact] of cases) {
    it(`${lang}: adds a USER memory`, async () => {
      const w = await world();
      const r = await w.say(cmd, lang);
      expect(r.handled).toBe(true);
      const list = await listMemories(db, cipher, w.u.userId);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ text: fact, source: 'USER' });
    });
  }

  it('updates a similar memory instead of piling up, and replaces older session-derived versions', async () => {
    const w = await world();
    await w.userMem('My exam is on Friday');
    await w.sessMem('My exam is on Thursday', 'EVENT');
    await w.say('remember that my exam is on Monday');
    expect(await w.texts()).toEqual(['my exam is on Monday']);
  });

  it('refuses secrets, crisis text, private sessions, switched-off memory and a full memory', async () => {
    const w = await world();
    expect((await w.say('remember that my password is hunter2')).handled).toBe(true);
    expect((await w.say('remember that I want to kill myself')).handled).toBe(false);
    expect(await w.texts()).toEqual([]);
    const priv = await world({ remember: false });
    expect((await priv.say('remember that my exam is on Friday')).handled).toBe(true);
    expect(await priv.texts()).toEqual([]);
    const off = await world({ prefs: { memoryEnabled: false } });
    expect((await off.say('remember that my exam is on Friday')).handled).toBe(true);
    expect(await off.texts()).toEqual([]);
    const full = await world();
    await db.memory.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ userId: full.u.userId, encryptedContent: cipher.encrypt(`Filler ${i} unique${i}x`) })) });
    expect((await full.say('remember that my cat is called Miu')).handled).toBe(true);
    expect(await db.memory.count({ where: { userId: full.u.userId } })).toBe(50);
  });
});

describe('handleMemoryCommand: correcting', () => {
  const cases: [CommandLang, string, string, string][] = [
    ['en', 'My father works abroad', "that's wrong, it was my uncle not my father", 'My uncle works abroad'],
    ['bn', 'আমার বাবা বিদেশে থাকেন', 'ভুল, ওটা আমার বাবা না, আমার কাকা ছিল', 'আমার কাকা বিদেশে থাকেন'],
    ['hi', 'मेरे पापा दुबई में हैं', 'गलत है, वो पापा नहीं चाचा थे', 'मेरे चाचा दुबई में हैं'],
    ['ne', 'मेरो बुवा काम गर्नुहुन्छ', 'गलत हो, बुवा होइन काका हो', 'मेरो काका काम गर्नुहुन्छ'],
  ];
  for (const [lang, stored, cmd, fixed] of cases) {
    it(`${lang}: supersedes the stored wording`, async () => {
      const w = await world();
      await w.sessMem(stored, 'PERSON');
      const r = await w.say(cmd, lang);
      expect(r.handled).toBe(true);
      expect(await w.texts()).toEqual([fixed]);
      const [m] = await listMemories(db, cipher, w.u.userId);
      expect(m).toMatchObject({ source: 'SESSION', kind: 'PERSON', updated: true });
    });
  }
  it('is not handled when nothing stored matches (it is an ordinary correction for the model)', async () => {
    const w = await world();
    await w.userMem('I like tea');
    expect((await w.say("that's wrong, it was my uncle not my father")).handled).toBe(false);
    expect(await w.texts()).toEqual(['I like tea']);
  });
});

describe('handleMemoryCommand: listing and guards', () => {
  it('summarises briefly instead of reciting everything', async () => {
    const w = await world();
    for (const t of ['Fact alpha one', 'Fact bravo two', 'Fact charlie three', 'Fact delta four', 'Fact echo five']) await w.sessMem(t);
    await w.sessMem('Life so far: a student in Dhaka', 'SUMMARY');
    const r = await w.say('what do you remember about me?');
    expect(r.handled).toBe(true);
    expect(r.reply).toContain('student in Dhaka');
    const shown = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].filter((x) => r.reply!.includes(x));
    expect(shown).toHaveLength(3);
    expect(r.reply).toMatch(/2 more/);
  });
  it('answers honestly when nothing is saved or memory is off, in the user language', async () => {
    const w = await world();
    expect((await w.say('what do you remember about me?')).reply).toMatch(/haven't saved anything/);
    expect((await w.say('তুমি আমার সম্পর্কে কী মনে রেখেছ?', 'bn')).reply).toMatch(/[ঀ-৿]/);
    const off = await world({ prefs: { memoryEnabled: false } });
    expect((await off.say('what do you remember about me?')).reply).toMatch(/switched off/);
  });
  it('does nothing for ordinary text, other people\'s sessions or unknown sessions', async () => {
    const a = await world(), b = await world();
    await a.userMem('I like tea');
    expect((await a.say('I am a bit tired today')).handled).toBe(false);
    expect((await a.say('forget it')).handled).toBe(false);
    expect((await a.say('forget that', 'en', b.s.id)).handled).toBe(false); // not their session
    expect(await a.texts()).toEqual(['I like tea']);
  });
});

describe('memory commands: natural phrasings found in live testing', () => {
  it('handles a leading filler word and "forget my X" without "about"', async () => {
    const { parseMemoryCommand } = await import('../services/memoryCommands.js');
    expect(parseMemoryCommand('Actually please forget what I said about my brother.')).toEqual({ type: 'FORGET_ABOUT', topic: 'my brother' });
    expect(parseMemoryCommand('please forget my brother')).toEqual({ type: 'FORGET_ABOUT', topic: 'my brother' });
    expect(parseMemoryCommand('Oh, and forget about my mother')).toEqual({ type: 'FORGET_ABOUT', topic: 'my mother' });
    expect(parseMemoryCommand('I forgot my brother')).toBeNull(); // ordinary sentences are never treated as commands
  });
});

describe('memory commands: forgetting a person also forgets facts that only name them', () => {
  it('"forget my brother" removes "Karim ..." too, but not unrelated facts', async () => {
    const { db, makeApp, register } = await import('./helpers.js');
    const { createCipher } = await import('../utils/crypto.js');
    const { loadEnv } = await import('../config/env.js');
    const { handleMemoryCommand } = await import('../services/memoryCommands.js');
    const { packSessionMemory } = await import('../services/memoryService.js');
    const cipher = createCipher(loadEnv().DATA_ENCRYPTION_KEYS);
    const u = await register(makeApp());
    const s = await db.therapySession.create({ data: { userId: u.userId, sessionType: 'TEXT', language: 'en' } });
    for (const text of ["The user's older brother is named Karim.", 'Karim often compares the user to himself, which hurts.', "The user's mother is not well these days."]) {
      await db.memory.create({ data: { userId: u.userId, source: 'SESSION', encryptedContent: packSessionMemory(cipher, { t: text, k: 'FACT', s: s.id }) } });
    }
    const r = await handleMemoryCommand({ db, cipher } as any, { userId: u.userId, sessionId: s.id, text: 'please forget my brother', lang: 'en' });
    expect(r.handled).toBe(true);
    const left = await db.memory.findMany({ where: { userId: u.userId } });
    const texts = left.map((m) => cipher.decrypt(m.encryptedContent));
    expect(texts.some((x) => /Karim/.test(x))).toBe(false);
    expect(texts.some((x) => /mother/.test(x))).toBe(true);
  });
});
