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

export const TASK_SIGNAL_TASKS: Record<string, { content: string; reason: string; cue: { en: string; bn: string } }> = {
  HIGH_STRESS: {
    content: 'Take two slow breaths before you check your phone in the morning.',
    reason: 'Stress has been high; one calm pause at the start of the day keeps it from piling up.',
    cue: { en: 'after I wake up and before I pick up my phone', bn: 'ঘুম থেকে উঠে ফোন হাতে নেওয়ার আগে' },
  },
  SLEEP_LOW: {
    content: 'Put your phone down five minutes earlier tonight and let your shoulders drop.',
    reason: 'Sleep has been short; a slightly earlier wind-down gives rest a better chance.',
    cue: { en: 'after I brush my teeth at night', bn: 'রাতে দাঁত ব্রাশ করার পর' },
  },
  LOW_MOOD_AFTER: {
    content: 'Write one honest line about how today felt, without fixing anything.',
    reason: 'The session ended on a heavy note; one line on paper can carry a little of it.',
    cue: { en: 'after my evening tea or dinner', bn: 'সন্ধ্যার চা বা রাতের খাবারের পর' },
  },
  MOOD_DROPPED: {
    content: 'Step outside for three quiet minutes today, no destination.',
    reason: 'Mood has dipped; a small change of air often loosens the day a little.',
    cue: { en: 'after lunch', bn: 'দুপুরের খাবারের পর' },
  },
  KAIZEN_STALLED: {
    content: 'Do the tiniest version of what you have been avoiding — two minutes at most.',
    reason: 'Things stalled lately; two minutes is enough to turn standing still into moving.',
    cue: { en: 'after I finish my morning tea', bn: 'সকালের চা শেষ করার পর' },
  },
};
const FALLBACK_TASK = TASK_SIGNAL_TASKS.HIGH_STRESS;
/** Gentler, smaller, different task used when the last two finished tasks felt WORSE (back off, never push). */
const BACKOFF_TASK = {
  content: 'Just notice one breath today, if and when it feels okay. Nothing more is needed.',
  reason: 'Things have felt heavy lately, so this one is deliberately tiny and optional.',
  cue: { en: 'whenever a quiet moment shows up', bn: 'যখন একটু শান্ত মুহূর্ত আসে' },
};
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

export interface TaskDecisionDeps { db: Db; glm: GlmClient; cipher: Cipher; /** content-free telemetry (event name + coarse codes only). */ track?: (event: string, data?: Record<string, string | number | boolean>) => void }

export type TaskOutcome =
  | { outcome: 'NO_TASK'; reason: 'RISK' | 'TASK_ACTIVE' | 'STABLE' }
  | { outcome: 'TASK_GIVEN'; taskId: string }
  | { outcome: 'STATE_UPDATED'; state: TaskState };

export type TaskState = 'PROGRESSING' | 'STILL' | 'DONE';

export const FELT_VALUES = ['BETTER', 'SAME', 'WORSE'] as const;
export type Felt = (typeof FELT_VALUES)[number];
/** Deterministic: the last two completed tasks (newest first) both felt WORSE. */
export const feltBackoff = (recentFeltNewestFirst: (string | null | undefined)[]) =>
  recentFeltNewestFirst.length >= 2 && recentFeltNewestFirst[0] === 'WORSE' && recentFeltNewestFirst[1] === 'WORSE';
const BACKOFF_RECENCY_DAYS = 14;
/**
 * How the user's last completed tasks felt (newest first). Only tasks finished in the last 14 days count (an old rough patch must not
 * shape today's task), and a task finished without any feedback (felt null) is ignored when picking the last two.
 */
export async function recentFelt(db: Db, userId: string, n = 2, now = new Date()): Promise<(string | null)[]> {
  const since = new Date(now.getTime() - BACKOFF_RECENCY_DAYS * 86_400_000);
  const rows = await db.kaizenTask.findMany({ where: { userId, status: 'DONE', felt: { not: null }, completedAt: { gte: since } }, orderBy: { completedAt: 'desc' }, take: n, select: { felt: true } });
  return rows.map((r) => r.felt);
}

export const activeTaskOf = (db: Db, userId: string) =>
  db.kaizenTask.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });

/** The session prompt's one private line about the current task (continuity for Feature A). */
export function taskPromptLine(task: { contentEnc: string; status: string; stateNoteEnc: string | null; cueEnc?: string | null; cueTime?: string | null }, decrypt: (s: string) => string, opts: { risk?: boolean } = {}): string {
  // Under any risk signal the user's own free text (the check-in note, the cue) is not injected into the prompt; only the AI-phrased task is.
  const note = task.stateNoteEnc && !opts.risk ? ` Latest check: ${decrypt(task.stateNoteEnc)}` : '';
  const cue = task.cueEnc && !opts.risk ? ` The "when" they agreed for it: ${decrypt(task.cueEnc)}${task.cueTime ? ` (around ${task.cueTime})` : ''} — you may gently mention it as the plan they made, never as an instruction or a reminder to obey.` : '';
  return `KAIZEN TASK (private background): they have one small ongoing task from earlier: "${decrypt(task.contentEnc)}".${note}${cue} You may briefly ask how it is going — no pressure, no deadline, and never guilt about how long it is taking.`;
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
export async function phraseTask(glm: GlmClient, i: { signals: TaskSignal[]; sessionSummary?: string; locale?: string | null; backoff?: boolean }): Promise<{ content: string; reason: string; suggestedCue: string }> {
  const base = i.backoff ? BACKOFF_TASK : i.signals.map((s) => TASK_SIGNAL_TASKS[s]).find(Boolean) ?? FALLBACK_TASK;
  const fallback = { content: base.content, reason: base.reason, suggestedCue: base.cue[i.locale === 'bn' ? 'bn' : 'en'] };
  try {
    const out = await glm.chat([
      { role: 'system', content: `You phrase ONE small Kaizen task for a wellness companion. Kaizen: a tiny daily step, no pressure, no blame, no deadline, never a day count. Rules: content = one concrete sentence, doable today, mental-health supportive; reason = one warm sentence tying it to how the person has been feeling. suggestedCue = a short natural "after <something they already do daily>" phrase (max 10 words) the person may adopt as when to do it; a suggestion, never an order.${i.backoff ? ' The last tasks felt worse for this person: make this one much smaller and different, optional in tone.' : ''} Never diagnose, never say "you should". Output strict JSON: {"content": string, "reason": string, "suggestedCue": string}. Reply in the user's language.` },
      { role: 'user', content: `Signals: ${i.signals.join(', ') || 'none'}${i.sessionSummary ? `\nSession summary: ${i.sessionSummary.slice(0, 600)}` : ''}` },
    ], { maxTokens: 220 });
    const parsed = parseJsonObject(out.content) as { content?: unknown; reason?: unknown; suggestedCue?: unknown } | null;
    if (parsed && typeof parsed.content === 'string' && typeof parsed.reason === 'string' && outputOk(parsed.content, parsed.reason)) {
      const cue = typeof parsed.suggestedCue === 'string' && parsed.suggestedCue.trim() && outputOk(parsed.suggestedCue) ? parsed.suggestedCue.trim().slice(0, 120) : fallback.suggestedCue;
      return { content: parsed.content.trim().slice(0, 200), reason: parsed.reason.trim().slice(0, 300), suggestedCue: cue };
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
    if (await userHasRisk(d.db, d.cipher, s.userId)) { d.track?.('kaizen_task_skipped', { reason: 'RISK' }); return { outcome: 'NO_TASK', reason: 'RISK' }; }

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
        d.track?.('kaizen_task_done');
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
    const backoff = feltBackoff(await recentFelt(d.db, s.userId));
    const phrased = await phraseTask(d.glm, { signals: cond.signals, sessionSummary: summaryText, locale: u?.locale, backoff });
    const task = await d.db.kaizenTask.create({
      data: {
        userId: s.userId, lastSessionId: s.id,
        contentEnc: d.cipher.encrypt(phrased.content), reasonEnc: d.cipher.encrypt(phrased.reason),
        suggestedCueEnc: d.cipher.encrypt(phrased.suggestedCue),
      },
    });
    d.track?.('kaizen_task_given', { signals: cond.signals.join(','), backoff });
    return { outcome: 'TASK_GIVEN', taskId: task.id };
  } catch { return null; }
}

/** Should the AI reconsider (shrink/drop) a task that has been standing still? */
/** ...or when the last two finished tasks felt WORSE (pass recentFelt, newest first). */
export const shouldReconsider = (t: { stillCount: number }, recentFeltNewestFirst: (string | null | undefined)[] = []) =>
  t.stillCount >= SESSIONS_BEFORE_RECONSIDER || feltBackoff(recentFeltNewestFirst);
