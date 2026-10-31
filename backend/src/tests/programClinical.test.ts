import { describe, expect, it } from 'vitest';
import { computeState, maybeBuildPlanFromIntake, timeBoxOf, type EngineSession } from '../services/sessionEngine.js';
import { buildSessionSystemPrompt } from '../services/sessionContext.js';
import { finalizeSession, noteSchema } from '../services/sessionSummarizer.js';
import { createCipher } from '../utils/crypto.js';
import { EMPTY_NOTE, getActivePlan } from '../services/therapyData.js';
import { config, db, fakeGlm, makeApp, register } from './helpers.js';

const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const app = makeApp();
const t0 = new Date('2026-01-01T10:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const sitting = (o: Partial<EngineSession> = {}): EngineSession => ({
  phase: 'OPENING', lengthMin: 0, plannedMinutes: 30, startedAt: t0, isIntake: false, riskFlag: 'NONE', moodBefore: 5, programId: 'p1', dayNumber: 3, ...o,
});
const optIn = (userId: string) => db.userProfile.update({ where: { userId }, data: { preferencesJson: { continuityOptIn: true } } });

describe('program-aware phase engine (pure)', () => {
  it('uses plannedMinutes as the time box and lengthMin for legacy sessions', () => {
    expect(timeBoxOf({ lengthMin: 15, plannedMinutes: 40 })).toBe(40);
    expect(timeBoxOf({ lengthMin: 15, plannedMinutes: 0 })).toBe(15);
    expect(timeBoxOf({ lengthMin: 15 })).toBe(15);
    expect(computeState(sitting({ phase: 'CORE' }), 10, at(10)).remainingMin).toBe(20);
    expect(computeState(sitting({ phase: 'CORE' }), 10, at(25)).phase).toBe('SUMMARY');
  });

  it('Day 1 and Day 2 intake have different steps; legacy intake is unchanged', () => {
    const d1 = computeState(sitting({ isIntake: true, dayNumber: 1 }), 0, at(0)).nextStep;
    const d2 = computeState(sitting({ isIntake: true, dayNumber: 2 }), 0, at(0)).nextStep;
    const legacy = computeState({ phase: 'OPENING', lengthMin: 30, startedAt: t0, isIntake: true, riskFlag: 'NONE' }, 0, at(0)).nextStep;
    expect(d1).toMatch(/INTAKE DAY 1 WELCOME/);
    expect(d1).toMatch(/not a therapist/i);
    expect(d1).toMatch(/confidentiality/i);
    expect(d2).toMatch(/INTAKE DAY 2 WELCOME BACK/);
    expect(computeState(sitting({ isIntake: true, dayNumber: 1, phase: 'AGENDA' }), 4, at(3)).nextStep).toMatch(/PRESENTING PROBLEM/);
    expect(computeState(sitting({ isIntake: true, dayNumber: 1, phase: 'CORE' }), 6, at(5)).nextStep).toMatch(/SAFETY/);
    expect(computeState(sitting({ isIntake: true, dayNumber: 2, phase: 'AGENDA' }), 4, at(3)).nextStep).toMatch(/PERSONAL HISTORY/);
    expect(computeState(sitting({ isIntake: true, dayNumber: 2, phase: 'CORE' }), 6, at(5)).nextStep).toMatch(/FORMULATION AND PLAN/);
    expect(legacy).toMatch(/INTAKE WELCOME/);
    expect(legacy).not.toMatch(/DAY 1/);
  });

  it('regular sitting: Day N of M, review callback, one technique, feedback in summary', () => {
    const opts = { program: { dayNumber: 4, plannedDays: 10 } };
    expect(computeState(sitting({ dayNumber: 4 }), 0, at(0), opts).nextStep).toMatch(/Day 4 of 10/);
    expect(computeState(sitting({ dayNumber: 4, phase: 'AGENDA' }), 4, at(3), opts).nextStep).toMatch(/AGENDA/);
    const core = computeState(sitting({ dayNumber: 4, phase: 'CORE' }), 8, at(5), { ...opts, approach: 'CBT' }).nextStep;
    expect(core).toMatch(/at most ONE technique/);
    expect(core).toMatch(/thought check/);
    expect(core).toMatch(/behavioural activation/);
    expect(core).toMatch(/grounding/);
    expect(core).toMatch(/Never diagnose/);
    const sum = computeState(sitting({ dayNumber: 4, phase: 'CORE' }), 10, at(25), opts).nextStep;
    expect(sum).toMatch(/feedback/);
    expect(sum).not.toMatch(/FINAL sitting/);
    const last = computeState(sitting({ dayNumber: 10, phase: 'CORE' }), 10, at(25), { program: { dayNumber: 10, plannedDays: 10 } }).nextStep;
    expect(last).toMatch(/FINAL sitting/);
  });

  it('keeps the periodic progress review', () => {
    expect(computeState(sitting(), 0, at(0), { finalizedCount: 6 }).nextStep).toMatch(/progress check/);
    expect(computeState(sitting(), 0, at(0), { finalizedCount: 5 }).nextStep).not.toMatch(/progress check/);
  });

  it('distress overrides the time box: never rushed to the exit', () => {
    const s = computeState(sitting({ phase: 'HOMEWORK' }), 20, at(45), { lastUserText: 'I am panicking and cannot cope' });
    expect(s.phase).toBe('CORE');
    expect(s.distressed).toBe(true);
    expect(s.nextStep).toMatch(/SUPPORT/);
    const hi = computeState(sitting({ phase: 'CLOSING', riskFlag: 'HIGH', isIntake: true, dayNumber: 1 }), 20, at(45));
    expect(hi.phase).toBe('CORE');
    expect(hi.nextStep).toMatch(/SUPPORT/);
  });
});

async function mkProgram(userId: string, title: string, plannedDays = 5, goal: string | null = null) {
  return db.sessionProgram.create({
    data: { userId, titleEncrypted: cipher.encrypt(title), goalEncrypted: goal ? cipher.encrypt(goal) : null, plannedDays, dailyMinutes: 30 },
  });
}
async function mkSitting(userId: string, programId: string | null, dayNumber: number | null, summary: string, extra: Record<string, unknown> = {}) {
  const s = await db.therapySession.create({
    data: { userId, programId, dayNumber, plannedMinutes: 30, status: 'ENDED', endedAt: new Date(), finalizedAt: new Date(), moodBefore: 4, moodAfter: 6, ...extra },
  });
  await db.sessionNote.create({ data: { sessionId: s.id, userId, encryptedContent: cipher.encrypt(JSON.stringify({ ...EMPTY_NOTE, summary })) } });
  return s;
}
const deps = { db, cipher, systemPrompt: 'BASE PROMPT' };

describe('program context (DB)', () => {
  it('adds program goal, Day N of M, last 2 notes and open homework of the SAME program only', async () => {
    const u = await register(app); await optIn(u.userId);
    const a = await mkProgram(u.userId, 'Sleep program', 7, 'Fall asleep before midnight');
    const b = await mkProgram(u.userId, 'Exam program', 7, 'Stay calm before exams');
    await mkSitting(u.userId, a.id, 1, 'A-ONE talked about bedtime phone use');
    await mkSitting(u.userId, a.id, 2, 'A-TWO tried a wind-down routine');
    const a3 = await mkSitting(u.userId, a.id, 3, 'A-THREE reviewed the routine');
    await mkSitting(u.userId, b.id, 1, 'B-ONE PHYSICS exam panic');
    const legacy = await mkSitting(u.userId, null, null, 'LEGACY-NOTE about my dog');
    await db.homework.create({ data: { userId: u.userId, sessionId: a3.id, titleEncrypted: cipher.encrypt('A-HOMEWORK no phone in bed'), status: 'ASSIGNED' } });
    await db.homework.create({ data: { userId: u.userId, sessionId: legacy.id, titleEncrypted: cipher.encrypt('LEGACY-HOMEWORK'), status: 'ASSIGNED' } });
    await db.homework.create({ data: { userId: u.userId, titleEncrypted: cipher.encrypt('B-HOMEWORK breathe'), sessionId: (await mkSitting(u.userId, b.id, 2, 'B-TWO')).id, status: 'ASSIGNED' } });

    const cur = await db.therapySession.create({ data: { userId: u.userId, programId: a.id, dayNumber: 4, plannedMinutes: 30, moodBefore: 5 } });
    const sys = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: cur.id, lang: 'en', userText: 'hello' });
    expect(sys).toMatch(/Day 4 of 7/);
    expect(sys).toMatch(/Fall asleep before midnight/);
    expect(sys).toMatch(/A-THREE/);
    expect(sys).toMatch(/A-TWO/);
    expect(sys).not.toMatch(/A-ONE/); // only the last 2 notes
    expect(sys).toMatch(/A-HOMEWORK/);
    expect(sys).not.toMatch(/B-ONE|B-TWO|PHYSICS|B-HOMEWORK|Stay calm|LEGACY/);

    const curB = await db.therapySession.create({ data: { userId: u.userId, programId: b.id, dayNumber: 3, plannedMinutes: 40, moodBefore: 5 } });
    const sysB = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: curB.id, lang: 'en', userText: 'hello' });
    expect(sysB).toMatch(/Day 3 of 7/);
    expect(sysB).toMatch(/B-HOMEWORK/);
    expect(sysB).not.toMatch(/A-ONE|A-TWO|A-THREE|A-HOMEWORK|Fall asleep|LEGACY/);
  });

  it('respects continuity opt-out and rememberThis=false (no earlier-sitting material)', async () => {
    const u = await register(app);
    const a = await mkProgram(u.userId, 'P', 5, 'my goal');
    await mkSitting(u.userId, a.id, 1, 'SECRET-EARLIER');
    const cur = await db.therapySession.create({ data: { userId: u.userId, programId: a.id, dayNumber: 2, plannedMinutes: 30 } });
    const off = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: cur.id, lang: 'en', userText: 'hi' });
    expect(off).toMatch(/Day 2 of 5/);
    expect(off).not.toMatch(/SECRET-EARLIER/);
    await optIn(u.userId);
    const nr = await db.therapySession.create({ data: { userId: u.userId, programId: a.id, dayNumber: 2, plannedMinutes: 30, rememberThis: false } });
    const sys = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: nr.id, lang: 'en', userText: 'hi' });
    expect(sys).not.toMatch(/SECRET-EARLIER/);
  });

  it('legacy session (programId null) prompt has no program block', async () => {
    const u = await register(app); await optIn(u.userId);
    await mkSitting(u.userId, null, null, 'LEGACY-NOTE about my dog');
    const cur = await db.therapySession.create({ data: { userId: u.userId, lengthMin: 30, moodBefore: 5 } });
    const sys = await buildSessionSystemPrompt(deps, { userId: u.userId, sessionId: cur.id, lang: 'en', userText: 'hi' });
    expect(sys).not.toMatch(/PROGRAM:/);
    expect(sys).toMatch(/LEGACY-NOTE/);
    expect(sys).toMatch(/SESSION PHASE \(OPENING\)/);
  });
});

const PLAN_JSON = JSON.stringify({ goals: [{ id: 'g1', title: 'Sleep earlier' }], approach: 'CBT', pace: 'GENTLE', tone: 'WARM', language: 'en' });
async function say(sessionId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.sessionMessage.create({ data: { sessionId, role: 'user', encryptedContent: cipher.encrypt(`user line ${i}`) } });
    await db.sessionMessage.create({ data: { sessionId, role: 'assistant', encryptedContent: cipher.encrypt(`reply ${i}`) } });
  }
}

describe('intake plan across two sittings', () => {
  it('Day 1 alone builds no plan; Day 2 builds one (idempotent)', async () => {
    const u = await register(app); await optIn(u.userId);
    const p = await mkProgram(u.userId, 'Intake program', 5);
    const d1 = await db.therapySession.create({ data: { userId: u.userId, programId: p.id, dayNumber: 1, isIntake: true, plannedMinutes: 30 } });
    await say(d1.id, 4);
    const glm = fakeGlm(PLAN_JSON);
    expect(await maybeBuildPlanFromIntake({ db, glm, cipher }, d1.id)).toBe(false);
    expect(glm.calls).toHaveLength(0);
    expect(await getActivePlan(db, cipher, u.userId)).toBeNull();

    const d2 = await db.therapySession.create({ data: { userId: u.userId, programId: p.id, dayNumber: 2, isIntake: true, plannedMinutes: 30 } });
    await say(d2.id, 4);
    expect(await maybeBuildPlanFromIntake({ db, glm, cipher }, d2.id)).toBe(true);
    expect(glm.calls[0]![1]!.content).toMatch(/next sitting/); // Day 1 conversation was included
    expect((await getActivePlan(db, cipher, u.userId))?.plan.goals[0]?.title).toBe('Sleep earlier');
    expect(await maybeBuildPlanFromIntake({ db, glm, cipher }, d2.id)).toBe(false);
  });
});

describe('final review note', () => {
  const NOTE = JSON.stringify({ summary: 'Wrapped up the program.', progressNote: 'You moved towards your goal.', themes: ['sleep'] });
  async function run(dayNumber: number, plannedDays: number) {
    const u = await register(app); await optIn(u.userId); // notes are only recalled when continuity is on
    const p = await mkProgram(u.userId, 'P', plannedDays, 'Sleep before midnight');
    await mkSitting(u.userId, p.id, 1, 'EARLY-SITTING-SUMMARY');
    const s = await db.therapySession.create({ data: { userId: u.userId, programId: p.id, dayNumber, plannedMinutes: 30 } });
    await say(s.id, 2);
    const glm = fakeGlm(NOTE);
    await finalizeSession({ db, glm, cipher }, s.id, 'USER_END');
    const row = await db.sessionNote.findUnique({ where: { sessionId: s.id } });
    return { glm, note: noteSchema.parse(JSON.parse(cipher.decrypt(row!.encryptedContent))) };
  }

  it('asks for goals-vs-progress on the last planned sitting and keeps the note schema valid', async () => {
    const { glm, note } = await run(5, 5);
    expect(glm.calls[0]![0]!.content).toMatch(/FINAL sitting of a 5-day program/);
    expect(glm.calls[0]![0]!.content).toMatch(/Sleep before midnight/);
    expect(glm.calls[0]![0]!.content).toMatch(/EARLY-SITTING-SUMMARY/);
    expect(note.progressNote).toMatch(/goal/);
  });

  it('does not add the review to an ordinary sitting', async () => {
    const { glm } = await run(2, 5);
    expect(glm.calls[0]![0]!.content).not.toMatch(/FINAL sitting/);
  });
});
