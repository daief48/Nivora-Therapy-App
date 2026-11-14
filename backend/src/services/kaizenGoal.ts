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

export interface SplitTask { id: string; title: string; why?: string; done: boolean }

/** The anchor used when the user gave none and the model is unavailable or silent. */
export const FALLBACK_ANCHOR = 'Attach it to something you already do every day.';

/** The deterministic fallback split when the model is unavailable or its output is rejected. */
export function fallbackSplit(title: string, timePerDayMin?: number | null): SplitTask[] {
  const t = title.trim().replace(/\s+/g, ' ').slice(0, 80);
  const small = typeof timePerDayMin === 'number' && timePerDayMin > 0;
  if (small) { // a tiny daily budget: the wording itself promises the smallest possible slice
    const m = Math.min(120, Math.max(1, Math.round(timePerDayMin!)));
    return [
      { id: 'f1', title: `Write one honest line about what "${t}" means for you.`, why: 'Knowing why it matters makes the smallest step easier to start.', done: false },
      { id: 'f2', title: `Give "${t}" just ${m} minute${m === 1 ? '' : 's'} today — the smallest slice of it counts.`, why: `A ${m}-minute slice fits even the fullest day.`, done: false },
      { id: 'f3', title: 'Note in one line how that small slice felt, without judging it.', why: 'Noticing something, however small, is the Kaizen way.', done: false },
    ];
  }
  return [
    { id: 'f1', title: `Write one honest line about what "${t}" means for you.`, why: 'Knowing why it matters makes the smallest step easier to start.', done: false },
    { id: 'f2', title: `Give "${t}" two minutes today — no more than two.`, why: 'Two minutes is too small to fail at.', done: false },
    { id: 'f3', title: 'Note in one line how it felt, without judging it.', why: 'Noticing something, however small, is the Kaizen way.', done: false },
  ];
}

/** The remaining tasks made smaller without a model: the current step, sliced down. */
export const smallerFallbackSplit = (currentTitle: string): SplitTask[] =>
  fallbackSplit(currentTitle).map((t, i) => ({ id: `r${i + 1}`, title: `A smaller slice: ${t.title}`, why: t.why, done: false }));

const clampTasks = (tasks: SplitTask[]): SplitTask[] =>
  tasks.slice(0, 7).map((t, i) => ({
    id: t.id || `t${i + 1}`,
    title: String(t.title).trim().slice(0, 160),
    ...(typeof t.why === 'string' && t.why.trim() ? { why: t.why.trim().slice(0, 200) } : {}),
    done: false,
  }));

export interface SplitResult { tasks: SplitTask[]; anchor: string | null }

/**
 * The AI split of the user's goal into 3–7 small steps, plus one habit-stacking anchor. With
 * `smaller`, the remaining steps are re-split to half their demand (adaptive step sizing after
 * two HARD reports). Every string of the model output is validated; anything rejected falls back
 * deterministically. Falls back to the deterministic split.
 */
export async function splitGoalWithAnchor(glm: GlmClient, i: {
  title: string; currentTitle?: string; smaller?: boolean; timePerDayMin?: number | null; locale?: string | null;
  /** The person's own clarifying answers (guided flow), appended as context for the split. */
  details?: string[];
}): Promise<SplitResult> {
  const time = typeof i.timePerDayMin === 'number' && i.timePerDayMin > 0 ? Math.min(120, Math.round(i.timePerDayMin)) : null;
  const timeLine = time ? ` The user has about ${time} minutes a day for this: each step fits within ~${time} minutes, or is the smallest possible slice of it.` : '';
  const smallerLine = i.smaller ? ' The user found this too hard twice: make each remaining step HALF as demanding, more concrete.' : '';
  try {
    const out = await glm.chat([
      { role: 'system', content: `You split a personal goal into small Kaizen steps: 3-7 ordered tasks, each tiny, concrete, doable in a day or less, each one a single sentence.${timeLine}${smallerLine} Also give one habit-stacking anchor: a short line attaching the first step to something the user already does every day. No deadlines, no day counts, no blame. Output strict JSON: {"tasks":[{"title":string,"why":string}],"anchor":string} — each "why" is one short sentence (max 200 chars) on why the step matters. Reply in the user's language.` },
      { role: 'user', content: i.currentTitle ? `Goal: ${i.title.slice(0, 200)}\nRemaining steps, starting with the current one: ${i.currentTitle.slice(0, 200)}` : `Goal: ${i.title.slice(0, 200)}${i.details?.length ? `
In their own words: ${i.details.join('; ').slice(0, 300)}` : ''}` },
    ], { maxTokens: 480 });
    const parsed = parseJsonObject(out.content) as { tasks?: { title?: unknown; why?: unknown }[]; anchor?: unknown } | null;
    if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length >= 3 && outputOk(...parsed.tasks.map((t) => String(t?.title ?? '')))) {
      const anchor = typeof parsed.anchor === 'string' && outputOk(parsed.anchor) ? parsed.anchor.trim().slice(0, 200) : null;
      return {
        tasks: clampTasks(parsed.tasks.map((t) => ({
          id: '', title: String(t?.title ?? ''),
          ...(typeof t?.why === 'string' && outputOk(t.why) ? { why: t.why } : {}),
          done: false,
        }))),
        anchor,
      };
    }
    return { tasks: fallbackSplit(i.title, i.timePerDayMin), anchor: null };
  } catch { return { tasks: fallbackSplit(i.title, i.timePerDayMin), anchor: null }; }
}

/** The AI split of the user's goal into 3–7 small steps; falls back to the deterministic split. */
export async function splitGoal(glm: GlmClient, i: { title: string; timePerDayMin?: number | null; locale?: string | null }): Promise<SplitTask[]> {
  return (await splitGoalWithAnchor(glm, i)).tasks;
}

/**
 * The score: 60% of the way through the tasks + 40% for steady updates (the best ever run of
 * consecutive done-updates). A score never decreases: done tasks stay done and the best streak
 * never shrinks. "Can't today" costs nothing. The breakdown shows where the score comes from.
 */
export function computeScoreDetailed(tasks: SplitTask[], updates: { doneCurrent: boolean }[]): { score: number; donePart: number; streakPart: number } {
  const total = Math.max(1, tasks.length);
  const done = tasks.filter((t) => t.done).length;
  let streak = 0, best = 0;
  for (const u of updates) {
    if (u.doneCurrent) { streak += 1; best = Math.max(best, streak); } else streak = 0;
  }
  const donePart = Math.round((done / total) * 60);
  const streakPart = Math.round((Math.min(best, total) / total) * 40);
  if (done >= tasks.length) return { score: 100, donePart: Math.min(donePart, 60), streakPart: Math.min(streakPart, 40) }; // every step done: the goal is whole
  const score = Math.max(0, Math.min(100, Math.round((done / total) * 60 + (Math.min(best, total) / total) * 40)));
  return { score, donePart, streakPart };
}

export const computeScore = (tasks: SplitTask[], updates: { doneCurrent: boolean }[]): number => computeScoreDetailed(tasks, updates).score;

/** The warm line shown when the model is unavailable or the user has not consented to it. */
export const updateNoteFallback = (doneCurrent: boolean) =>
  doneCurrent ? 'Another step behind you — that is how goals quietly get done.' : 'Thanks for checking in; the goal is still there when you are.';

/** One warm sentence about the update; fallback is static. */
export async function phraseUpdateNote(glm: GlmClient, i: { goal: string; doneCurrent: boolean; score: number; note?: string; locale?: string | null }): Promise<string> {
  try {
    const out = await glm.chat([
      { role: 'system', content: `One warm sentence acknowledging an update on a personal goal (Kaizen: no blame, no pressure, no "you should"). Output strict JSON: {"line":string}. Reply in the user's language.` },
      { role: 'user', content: `Goal: ${i.goal}\nStep done: ${i.doneCurrent ? 'yes' : 'not this time'}\nTheir note: ${i.note ?? '(none)'}` },
    ], { maxTokens: 120 });
    const parsed = parseJsonObject(out.content) as { line?: unknown } | null;
    if (parsed && typeof parsed.line === 'string' && outputOk(parsed.line)) return parsed.line.trim().slice(0, 200);
    return updateNoteFallback(i.doneCurrent);
  } catch { return updateNoteFallback(i.doneCurrent); }
}

/** The line shown when the model is unavailable or the user has not consented to it. */
export const MILESTONE_FALLBACK = 'Halfway there — worth noticing what has been working.';

/** One warm line when the user's own goal passes halfway; fallback is static. */
export async function phraseMilestone(glm: GlmClient, i: { goal: string; locale?: string | null }): Promise<string> {
  try {
    const out = await glm.chat([
      { role: 'system', content: `The user just passed halfway on their own goal; one short sentence asking what made it work so far; no praise-overload, no blame. Output strict JSON: {"line":string}. Reply in the user's language.` },
      { role: 'user', content: `Goal: ${i.goal.slice(0, 200)}` },
    ], { maxTokens: 120 });
    const parsed = parseJsonObject(out.content) as { line?: unknown } | null;
    if (parsed && typeof parsed.line === 'string' && outputOk(parsed.line)) return parsed.line.trim().slice(0, 200);
    return MILESTONE_FALLBACK;
  } catch { return MILESTONE_FALLBACK; }
}

/** True when the user may call the model with their own written words. */
export const canUseModelForGoal = async (db: Db, userId: string) =>
  (await activeConsents(db, userId)).has('JOURNAL_AI_SHARING');

/**
 * Momentum over the last 14 days of updates: enough done steps (or a fresh run of them) is
 * RISING, any activity is STEADY, silence is RESTING. Deterministic and simple.
 */
export function momentumOf(updates: { doneCurrent: boolean; createdAt: Date }[], now = new Date()): 'RISING' | 'STEADY' | 'RESTING' {
  const recent = updates
    .filter((u) => now.getTime() - u.createdAt.getTime() <= 14 * 86_400_000)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (recent.filter((u) => u.doneCurrent).length >= 3) return 'RISING';
  let streak = 0;
  for (const u of recent) {
    if (u.doneCurrent) { streak += 1; if (streak >= 2) return 'RISING'; } else streak = 0;
  }
  return recent.length > 0 ? 'STEADY' : 'RESTING';
}

/**
 * Strict read for WRITERS: the parsed task list, or null when no source (encrypted column, legacy plaintext) could be decrypted and parsed.
 * A writer must refuse on null instead of saving an empty list over tasks it merely failed to read.
 */
export function readGoalTasksStrict(g: { tasksEnc?: string | null; tasksJson?: string | null }, decrypt: (s: string) => string): SplitTask[] | null {
  for (const raw of [g.tasksEnc ? () => decrypt(g.tasksEnc!) : null, g.tasksJson ? () => g.tasksJson! : null]) {
    if (!raw) continue;
    try { const v = JSON.parse(raw()); if (Array.isArray(v)) return v as SplitTask[]; } catch { /* try the next source */ }
  }
  return null;
}
/** Reads a goal's tasks for display: same as the strict read but a failure reads as an empty list; never throws. Writers use readGoalTasksStrict. */
export const readGoalTasks = (g: { tasksEnc?: string | null; tasksJson?: string | null }, decrypt: (s: string) => string): SplitTask[] => readGoalTasksStrict(g, decrypt) ?? [];
/** Column values to write for a goal's tasks: encrypted, and the legacy plaintext column cleared. */
export const goalTasksColumns = (tasks: SplitTask[], encrypt: (s: string) => string) => ({ tasksEnc: encrypt(JSON.stringify(tasks)), tasksJson: null as string | null });

export const goalView = (g: {
  id: string; titleEnc: string; tasksJson?: string | null; tasksEnc?: string | null; score: number; status: string; createdAt: Date; completedAt: Date | null;
  anchorEnc?: string | null; timePerDayMin?: number | null; reminderMin?: number | null;
  updates?: { id: string; noteEnc: string | null; doneCurrent: boolean; score: number; createdAt: Date }[];
}, decrypt: (s: string) => string) => {
  const tasks: SplitTask[] = readGoalTasks(g, decrypt);
  const currentIndex = tasks.findIndex((t) => !t.done);
  const updates = g.updates ?? [];
  const { donePart, streakPart } = computeScoreDetailed(tasks, updates.map((u) => ({ doneCurrent: u.doneCurrent })));
  return {
    id: g.id, title: decrypt(g.titleEnc), status: g.status, score: g.score, createdAt: g.createdAt, completedAt: g.completedAt,
    ...(g.anchorEnc ? { anchor: decrypt(g.anchorEnc) } : {}),
    ...(g.timePerDayMin != null ? { timePerDayMin: g.timePerDayMin } : {}),
    ...(g.reminderMin != null ? { reminderMin: g.reminderMin } : {}),
    tasks: tasks.map((t, i) => ({
      id: t.id, title: t.title, done: t.done, state: t.done ? 'DONE' : i === currentIndex ? 'CURRENT' : 'TODO',
      ...(t.why ? { why: t.why } : {}),
    })),
    currentIndex,
    breakdown: { donePart, streakPart },
    momentum: momentumOf(updates),
    updates: updates.map((u) => ({ id: u.id, note: u.noteEnc ? decrypt(u.noteEnc) : null, doneCurrent: u.doneCurrent, score: u.score, createdAt: u.createdAt })),
  };
};

// ---- Feature 12: starter templates (static constants; titles in the user's locale, others fall back to en) ----

interface Loc { en: string; bn: string }
interface GoalTemplate { id: string; title: Loc; tasks: { title: Loc; why: Loc }[] }

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: 'daily-reading',
    title: { en: 'Read a little every day', bn: 'প্রতিদিন একটু পড়া' },
    tasks: [
      { title: { en: 'Pick one book and put it where you sit', bn: 'একটি বই বেছে নিন এবং বসার জায়গায় রাখুন' }, why: { en: 'The book in sight is the book that gets read.', bn: 'চোখের সামনে থাকলে বইটি পড়া হয়।' } },
      { title: { en: 'Read one page today', bn: 'আজ এক পাতা পড়ুন' }, why: { en: 'One page is too small to fail at.', bn: 'এক পাতা পড়া ব্যর্থ হওয়ার মতো ছোট নয়।' } },
      { title: { en: 'Note in one line what stayed with you', bn: 'যা মনে রেখেছে তা এক লাইনে লিখুন' }, why: { en: 'Noticing makes the habit yours.', bn: 'খেয়াল করলে অভ্যাসটি নিজের হয়ে যায়।' } },
    ],
  },
  {
    id: 'daily-walk',
    title: { en: 'Walk a little every day', bn: 'প্রতিদিন একটু হাঁটা' },
    tasks: [
      { title: { en: 'Keep your shoes by the door', bn: 'জুতা দরজার কাছে রাখুন' }, why: { en: 'The smallest step starts before the walk does.', bn: 'হাঁটা শুরুর আগেই ছোট প্রস্তুতি শুরু হয়।' } },
      { title: { en: 'Walk to the end of your street and back', bn: 'লেনের শেষ পর্যন্ত হেঁটে ফিরুন' }, why: { en: 'A two-minute walk still counts, fully.', bn: 'দুই মিনিটের হাঁটাও পুরোপুরি গণ্য হয়।' } },
      { title: { en: 'Notice one thing you saw on the way', bn: 'পথে দেখা একটি জিনিস খেয়াল করুন' }, why: { en: 'Attention turns a walk into a rest.', bn: 'মনোযোগ হাঁটাকে বিশ্রামে পরিণত করে।' } },
    ],
  },
  {
    id: 'daily-meditation',
    title: { en: 'Sit quietly for a few minutes', bn: 'কয়েক মিনিট শান্তভাবে বসা' },
    tasks: [
      { title: { en: 'Choose a time and a spot for sitting', bn: 'বসার সময় ও জায়গা ঠিক করুন' }, why: { en: 'A fixed spot makes starting automatic.', bn: 'নির্দিষ্ট জায়গা শুরু করা সহজ করে।' } },
      { title: { en: 'Take five slow breaths, eyes closed', bn: 'চোখ বন্ধ করে পাঁচটি ধীর শ্বাস নিন' }, why: { en: 'Five breaths are enough for day one.', bn: 'প্রথম দিনের জন্য পাঁচ শ্বাসই যথেষ্ট।' } },
      { title: { en: 'Add one minute only when it feels easy', bn: 'সহজ লাগলেই কেবল এক মিনিট বাড়ান' }, why: { en: 'Growth stays gentle when it is chosen.', bn: 'নিজের পছন্দে বাড়ালে অভ্যাস সহজ থাকে।' } },
    ],
  },
  {
    id: 'sleep-routine',
    title: { en: 'Wind down before sleep', bn: 'ঘুমের আগে শিথিল হওয়া' },
    tasks: [
      { title: { en: 'Park your phone outside the bedroom tonight', bn: 'আজ রাতে ফোন শোবার ঘরের বাইরে রাখুন' }, why: { en: 'Distance from the screen is distance from the noise.', bn: 'স্ক্রিন থেকে দূরত্বই কোলাহল থেকে দূরত্ব।' } },
      { title: { en: 'Dim the lights ten minutes before bed', bn: 'শোওয়ার দশ মিনিট আগে আলো কমান' }, why: { en: 'The body listens to light more than to willpower.', bn: 'শরীর ইচ্ছাশক্তির চেয়ে আলোকে বেশি মানে।' } },
      { title: { en: 'Write down tomorrow\u2019s one thing, then close the notebook', bn: 'কালকের একটি কাজ লিখে খাতা বন্ধ করুন' }, why: { en: 'A parked worry stops following you to bed.', bn: 'লিখে রাখলে দুশ্চিন্তা ঘুমের সঙ্গে আসে না।' } },
    ],
  },
];

/** The templates in the user's locale (bn for Bangla, en otherwise). */
export const goalTemplateView = (locale?: string | null) => {
  const lang = locale === 'bn' ? 'bn' : 'en';
  return GOAL_TEMPLATES.map((t) => ({
    id: t.id, title: t.title[lang],
    tasks: t.tasks.map((x) => ({ title: x.title[lang], why: x.why[lang] })),
  }));
};

/** The title + SplitTasks of a template (no AI, no model call), or null when the id is unknown. */
export const goalTasksFromTemplate = (templateId: string, locale?: string | null): { title: string; tasks: SplitTask[] } | null => {
  const t = GOAL_TEMPLATES.find((x) => x.id === templateId);
  if (!t) return null;
  const lang = locale === 'bn' ? 'bn' : 'en';
  return { title: t.title[lang], tasks: t.tasks.map((x, i) => ({ id: `t${i + 1}`, title: x.title[lang], why: x.why[lang], done: false })) };
};
