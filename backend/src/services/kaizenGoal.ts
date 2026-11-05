import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import type { GlmClient } from './glmClient.js';
import { parseJsonObject, outputOk } from './aiOutput.js';
import { activeConsents } from '../modules/consents/consentService.js';

/**
 * Feature B — the user's OWN goal, fully decoupled from therapy sessions. The AI splits the goal
 * into 3–7 small ordered tasks (with a deterministic fallback); every user update re-scores the
 * goal with a transparent formula. Nothing here ever reads session data.
 */

export interface SplitTask { id: string; title: string; done: boolean }

/** The deterministic fallback split when the model is unavailable or its output is rejected. */
export function fallbackSplit(title: string): SplitTask[] {
  const t = title.trim().replace(/\s+/g, ' ').slice(0, 80);
  return [
    { id: 'f1', title: `Write one honest line about what "${t}" means for you.`, done: false },
    { id: 'f2', title: `Give "${t}" two minutes today — no more than two.`, done: false },
    { id: 'f3', title: 'Note in one line how it felt, without judging it.', done: false },
  ].map((x, i) => ({ ...x, id: `f${i + 1}` }));
}

const clampTasks = (tasks: SplitTask[]): SplitTask[] =>
  tasks.slice(0, 7).map((t, i) => ({ id: t.id || `t${i + 1}`, title: String(t.title).trim().slice(0, 160), done: false }));

/** The AI split of the user's goal into 3–7 small steps; falls back to the deterministic split. */
export async function splitGoal(glm: GlmClient, i: { title: string; locale?: string | null }): Promise<SplitTask[]> {
  try {
    const out = await glm.chat([
      { role: 'system', content: `You split a personal goal into small Kaizen steps: 3-7 ordered tasks, each tiny, concrete, doable in a day or less, each one a single sentence. No deadlines, no day counts, no blame. Output strict JSON: {"tasks":[{"title":string}]}. Reply in the user's language.` },
      { role: 'user', content: `Goal: ${i.title.slice(0, 200)}` },
    ], { maxTokens: 320 });
    const parsed = parseJsonObject(out.content) as { tasks?: { title?: unknown }[] } | null;
    if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length >= 3 && outputOk(...parsed.tasks.map((t) => String(t.title ?? '')))) {
      return clampTasks(parsed.tasks.map((t) => ({ id: '', title: String(t.title ?? '') , done: false })));
    }
    return fallbackSplit(i.title);
  } catch { return fallbackSplit(i.title); }
}

/**
 * The score: 60% of the way through the tasks + 40% for steady updates (the best ever run of
 * consecutive done-updates). A score never decreases: done tasks stay done and the best streak
 * never shrinks. "Can't today" costs nothing.
 */
export function computeScore(tasks: SplitTask[], updates: { doneCurrent: boolean }[]): number {
  const total = Math.max(1, tasks.length);
  const done = tasks.filter((t) => t.done).length;
  const donePart = (done / total) * 60;
  let streak = 0, best = 0;
  for (const u of updates) {
    if (u.doneCurrent) { streak += 1; best = Math.max(best, streak); } else streak = 0;
  }
  const streakPart = (Math.min(best, total) / total) * 40;
  return Math.max(0, Math.min(100, Math.round(donePart + streakPart)));
}

/** One warm sentence about the update; fallback is static. */
export async function phraseUpdateNote(glm: GlmClient, i: { goal: string; doneCurrent: boolean; score: number; note?: string; locale?: string | null }): Promise<string> {
  try {
    const out = await glm.chat([
      { role: 'system', content: `One warm sentence acknowledging an update on a personal goal (Kaizen: no blame, no pressure, no "you should"). Output strict JSON: {"line":string}. Reply in the user's language.` },
      { role: 'user', content: `Goal: ${i.goal}\nStep done: ${i.doneCurrent ? 'yes' : 'not this time'}\nTheir note: ${i.note ?? '(none)'}` },
    ], { maxTokens: 120 });
    const parsed = parseJsonObject(out.content) as { line?: unknown } | null;
    if (parsed && typeof parsed.line === 'string' && outputOk(parsed.line)) return parsed.line.trim().slice(0, 200);
    return i.doneCurrent ? 'Another step behind you — that is how goals quietly get done.' : 'Thanks for checking in; the goal is still there when you are.';
  } catch { return i.doneCurrent ? 'Another step behind you — that is how goals quietly get done.' : 'Thanks for checking in; the goal is still there when you are.'; }
}

/** True when the user may call the model with their own written words. */
export const canUseModelForGoal = async (db: Db, userId: string) =>
  (await activeConsents(db, userId)).has('JOURNAL_AI_SHARING');

export const goalView = (g: {
  id: string; titleEnc: string; tasksJson: string; score: number; status: string; createdAt: Date; completedAt: Date | null;
  updates?: { id: string; noteEnc: string | null; doneCurrent: boolean; score: number; createdAt: Date }[];
}, decrypt: (s: string) => string) => {
  const tasks: SplitTask[] = JSON.parse(g.tasksJson);
  const currentIndex = tasks.findIndex((t) => !t.done);
  return {
    id: g.id, title: decrypt(g.titleEnc), status: g.status, score: g.score, createdAt: g.createdAt, completedAt: g.completedAt,
    tasks: tasks.map((t, i) => ({ ...t, state: t.done ? 'DONE' : i === currentIndex ? 'CURRENT' : 'TODO' })),
    currentIndex,
    updates: (g.updates ?? []).map((u) => ({ id: u.id, note: u.noteEnc ? decrypt(u.noteEnc) : null, doneCurrent: u.doneCurrent, score: u.score, createdAt: u.createdAt })),
  };
};
