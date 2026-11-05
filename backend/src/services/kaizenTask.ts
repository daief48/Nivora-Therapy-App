import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import type { GlmClient } from './glmClient.js';
import { userHasRisk } from './riskState.js';
import { recentHighStress } from './contextService.js';
import { lastNight } from './kaizenExtras.js';
import { parseJsonObject, outputOk } from './aiOutput.js';
import { activeConsents } from '../modules/consents/consentService.js';

/**
 * Feature A — the ONE small Kaizen task a therapy session may suggest.
 * The deterministic rule layer decides IF a task is warranted and tracks its state across
 * sessions; the AI only phrases the task, the reason and the per-session state line, with
 * curated fallbacks. No duration, no deadline: a task stays ACTIVE for as long as it takes and
 * may well span several sessions. Risk/crisis suppresses everything.
 */

const SESSIONS_BEFORE_RECONSIDER = 3; // standing still this many sessions -> the AI may offer shrink/drop

export const TASK_SIGNAL_TASKS: Record<string, { content: string; reason: string }> = {
  HIGH_STRESS: {
    content: 'Take two slow breaths before you check your phone in the morning.',
    reason: 'Stress has been high; one calm pause at the start of the day keeps it from piling up.',
  },
  SLEEP_LOW: {
    content: 'Put your phone down five minutes earlier tonight and let your shoulders drop.',
    reason: 'Sleep has been short; a slightly earlier wind-down gives rest a better chance.',
  },
  LOW_MOOD_AFTER: {
    content: 'Write one honest line about how today felt, without fixing anything.',
    reason: 'The session ended on a heavy note; one line on paper can carry a little of it.',
  },
  MOOD_DROPPED: {
    content: 'Step outside for three quiet minutes today, no destination.',
    reason: 'Mood has dipped; a small change of air often loosens the day a little.',
  },
  KAIZEN_STALLED: {
    content: 'Do the tiniest version of what you have been avoiding — two minutes at most.',
    reason: 'Things stalled lately; two minutes is enough to turn standing still into moving.',
  },
};
const FALLBACK_TASK = TASK_SIGNAL_TASKS.HIGH_STRESS;
const FALLBACK_STATE_NOTE = 'This session passed without a clear change in the task.';

export type TaskSignal = keyof typeof TASK_SIGNAL_TASKS;

/** Deterministic condition read: a soft signal alone never creates a task; score >= 2 does. */
export interface ConditionInput { moodBefore: number | null; moodAfter: number | null; highStress: boolean; sleepLow: boolean; stalled: boolean }
export interface Condition { score: number; signals: TaskSignal[] }
export function assessTaskCondition(i: ConditionInput): Condition {
  let score = 0;
  const signals: TaskSignal[] = [];
  if (i.moodAfter != null && i.moodBefore != null) {
    if (i.moodAfter <= 4) { score += 2; signals.push('LOW_MOOD_AFTER'); }
    else if (i.moodAfter < i.moodBefore) { score += 1; signals.push('MOOD_DROPPED'); }
  }
  // Acute stress outweighs everything else the user data may say.
  if (i.highStress) { score += 3; signals.push('HIGH_STRESS'); }
  if (i.sleepLow) { score += 1; signals.push('SLEEP_LOW'); }
  if (i.stalled) { score += 1; signals.push('KAIZEN_STALLED'); }
  return { score, signals };
}

export interface TaskDecisionDeps { db: Db; glm: GlmClient; cipher: Cipher }

export type TaskOutcome =
  | { outcome: 'NO_TASK'; reason: 'RISK' | 'TASK_ACTIVE' | 'STABLE' }
  | { outcome: 'TASK_GIVEN'; taskId: string }
  | { outcome: 'STATE_UPDATED'; state: TaskState };

export type TaskState = 'PROGRESSING' | 'STILL' | 'DONE';

export const activeTaskOf = (db: Db, userId: string) =>
  db.kaizenTask.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });

/** The session prompt's one private line about the current task (continuity for Feature A). */
export function taskPromptLine(task: { contentEnc: string; status: string; stateNoteEnc: string | null }, decrypt: (s: string) => string): string {
  const note = task.stateNoteEnc ? ` Latest check: ${decrypt(task.stateNoteEnc)}` : '';
  return `KAIZEN TASK (private background): they have one small ongoing task from earlier: "${decrypt(task.contentEnc)}".${note} You may briefly ask how it is going — no pressure, no deadline, and never guilt about how long it is taking.`;
}

/** Gathers the condition signals for the user right now. */
export async function conditionForUser(db: Db, userId: string, session?: { moodBefore: number | null; moodAfter: number | null } | null): Promise<Condition> {
  const [highStress, sleep] = await Promise.all([
    recentHighStress(db, userId).catch(() => false),
    lastNight(db, userId, null),
  ]);
  return assessTaskCondition({
    moodBefore: session?.moodBefore ?? null,
    moodAfter: session?.moodAfter ?? null,
    highStress,
    sleepLow: !!sleep?.low,
    stalled: false, // the old kaizen history no longer drives tasks; kept for the signal shape
  });
}

/** AI phrasing of the task + reason; falls back to the curated task for the strongest signal. */
export async function phraseTask(glm: GlmClient, i: { signals: TaskSignal[]; sessionSummary?: string; locale?: string | null }): Promise<{ content: string; reason: string }> {
  const fallback = i.signals.map((s) => TASK_SIGNAL_TASKS[s]).find(Boolean) ?? FALLBACK_TASK;
  try {
    const out = await glm.chat([
      { role: 'system', content: `You phrase ONE small Kaizen task for a wellness companion. Kaizen: a tiny daily step, no pressure, no blame, no deadline, never a day count. Rules: content = one concrete sentence, doable today, mental-health supportive; reason = one warm sentence tying it to how the person has been feeling. Never diagnose, never say "you should". Output strict JSON: {"content": string, "reason": string}. Reply in the user's language.` },
      { role: 'user', content: `Signals: ${i.signals.join(', ') || 'none'}${i.sessionSummary ? `\nSession summary: ${i.sessionSummary.slice(0, 600)}` : ''}` },
    ], { maxTokens: 220 });
    const parsed = parseJsonObject(out.content) as { content?: unknown; reason?: unknown } | null;
    if (parsed && typeof parsed.content === 'string' && typeof parsed.reason === 'string' && outputOk(parsed.content, parsed.reason)) {
      return { content: parsed.content.trim().slice(0, 200), reason: parsed.reason.trim().slice(0, 300) };
    }
    return fallback;
  } catch { return fallback; }
}

/** The AI's one-line state read of an active task after a session; falls back to a neutral note. */
export async function phraseState(glm: GlmClient, i: { task: string; sessionSummary?: string; locale?: string | null }): Promise<{ state: TaskState; note: string }> {
  try {
    const out = await glm.chat([
      { role: 'system', content: `A person has one small ongoing Kaizen task: "<task>". A session just ended. From the session summary alone, classify how the task stands: "DONE" (they say it is done), "PROGRESSING" (they moved on it), or "STILL" (no clear change). note = one short warm sentence for the record, no blame. Output strict JSON: {"state":"DONE|PROGRESSING|STILL","note":string}. Reply in the user's language.` },
      { role: 'user', content: `Task: ${i.task}${i.sessionSummary ? `\nSession summary: ${i.sessionSummary.slice(0, 600)}` : '\n(no summary kept)'}` },
    ], { maxTokens: 180 });
    const parsed = parseJsonObject(out.content) as { state?: unknown; note?: unknown } | null;
    if (parsed && typeof parsed.state === 'string' && ['DONE', 'PROGRESSING', 'STILL'].includes(parsed.state) && typeof parsed.note === 'string' && outputOk(parsed.note)) {
      return { state: parsed.state as TaskState, note: parsed.note.trim().slice(0, 200) };
    }
    return { state: 'STILL', note: FALLBACK_STATE_NOTE };
  } catch { return { state: 'STILL', note: FALLBACK_STATE_NOTE }; }
}

/**
 * The per-session hook (chat / voice / video): updates the active task's state, and — only when
 * nothing stands in the way — gives the next task. Best effort; a failure never breaks the session.
 */
export async function updateKaizenTaskState(d: TaskDecisionDeps, sessionId: string): Promise<TaskOutcome | null> {
  try {
    const s = await d.db.therapySession.findUnique({ where: { id: sessionId } });
    if (!s || s.status !== 'ENDED' || s.isIntake || !s.rememberThis) return null;
    if (await userHasRisk(d.db, d.cipher, s.userId)) return { outcome: 'NO_TASK', reason: 'RISK' };

    const active = await activeTaskOf(d.db, s.userId);
    const summary = await d.db.sessionSummary.findUnique({ where: { sessionId } });
    const summaryText = summary ? d.cipher.decrypt(summary.encryptedSummary) : undefined;
    const u = await d.db.user.findUnique({ where: { id: s.userId }, select: { locale: true } });

    if (active) {
      // The state line is a model call on session-derived text, so it needs the same consent; without it a neutral note suffices.
      const consented = (await activeConsents(d.db, s.userId)).has('WELLNESS_AI_SHARING');
      const { state, note } = consented
        ? await phraseState(d.glm, { task: d.cipher.decrypt(active.contentEnc), sessionSummary: summaryText, locale: u?.locale })
        : { state: 'STILL' as TaskState, note: FALLBACK_STATE_NOTE };
      if (state === 'DONE') {
        await d.db.kaizenTask.update({ where: { id: active.id }, data: { status: 'DONE', stateNoteEnc: d.cipher.encrypt(note), completedAt: new Date(), stillSince: null, stillCount: 0, lastSessionId: s.id } });
        return { outcome: 'STATE_UPDATED', state: 'DONE' };
      }
      if (state === 'PROGRESSING') {
        await d.db.kaizenTask.update({ where: { id: active.id }, data: { stateNoteEnc: d.cipher.encrypt(note), stillSince: null, stillCount: 0, lastSessionId: s.id } });
        return { outcome: 'STATE_UPDATED', state: 'PROGRESSING' };
      }
      const stillCount = active.stillCount + 1;
      await d.db.kaizenTask.update({
        where: { id: active.id },
        data: { stateNoteEnc: d.cipher.encrypt(note), stillSince: active.stillSince ?? new Date(), stillCount, lastSessionId: s.id },
      });
      return { outcome: 'STATE_UPDATED', state: 'STILL' };
    }

    // No active task: only a struggling condition offers one (score >= 2; a soft signal never does).
    const cond = await conditionForUser(d.db, s.userId, s);
    if (cond.score < 2) return { outcome: 'NO_TASK', reason: 'STABLE' };
    if (!(await activeConsents(d.db, s.userId)).has('WELLNESS_AI_SHARING')) return { outcome: 'NO_TASK', reason: 'STABLE' };
    const phrased = await phraseTask(d.glm, { signals: cond.signals, sessionSummary: summaryText, locale: u?.locale });
    const task = await d.db.kaizenTask.create({
      data: {
        userId: s.userId, lastSessionId: s.id,
        contentEnc: d.cipher.encrypt(phrased.content), reasonEnc: d.cipher.encrypt(phrased.reason),
      },
    });
    return { outcome: 'TASK_GIVEN', taskId: task.id };
  } catch { return null; }
}

/** Should the AI reconsider (shrink/drop) a task that has been standing still? */
export const shouldReconsider = (t: { stillCount: number }) => t.stillCount >= SESSIONS_BEFORE_RECONSIDER;
