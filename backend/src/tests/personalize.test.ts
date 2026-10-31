import { describe, expect, it } from 'vitest';
import { computeState, gapInDays, gapPhrase, localParts, partOfDayOf, type EngineSession } from '../services/sessionEngine.js';
import { buildSessionSystemPrompt, callbackCandidates, timeBlock, timeContextFrom } from '../services/sessionContext.js';
import { createCipher } from '../utils/crypto.js';
import { EMPTY_NOTE, type StoredNote } from '../services/therapyData.js';
import { config, db, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const app = makeApp();
const deps = { db, cipher, systemPrompt: 'BASE PROMPT' };
const t0 = new Date('2026-01-10T10:00:00Z');
const sitting = (o: Partial<EngineSession> = {}): EngineSession => ({
  phase: 'OPENING', lengthMin: 0, plannedMinutes: 30, startedAt: t0, isIntake: false, riskFlag: 'NONE', moodBefore: null, programId: 'p1', dayNumber: 3, ...o,
});

describe('time awareness (pure)', () => {
  it('part of day depends on the timezone', () => {
    const at = new Date('2026-01-10T20:30:00Z'); // 02:30 in Dhaka (+6), 20:30 UTC
    expect(partOfDayOf(localParts(at, 'Asia/Dhaka').hour)).toBe('late night');
    expect(partOfDayOf(localParts(at, 'UTC').hour)).toBe('evening');
    expect(partOfDayOf(localParts(new Date('2026-01-10T03:00:00Z'), 'Asia/Dhaka').hour)).toBe('morning');
    expect(partOfDayOf(localParts(new Date('2026-01-10T08:00:00Z'), 'Asia/Dhaka').hour)).toBe('afternoon');
    expect(partOfDayOf(localParts(at, 'Not/AZone').hour)).toBe('evening'); // falls back to UTC
  });
  it('gap counts local calendar days', () => {
    const prev = new Date('2026-01-10T18:30:00Z'); // 00:30 on the 11th in Dhaka
    const now = new Date('2026-01-11T06:00:00Z');
    expect(gapInDays(prev, now, 'UTC')).toBe(1);
    expect(gapInDays(prev, now, 'Asia/Dhaka')).toBe(0);
    expect(gapInDays(prev, new Date('2026-01-14T06:00:00Z'), 'UTC')).toBe(4);
  });
  it('gap wording', () => {
    expect(gapPhrase(null)).toMatch(/first sitting/);
    expect(gapPhrase(0)).toMatch(/earlier today/);
    expect(gapPhrase(1)).toMatch(/yesterday/);
    expect(gapPhrase(5)).toMatch(/5 days/);
  });
  it('time block is gentle, guilt-free and late-night aware', () => {
    const b = timeBlock(timeContextFrom(new Date('2026-01-10T20:30:00Z'), new Date('2026-01-05T10:00:00Z'), 'Asia/Dhaka'));
    expect(b).toMatch(/late night on a Sunday/);
    expect(b).toMatch(/gentle and short/);
    expect(b).toMatch(/NO guilt/);
    expect(b).toMatch(/Never mention streaks/);
  });
  it('opening step weaves rhythm; legacy and distress are unchanged', () => {
    const base = computeState(sitting({ programId: null, dayNumber: null }), 0, t0, {}).nextStep;
    expect(base).toMatch(/Invite a quick mood rating/);
    const r = computeState(sitting(), 0, t0, { program: { dayNumber: 3, plannedDays: 5 }, rhythm: { partOfDay: 'evening', gapDays: 4, hasCallback: true } }).nextStep;
    expect(r).toMatch(/evening/);
    expect(r).toMatch(/no guilt/);
    expect(r).toMatch(/callback/);
    expect(r).toMatch(/never as your first words/);
    const d = computeState(sitting(), 0, t0, { rhythm: { partOfDay: 'evening', gapDays: 4 }, lastUserText: 'I am panicking' }).nextStep;
    expect(d).toMatch(/SUPPORT/);
  });
  it('closing names the next sitting only when one is due', () => {
    const mid = computeState(sitting({ phase: 'CLOSING' }), 20, t0, { program: { dayNumber: 3, plannedDays: 5 } }).nextStep;
    expect(mid).toMatch(/next sitting is tomorrow/);
    const last = computeState(sitting({ phase: 'CLOSING', dayNumber: 5 }), 20, t0, { program: { dayNumber: 5, plannedDays: 5 } }).nextStep;
    expect(last).toMatch(/Do not promise or name another sitting/);
    expect(computeState(sitting({ phase: 'CLOSING', programId: null }), 20, t0, {}).nextStep).not.toMatch(/tomorrow/);
  });
});

describe('callback candidates (pure)', () => {
  const note = (o: Partial<StoredNote['content']>, riskFlag = 'NONE'): StoredNote => ({
    sessionId: 's', createdAt: t0, startedAt: t0, moodBefore: 4, moodAfter: 5, riskFlag, content: { ...EMPTY_NOTE, ...o },
  });
  it('picks at most 3, skips HIGH-risk sittings, dedupes', () => {
    const c = callbackCandidates([
      note({ unresolved: ['the talk with my brother'], keyInsights: ['I rush when I am scared'], themes: ['family'] }),
      note({ unresolved: ['the talk with my brother'], keyInsights: ['mornings are hardest'], themes: ['sleep'] }),
    ]);
    expect(c).toHaveLength(3);
    expect(c[0]).toBe('the talk with my brother');
    expect(callbackCandidates([note({ unresolved: ['crisis thing'] }, 'HIGH')])).toEqual([]);
    expect(callbackCandidates([])).toEqual([]);
  });
});

const optIn = (userId: string) => db.userProfile.update({ where: { userId }, data: { preferencesJson: { continuityOptIn: true } } });
async function mkProgram(userId: string, title: string) {
  return db.sessionProgram.create({ data: { userId, titleEncrypted: cipher.encrypt(title), plannedDays: 5, dailyMinutes: 30 } });
}
async function mkSitting(userId: string, programId: string | null, dayNumber: number | null, note: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const s = await db.therapySession.create({
    data: { userId, programId, dayNumber, plannedMinutes: 30, status: 'ENDED', endedAt: new Date(), finalizedAt: new Date(), startedAt: new Date(Date.now() - 3 * 86_400_000), ...extra },
  });
  await db.sessionNote.create({ data: { sessionId: s.id, userId, encryptedContent: cipher.encrypt(JSON.stringify({ ...EMPTY_NOTE, summary: 'sum', ...note })) } });
  return s;
}

describe('personalized context (DB)', () => {
  it('adds rhythm and callbacks from the same program only', async () => {
    const u = await register(app); await optIn(u.userId);
    await db.user.update({ where: { id: u.userId }, data: { timezone: 'Asia/Dhaka' } });
    const a = await mkProgram(u.userId, 'A'), b = await mkProgram(u.userId, 'B');
    await mkSitting(u.userId, a.id, 1, { unresolved: ['A-UNRESOLVED my sister'] });
    await mkSitting(u.userId, b.id, 1, { unresolved: ['B-UNRESOLVED exam'] });
    const cur = await db.therapySession.create({ data: { userId: u.userId, programId: a.id, dayNumber: 2, plannedMinutes: 30 } });
    const sys = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: cur.id, lang: 'en', userText: 'hi' });
    expect(sys).toMatch(/THEIR RHYTHM/);
    expect(sys).toMatch(/3 days since their previous sitting/);
    expect(sys).toMatch(/OPTIONAL CALLBACKS/);
    expect(sys).toMatch(/A-UNRESOLVED/);
    expect(sys).not.toMatch(/B-UNRESOLVED/);
  });

  it('no callbacks when rememberThis is false, continuity off, or the sitting was HIGH risk', async () => {
    const u = await register(app);
    const a = await mkProgram(u.userId, 'A');
    await mkSitting(u.userId, a.id, 1, { unresolved: ['SECRET-UNRESOLVED'] });
    const off = await db.therapySession.create({ data: { userId: u.userId, programId: a.id, dayNumber: 2, plannedMinutes: 30 } });
    const s0 = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: off.id, lang: 'en', userText: 'hi' });
    expect(s0).toMatch(/THEIR RHYTHM/); // timing is not session content
    expect(s0).not.toMatch(/SECRET-UNRESOLVED|OPTIONAL CALLBACKS/);
    await optIn(u.userId);
    const nr = await db.therapySession.create({ data: { userId: u.userId, programId: a.id, dayNumber: 2, plannedMinutes: 30, rememberThis: false } });
    const s1 = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: nr.id, lang: 'en', userText: 'hi' });
    expect(s1).not.toMatch(/SECRET-UNRESOLVED|OPTIONAL CALLBACKS/);

    const u2 = await register(app); await optIn(u2.userId);
    const p2 = await mkProgram(u2.userId, 'P');
    await mkSitting(u2.userId, p2.id, 1, { unresolved: ['CRISIS-UNRESOLVED'] }, { riskFlag: 'HIGH' });
    const c2 = await db.therapySession.create({ data: { userId: u2.userId, programId: p2.id, dayNumber: 2, plannedMinutes: 30 } });
    const s2 = await buildSessionSystemPrompt(deps, { userId: u2.userId, sessionId: c2.id, lang: 'en', userText: 'hi' });
    expect(s2).not.toMatch(/OPTIONAL CALLBACKS/);
  });

  it('legacy session context has no rhythm or callbacks', async () => {
    const u = await register(app); await optIn(u.userId);
    await mkSitting(u.userId, null, null, { unresolved: ['LEGACY-UNRESOLVED'] });
    const cur = await db.therapySession.create({ data: { userId: u.userId, lengthMin: 30, moodBefore: 5 } });
    const sys = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: cur.id, lang: 'en', userText: 'hi' });
    expect(sys).not.toMatch(/THEIR RHYTHM|OPTIONAL CALLBACKS/);
  });
});
