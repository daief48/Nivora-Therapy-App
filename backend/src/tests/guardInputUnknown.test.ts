import { describe, expect, it } from 'vitest';
import { db, fakeGlm, makeApp, register } from './helpers.js';
import { guardInput } from '../services/crisisResponse.js';
import { userHasRisk } from '../services/riskState.js';
import { CONSENT_COVERAGE, FEATURE_FLOWS } from '../services/aiDataMap.js';

const ES_OK = 'Quiero aprender a cocinar mejor cada semana';
const ES_HIGH = 'Quiero desaparecer para siempre de este mundo';
const cipher = { decrypt: (s: string) => s };
const events = (userId: string) => db.safetyEvent.count({ where: { userId } });

async function newUser() { return (await register(makeApp())).userId; }

describe('guardInput: classifier outage is UNKNOWN, not an ELEVATED risk event', () => {
  it('error, timeout-like failure and unparseable output: skipAi, unknown, no SafetyEvent, userHasRisk false', async () => {
    for (const reply of [new Error('boom'), 'not json', '{"severity":']) {
      const userId = await newUser();
      const glm = fakeGlm(reply);
      const g = await guardInput(db, glm, userId, ES_OK, { scope: 'kaizen' });
      expect(g.crisis).toBeNull();
      expect(g.skipAi).toBe(true);
      expect(g.unknown).toBe(true);
      expect(glm.calls.length).toBe(1); // the classifier only
      expect(await events(userId)).toBe(0);
      expect(await userHasRisk(db, cipher, userId)).toBe(false);
    }
  });

  it('a real model ELEVATED verdict still writes the event, skips AI and flips userHasRisk', async () => {
    const userId = await newUser();
    const g = await guardInput(db, fakeGlm('{"severity":"ELEVATED"}'), userId, ES_OK);
    expect(g.skipAi).toBe(true);
    expect(g.unknown).toBe(false);
    expect(await db.safetyEvent.count({ where: { userId, severity: 'ELEVATED' } })).toBe(1);
    expect(await userHasRisk(db, cipher, userId)).toBe(true);
  });

  it('a model NONE verdict is clean; HIGH from the model is unchanged (crisis, event written)', async () => {
    const u1 = await newUser();
    const none = await guardInput(db, fakeGlm('{"severity":"NONE"}'), u1, ES_OK);
    expect(none).toMatchObject({ crisis: null, skipAi: false, unknown: false });
    const u2 = await newUser();
    const high = await guardInput(db, fakeGlm('{"severity":"HIGH"}'), u2, ES_HIGH);
    expect(high.crisis?.safety.severity).toBe('HIGH');
    expect(high.skipAi).toBe(true);
    expect(await db.safetyEvent.count({ where: { userId: u2, severity: 'HIGH' } })).toBe(1);
  });

  it('rules HIGH never reaches the classifier and is unchanged during an outage', async () => {
    const userId = await newUser();
    const glm = fakeGlm(new Error('down'));
    const g = await guardInput(db, glm, userId, 'I want to kill myself');
    expect(g.crisis?.crisis).toBe(true);
    expect(glm.calls.length).toBe(0);
    expect(await db.safetyEvent.count({ where: { userId, severity: { in: ['HIGH', 'IMMINENT'] } } })).toBe(1);
  });

  it('rules ELEVATED text during an outage still records ELEVATED (rules verdict is real)', async () => {
    const userId = await newUser();
    const g = await guardInput(db, fakeGlm(new Error('down')), userId, 'I feel hopeless and I cannot go on like this');
    expect(g.skipAi).toBe(true);
    expect(await db.safetyEvent.count({ where: { userId, severity: 'ELEVATED' } })).toBe(1);
  });

  it('reports a content-free telemetry event on outage', async () => {
    const userId = await newUser();
    const seen: unknown[][] = [];
    await guardInput(db, fakeGlm(new Error('down')), userId, ES_OK, { scope: 'sleep', track: (e, d) => { seen.push([e, d]); } });
    expect(seen).toEqual([['risk_classifier_unknown', { scope: 'sleep', code: 'CLASSIFIER_UNKNOWN' }]]);
  });
});

describe('guardInput: rolling window is shared per user across features (within 2 minutes)', () => {
  it('a crisis split across two inputs is caught within one feature', async () => {
    const userId = await newUser();
    const glm = fakeGlm('{"severity":"NONE"}');
    const a = await guardInput(db, glm, userId, "I don't want to", { scope: 'sleep' });
    expect(a.crisis).toBeNull();
    const b = await guardInput(db, glm, userId, 'be alive anymore', { scope: 'sleep' });
    expect(b.crisis?.crisis).toBe(true);
  });

  it('a crisis split across two different features within the window is caught (shared per-user window)', async () => {
    const userId = await newUser();
    const glm = fakeGlm('{"severity":"NONE"}');
    expect((await guardInput(db, glm, userId, "I don't want to", { scope: 'sleep' })).crisis).toBeNull();
    const b = await guardInput(db, glm, userId, 'be alive anymore', { scope: 'kaizen' });
    expect(b.crisis?.crisis).toBe(true);
    expect(await db.safetyEvent.count({ where: { userId, severity: { in: ['HIGH', 'IMMINENT'] } } })).toBe(1);
  });

  it('only fragments within the 2-minute window combine; unrelated benign text never reads as crisis', async () => {
    const userId = await newUser();
    const glm = fakeGlm('{"severity":"NONE"}');
    await guardInput(db, glm, userId, "I don't want to", { scope: 'kaizen' });
    const real = Date.now;
    Date.now = () => real() + 3 * 60_000;
    try {
      expect((await guardInput(db, glm, userId, 'be alive anymore', { scope: 'sleep' })).crisis).toBeNull();
      expect((await guardInput(db, glm, userId, 'Read a little every day', { scope: 'program' })).crisis).toBeNull();
    } finally { Date.now = real; }
    expect(await db.safetyEvent.count({ where: { userId, severity: { in: ['HIGH', 'IMMINENT'] } } })).toBe(0);
  });
});

describe('aiDataMap consistency', () => {
  it('every model flow with a consent has it in CONSENT_COVERAGE, and its data keys are covered by that consent', () => {
    for (const f of FEATURE_FLOWS) {
      if (f.consent === null || f.consent === 'BASE') continue;
      const cov = CONSENT_COVERAGE.find((c) => c.type === f.consent);
      expect(cov, f.key).toBeDefined();
      for (const k of f.data) {
        // health aggregates are additionally gated by their own HEALTH_IMPORT consent (monthly_summary)
        const owner = k === 'HEALTH_ACTIVITY_AGGREGATES' ? CONSENT_COVERAGE.find((c) => c.type === 'HEALTH_IMPORT')! : cov!;
        expect(owner.covers, `${f.key} -> ${k}`).toContain(k);
      }
    }
  });
  it('kaizen goal flows are labelled as goal text, not history', () => {
    for (const k of ['kaizen_goal_clarity_check', 'kaizen_goal_split']) {
      expect(FEATURE_FLOWS.find((f) => f.key === k)).toMatchObject({ consent: 'JOURNAL_AI_SHARING', data: ['KAIZEN_GOAL_TEXT'] });
    }
  });
});
