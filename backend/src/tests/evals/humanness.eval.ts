import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGlmClient, type ChatMessage, type GlmClient } from '../../services/glmClient.js';
import { summarize, THRESHOLDS, PASS_SCORE, type HumannessSummary } from '../../services/humanness.js';
import { LEGACY_SYSTEM_PROMPT, languageDirective } from '../../services/systemPrompt.js';
import { runScenario } from './harness.js';
import { HUMANNESS_SCRIPTS, type HumannessScript } from './humanness.scenarios.js';
import type { EvalScenario } from './scenarios.js';

/**
 * LIVE humanness eval. Runs each multi-turn script through the real reply pipeline (HTTP app, safety, session engine, layered
 * prompt, style guard) against the real model, scores the transcript with services/humanness.ts and asserts aggregate thresholds.
 * Skipped cleanly (no network) unless EVAL_LIVE=1 and OPENAI_API_KEY are set.
 *
 *   EVAL_LIVE=1 OPENAI_API_KEY=sk-... npm run eval:humanness
 *   HUMANNESS_JUDGE=1 ...   also runs a blind pairwise LLM-judge comparison: LEGACY prompt vs the current pipeline (A/B order randomised),
 *                           prints the current-pipeline win rate; asserts only if HUMANNESS_JUDGE_MIN_WIN is set (e.g. 0.5).
 * The report prints scores and counts, never message text.
 */
const LIVE = process.env.EVAL_LIVE === '1' && !!process.env.OPENAI_API_KEY;
const JUDGE = LIVE && process.env.HUMANNESS_JUDGE === '1';

const toScenario = (s: HumannessScript): EvalScenario => ({ id: s.id, title: s.kind, category: 'stress', language: s.language, turns: s.turns, expect: {} });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Legacy-prompt transcript: same user turns, legacy system prompt, no pipeline (what the old app did). */
async function legacyTranscript(glm: GlmClient, s: HumannessScript): Promise<string[]> {
  const msgs: ChatMessage[] = [{ role: 'system', content: `${LEGACY_SYSTEM_PROMPT}\n\n${languageDirective(s.language === 'mixed' ? 'en' : s.language)}` }];
  const out: string[] = [];
  for (const t of s.turns) {
    msgs.push({ role: 'user', content: t });
    const r = await glm.chat(msgs, { maxTokens: 400 });
    out.push(r.content.trim());
    msgs.push({ role: 'assistant', content: r.content });
  }
  return out;
}

const render = (s: HumannessScript, replies: string[]) => s.turns.map((t, i) => `User: ${t}\nAssistant: ${replies[i] ?? ''}`).join('\n\n');

/** Returns true when the CURRENT transcript is judged more human. Order is randomised so position bias averages out. */
async function judge(glm: GlmClient, s: HumannessScript, current: string[], legacy: string[]): Promise<boolean> {
  const currentIsA = Math.random() < 0.5;
  const [a, b] = currentIsA ? [current, legacy] : [legacy, current];
  const prompt = `Two AI companions had the same conversation with a person who is struggling. Decide which assistant sounds more like a warm, attentive human who is really listening: natural varied wording, matching the person's length and energy, not scripted, not lecturing, not asking a question every time, no stock sympathy phrases. Safety and accuracy are equal in both; judge only how human it feels.\n\n=== CONVERSATION A ===\n${render(s, a)}\n\n=== CONVERSATION B ===\n${render(s, b)}\n\nAnswer with a single letter: A or B.`;
  const r = await glm.chat([{ role: 'user', content: prompt }], { maxTokens: 20 });
  const pick = /\b([AB])\b/.exec(r.content.toUpperCase())?.[1];
  return pick === (currentIsA ? 'A' : 'B');
}

describe.skipIf(!LIVE)('live humanness', () => {
  let real: GlmClient;
  const rows: { id: string; summary: HumannessSummary }[] = [];
  const verdicts: boolean[] = [];

  beforeAll(() => {
    real = createGlmClient({
      apiKey: process.env.OPENAI_API_KEY!, baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      timeoutMs: 45_000, maxOutputTokens: 600, thinkingDisabled: false,
    });
  });

  afterAll(() => {
    const lines = ['', `HUMANNESS EVAL: ${rows.length} scripts, mean score ${avg(rows.map((r) => r.summary.humannessScore)).toFixed(1)} (pass >= ${PASS_SCORE})`];
    for (const { id, summary: s } of rows) {
      const m = s.metrics;
      lines.push(`${s.pass ? 'PASS' : 'FAIL'}  ${id.padEnd(20)} score ${String(s.humannessScore).padStart(3)}  open ${m.openingRepeatRate}  q-end ${m.questionEndingRate}  streak ${m.maxQuestionStreak}  len ${m.medianLengthRatio}  stock ${m.stockPhraseRate}  cv ${m.sentenceLengthCv}${s.failingChecks.length ? '  ! ' + s.failingChecks.join(',') : ''}`);
    }
    if (verdicts.length) lines.push(`JUDGE (blind pairwise, current vs legacy prompt): current wins ${verdicts.filter(Boolean).length}/${verdicts.length} = ${(100 * verdicts.filter(Boolean).length / verdicts.length).toFixed(0)}%`);
    console.log(lines.join('\n'));
  });

  for (const script of HUMANNESS_SCRIPTS) {
    it(`${script.id} (${script.kind})`, { timeout: 300_000 }, async () => {
      const r = await runScenario(toScenario(script), real);
      expect(r.turns.some((t) => t.crisis), 'scripts must not trigger the crisis reply').toBe(false);
      const replies = r.turns.map((t) => t.reply);
      rows.push({ id: script.id, summary: summarize(replies, script.turns) });
      if (JUDGE) verdicts.push(await judge(real, script, replies, await legacyTranscript(real, script)));
    });
  }

  it('aggregate thresholds', () => {
    expect(rows.length, 'scripts must run first').toBe(HUMANNESS_SCRIPTS.length);
    const mean = (f: (s: HumannessSummary) => number) => avg(rows.map((r) => f(r.summary)));
    expect(mean((s) => s.humannessScore), 'mean humannessScore').toBeGreaterThanOrEqual(PASS_SCORE);
    expect(mean((s) => s.metrics.questionEndingRate), 'mean questionEndingRate').toBeLessThanOrEqual(THRESHOLDS.questionEndingMax);
    expect(mean((s) => s.metrics.openingRepeatRate), 'mean openingRepeatRate').toBeLessThan(THRESHOLDS.openingRepeatMax);
    expect(Math.max(...rows.map((r) => r.summary.metrics.maxQuestionStreak)), 'longest question streak').toBeLessThanOrEqual(THRESHOLDS.questionStreakMax);
    expect(mean((s) => s.metrics.stockPhraseRate), 'mean stockPhraseRate').toBeLessThanOrEqual(THRESHOLDS.stockRateMax);
    const min = Number(process.env.HUMANNESS_JUDGE_MIN_WIN ?? '');
    if (JUDGE && process.env.HUMANNESS_JUDGE_MIN_WIN && Number.isFinite(min) && verdicts.length) {
      expect(verdicts.filter(Boolean).length / verdicts.length, 'judge win rate').toBeGreaterThanOrEqual(min);
    }
  });
});
