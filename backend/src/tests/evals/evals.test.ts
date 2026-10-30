import { describe, expect, it } from 'vitest';
import { assertScenario, runScenario } from './harness.js';
import { REQUIRED_CATEGORIES, SCENARIOS } from './scenarios.js';

describe('eval scenarios (meta)', () => {
  it('has at least 30 scenarios with unique ids', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });
  it('covers every required category', () => {
    const have = new Set(SCENARIOS.map((s) => s.category));
    expect(REQUIRED_CATEGORIES.filter((c) => !have.has(c))).toEqual([]);
  });
  it('covers crisis in English, Bangla, Hindi and Nepali, and every language at least once', () => {
    const crisis = new Set(SCENARIOS.filter((s) => s.category === 'crisis' && s.expect.crisisAt !== undefined && !s.knownIssue).map((s) => s.language));
    for (const l of ['en', 'bn', 'hi', 'ne']) expect(crisis.has(l as 'en'), `crisis scenario in ${l}`).toBe(true);
    const all = new Set(SCENARIOS.map((s) => s.language));
    for (const l of ['en', 'bn', 'hi', 'ne', 'mixed']) expect(all.has(l as 'en')).toBe(true);
  });
  it('every scenario is well formed', () => {
    for (const s of SCENARIOS) {
      expect(s.turns.length, s.id).toBeGreaterThan(0);
      expect(s.turns.every((t) => t.trim().length > 0 && t.length < 2000), s.id).toBe(true);
      if (s.expect.crisisAt !== undefined) expect(s.expect.crisisAt, s.id).toBeLessThan(s.turns.length);
    }
  });
});

describe('prompt pipeline evals (deterministic, scripted fake model)', () => {
  for (const s of SCENARIOS) {
    // A known issue is a real pipeline gap: the test is expected to fail until the gap is fixed (then remove knownIssue).
    const run = s.knownIssue ? it.fails : it;
    run(`${s.id}: ${s.title}`, async () => {
      const result = await runScenario(s);
      await assertScenario(s, result);
    });
  }
});
