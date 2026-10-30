import { describe, expect, it } from 'vitest';
import { computeState, isDistressText, isWrapUpText, maybeBuildPlanFromIntake, parseJsonLoose, type EngineSession } from '../services/sessionEngine.js';
import { createCipher } from '../utils/crypto.js';
import { getActivePlan } from '../services/therapyData.js';
import { config, db, fakeGlm, makeApp, register } from './helpers.js';

const t0 = new Date('2026-01-01T10:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const base = (o: Partial<EngineSession> = {}): EngineSession => ({ phase: 'OPENING', lengthMin: 30, startedAt: t0, isIntake: false, riskFlag: 'NONE', moodBefore: 5, ...o });

describe('computeState (pure)', () => {
  it('walks OPENING -> AGENDA -> CORE by turns, one step per message', () => {
    expect(computeState(base(), 0, at(0)).phase).toBe('OPENING');
    expect(computeState(base(), 2, at(1)).phase).toBe('OPENING');
    expect(computeState(base(), 4, at(2)).phase).toBe('AGENDA');
    expect(computeState(base({ phase: 'AGENDA' }), 6, at(3)).phase).toBe('CORE');
    const s = computeState(base({ phase: 'CORE' }), 8, at(4));
    expect(s.phase).toBe('CORE');
    expect(s.phaseHint).toBe('hintCore');
    expect(s.remainingMin).toBe(26);
  });
  it('nudges to SUMMARY at ~80% of the time, then HOMEWORK, CLOSING', () => {
    expect(computeState(base({ phase: 'CORE' }), 10, at(23)).phase).toBe('CORE');
    expect(computeState(base({ phase: 'CORE' }), 10, at(25)).phase).toBe('SUMMARY');
    expect(computeState(base({ phase: 'SUMMARY' }), 12, at(28)).phase).toBe('HOMEWORK');
    expect(computeState(base({ phase: 'HOMEWORK' }), 14, at(31)).phase).toBe('CLOSING');
    expect(computeState(base({ phase: 'CORE' }), 10, at(25)).nextStep).toMatch(/SUMMARY/);
  });
  it('open-ended sessions have no clock and stay in CORE until the user wraps up', () => {
    const s = computeState(base({ lengthMin: 0, phase: 'CORE' }), 40, at(200));
    expect(s.phase).toBe('CORE');
    expect(s.remainingMin).toBeNull();
    expect(computeState(base({ lengthMin: 0, phase: 'CORE' }), 10, at(5), { lastUserText: "thanks, that's all for today" }).phase).toBe('SUMMARY');
  });
  it('never rushes a distressed user to the exit', () => {
    expect(computeState(base({ phase: 'CORE', riskFlag: 'ELEVATED' }), 10, at(29)).phase).toBe('CORE');
    const s = computeState(base({ phase: 'HOMEWORK' }), 12, at(29), { lastUserText: 'I feel hopeless and overwhelmed' });
    expect(s.phase).toBe('CORE');
    expect(s.nextStep).toMatch(/SUPPORT/);
    expect(s.distressed).toBe(true);
  });
  it('includes periodic review, risk check-in and mood in the opening', () => {
    expect(computeState(base(), 0, at(0), { finalizedCount: 6 }).nextStep).toMatch(/progress check/);
    expect(computeState(base(), 0, at(0), { finalizedCount: 5 }).nextStep).not.toMatch(/progress check/);
    expect(computeState(base(), 0, at(0), { highStress: true }).nextStep).toMatch(/check-ins show high stress/);
    expect(computeState(base({ moodBefore: 3 }), 0, at(0)).nextStep).toMatch(/3\/10/);
  });
  it('intake has its own steps and finishes with a closing', () => {
    const intake = base({ isIntake: true, lengthMin: 0 });
    expect(computeState(intake, 0, at(0)).nextStep).toMatch(/INTAKE WELCOME/);
    expect(computeState({ ...intake, phase: 'CORE' }, 18, at(20)).phase).toBe('SUMMARY');
    expect(computeState({ ...intake, phase: 'HOMEWORK' }, 24, at(30)).nextStep).toMatch(/INTAKE CLOSING/);
  });
  it('detects distress / wrap-up in several languages', () => {
    expect(isDistressText('আমি আর পারছি না')).toBe(true);
    expect(isDistressText('I am fine')).toBe(false);
    expect(isWrapUpText('I have to go now')).toBe(true);
  });
  it('parses loosely wrapped JSON', () => {
    expect(parseJsonLoose('here: ```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('no json')).toBeNull();
  });
});

describe('maybeBuildPlanFromIntake', () => {
  const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
  const PLAN_JSON = JSON.stringify({
    goals: [{ title: 'Sleep through the night' }], focusAreas: ['sleep'], approach: 'CBT', pace: 'GENTLE', tone: 'WARM', language: 'en', background: 'Student', whatHelps: 'walks',
  });
  async function intake(optIn: boolean, remember = true) {
    const app = makeApp();
    const u = await register(app);
    if (optIn) await db.userProfile.update({ where: { userId: u.userId }, data: { preferencesJson: { continuityOptIn: true } } });
    const s = await db.therapySession.create({ data: { userId: u.userId, isIntake: true, rememberThis: remember } });
    for (let i = 0; i < 4; i++) await db.sessionMessage.create({ data: { sessionId: s.id, role: i % 2 ? 'assistant' : 'user', encryptedContent: cipher.encrypt(`msg ${i}`) } });
    return { u, s };
  }
  it('saves a validated plan when continuity is on, and is idempotent', async () => {
    const { u, s } = await intake(true);
    const glm = fakeGlm('```json\n' + PLAN_JSON + '\n```');
    expect(await maybeBuildPlanFromIntake({ db, glm, cipher }, s.id)).toBe(true);
    const p = await getActivePlan(db, cipher, u.userId);
    expect(p?.plan.goals[0]).toMatchObject({ id: 'g1', title: 'Sleep through the night' });
    expect(p?.plan.approach).toBe('CBT');
    expect(await maybeBuildPlanFromIntake({ db, glm, cipher }, s.id)).toBe(false);
    expect(glm.calls).toHaveLength(1);
  });
  it('does nothing without opt-in, without rememberThis, or on invalid model output', async () => {
    const a = await intake(false);
    const g1 = fakeGlm(PLAN_JSON);
    expect(await maybeBuildPlanFromIntake({ db, glm: g1, cipher }, a.s.id)).toBe(false);
    expect(g1.calls).toHaveLength(0);
    const b = await intake(true, false);
    expect(await maybeBuildPlanFromIntake({ db, glm: fakeGlm(PLAN_JSON), cipher }, b.s.id)).toBe(false);
    const c = await intake(true);
    expect(await maybeBuildPlanFromIntake({ db, glm: fakeGlm('not json'), cipher }, c.s.id)).toBe(false);
    expect(await getActivePlan(db, cipher, c.u.userId)).toBeNull();
    expect(await maybeBuildPlanFromIntake({ db, glm: fakeGlm(new Error('down')), cipher }, c.s.id)).toBe(false);
  });
});
