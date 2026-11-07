import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { buildWellnessContext, recentHighStress } from './contextService.js';
import { formatKnowledge, type Retriever } from './knowledge/retriever.js';
import { lifeSummaryOf, listMemories, rankRelevant, type MemoryView } from './memoryService.js';
import { topicBlock } from './topicPrompts.js';
import { assessmentContextBlock } from './assessmentService.js';
import { unpackTopic } from './topicService.js';
import { RESUME_GAP_MS } from './sittingTime.js';
import { computeState, gapInDays, gapPhrase, localParts, partOfDayOf, type PartOfDay, type SessionState } from './sessionEngine.js';
import type { Lang } from './safetyService.js';
import { ACTION_RULES } from './actionMenu.js';
import { CALLBACK_DIRECTIVE, languageDirective, SAFETY_LAYER, SPOKEN_ADDENDUM } from './systemPrompt.js';
import {
  continuityEnabled, getActivePlan, getHomework, getProgramHomework, getProgramNotes, getRecentNotes, getTopThemes, type PlanContent, type StoredNote,
} from './therapyData.js';
import { activeTaskOf, taskPromptLine } from './kaizenTask.js';
import { ensureScopeCard, scopeBlock } from './scopeCard.js';

/** Hard cap (characters) for everything we add on top of the base system prompt and language directive. */
export const CONTEXT_CHAR_BUDGET = 6000;
/** Cap of the pinned scope-card block; it counts against CONTEXT_CHAR_BUDGET but is never trimmed by fitSections. */
export const SCOPE_BLOCK_MAX = 1600;

export interface SessionContextDeps { db: Db; cipher: Cipher; systemPrompt: string; retriever?: Retriever }
export interface SessionRow {
  id: string; userId: string; phase: string; lengthMin: number; startedAt: Date; isIntake: boolean; rememberThis: boolean;
  moodBefore: number | null; riskFlag: string; sessionType?: string; topicId?: string | null;
  /** Program sittings only; absent / null for legacy standalone sessions. */
  programId?: string | null; dayNumber?: number | null; plannedMinutes?: number | null; usedSeconds?: number | null;
}
export interface ProgramInfo { title: string; goal: string | null; plannedDays: number; dayNumber: number }
export interface SessionResolution { state: SessionState; guided: boolean; continuity: boolean; plan: PlanContent | null; program?: ProgramInfo | null; time?: TimeContext; resuming?: boolean }
export interface SessionContextInput {
  userId: string; sessionId: string; lang: Lang | 'auto'; spoken?: boolean; userText: string;
  /** Already resolved by the caller (conversationService) so the persisted phase matches the prompt. */
  resolved?: SessionResolution;
  /** Safety: any risk this turn / in the person's state drops the topic scope entirely (no scope block). */
  skipScope?: boolean;
}

/** A session started with a length, as an intake, or with a mood check-in is guided. Sessions of users with continuity on are guided too (see resolveSession). */
export const isGuided = (s: Pick<SessionRow, 'lengthMin' | 'isIntake' | 'moodBefore'> & { programId?: string | null }) => s.lengthMin > 0 || s.isIntake || s.moodBefore !== null || !!s.programId;

export async function resolveSession(
  d: { db: Db; cipher: Cipher }, s: SessionRow, userText: string | undefined, now = new Date(),
): Promise<SessionResolution> {
  const continuity = s.rememberThis && (await continuityEnabled(d.db, s.userId));
  // Always-on structure for opted-in users: plain chats and calls get the phase engine, safety layer and notes too (open-ended ones stay in CORE).
  const guided = isGuided(s) || continuity;
  const plan = continuity ? (await getActivePlan(d.db, d.cipher, s.userId))?.plan ?? null : null;
  const messageCount = await d.db.sessionMessage.count({ where: { sessionId: s.id } });
  const opts: Parameters<typeof computeState>[3] = { lastUserText: userText, approach: plan?.approach, pace: plan?.pace };
  let program: ProgramInfo | null = null;
  if (s.programId) {
    const p = await d.db.sessionProgram.findFirst({ where: { id: s.programId, userId: s.userId } });
    if (p) {
      program = { title: d.cipher.decrypt(p.titleEncrypted), goal: p.goalEncrypted ? d.cipher.decrypt(p.goalEncrypted) : null, plannedDays: p.plannedDays, dayNumber: s.dayNumber ?? 1 };
      opts.program = { dayNumber: program.dayNumber, plannedDays: program.plannedDays };
    }
  }
  if ((continuity || s.programId) && !s.isIntake && s.phase === 'OPENING') {
    // Periodic progress review: counted inside the program for sittings, across the user's sessions for legacy ones.
    opts.finalizedCount = await d.db.therapySession.count({ where: { userId: s.userId, isIntake: false, finalizedAt: { not: null }, ...(s.programId ? { programId: s.programId } : {}) } });
  }
  if (s.phase === 'OPENING') opts.highStress = await recentHighStress(d.db, s.userId).catch(() => false);
  let time: TimeContext | undefined;
  if (program) {
    time = await timeContextOf(d.db, s, now).catch(() => undefined);
    if (time && s.phase === 'OPENING') {
      let hasCallback = false;
      if (continuity && !s.isIntake) {
        const notes = await getProgramNotes(d.db, d.cipher, s.userId, s.programId!, 2, s.id).catch(() => []);
        hasCallback = callbackCandidates(notes).length > 0;
      }
      opts.rhythm = { partOfDay: time.partOfDay, gapDays: time.gapDays, hasCallback };
    }
  }
  // Coming back to a paused sitting: it already has messages and the last one is more than RESUME_GAP_MS old (the person stepped away).
  let resuming = false;
  if (s.programId && messageCount > 0) {
    const last = await d.db.sessionMessage.findFirst({ where: { sessionId: s.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    resuming = !!last && now.getTime() - last.createdAt.getTime() > RESUME_GAP_MS;
  }
  return { state: computeState(s, messageCount, now, opts), guided, continuity, plan, program, ...(time ? { time } : {}), ...(resuming ? { resuming } : {}) };
}

// ---------- time awareness and callbacks ----------

export interface TimeContext { partOfDay: PartOfDay; weekday: string; gapDays: number | null }
/** Program sittings only. Uses the sitting's own start time (stable across the sitting) and the previous sitting of the SAME program. */
async function timeContextOf(db: Db, s: SessionRow, now: Date): Promise<TimeContext | undefined> {
  if (!s.programId) return undefined;
  const [u, prev] = await Promise.all([
    db.user.findUnique({ where: { id: s.userId }, select: { timezone: true } }),
    db.therapySession.findFirst({ where: { userId: s.userId, programId: s.programId, id: { not: s.id }, startedAt: { lt: s.startedAt } }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
  ]);
  return timeContextFrom(s.startedAt ?? now, prev?.startedAt ?? null, u?.timezone);
}
export function timeContextFrom(at: Date, prev: Date | null, tz?: string | null): TimeContext {
  const p = localParts(at, tz);
  return { partOfDay: partOfDayOf(p.hour), weekday: p.weekday, gapDays: prev ? gapInDays(prev, at, tz) : null };
}

/** The person left a program sitting and came back to it later (the sitting only paused). */
export const RESUMING_BLOCK = 'RESUMING: the person stepped away from this sitting and has just come back. Welcome them back in one short, warm line, briefly recall where you were together, and carry on from the current step. Do not restart, do not re-introduce yourself or the topic, and never mention timers, clocks or minutes.';

export function timeBlock(t: TimeContext): string {
  const late = t.partOfDay === 'late night' ? ' It is late night for them: be gentle and short, no big exploration, and softly encourage rest.' : '';
  return `THEIR RHYTHM (private background; use it only to sound human):\nFor them it is ${t.partOfDay} on a ${t.weekday}. ${gapPhrase(t.gapDays)}${late}\nGreet naturally in the user's language, fitting the time of day. If they have been away a few days, simply say it is nice to see them again, with NO guilt and no questions about why. Never mention streaks, counts of days in a row, the clock or a timer.`;
}

/** 1-3 concrete things, in the user's own words, from the newest notes. Crisis sittings are skipped; never a list to recite. */
export function callbackCandidates(notes: StoredNote[]): string[] {
  const out: string[] = [];
  const add = (x?: string) => {
    const v = x?.trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(cut(v, 100));
  };
  const usable = notes.filter((n) => n.riskFlag !== 'HIGH').slice(0, 2);
  for (const n of usable) { add(n.content.unresolved[0]); add(n.content.keyInsights[0]); }
  for (const n of usable) add(n.content.themes[0]);
  return out.slice(0, 3);
}
export function callbackBlock(c: string[]): string {
  if (!c.length) return '';
  return `OPTIONAL CALLBACKS (things they said in earlier sittings; use AT MOST ONE, only if it fits, as a soft "last time you mentioned ..." question; skip it if they arrive with something else; never recite or list them):\n${c.map((x) => `- ${x}`).join('\n')}`;
}

// ---------- budgeting ----------

export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max - 1));
  const at = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf(' '));
  return (at > max * 0.6 ? head.slice(0, at) : head).trimEnd() + '…';
}

export interface Section { text: string; max: number }
/** Applies each section's own cap, then trims lowest-priority sections (listed LAST) first until the total fits the budget. */
export function fitSections(sections: Section[], budget = CONTEXT_CHAR_BUDGET): string[] {
  const out = sections.map((s) => (s.text ? cut(s.text, s.max) : ''));
  let total = out.reduce((n, t) => n + (t ? t.length + 2 : 0), 0);
  for (let i = out.length - 1; i >= 0 && total > budget; i--) {
    const over = total - budget, len = out[i]!.length;
    if (!len) continue;
    const next = len - over < 160 ? '' : cut(out[i]!, len - over);
    total -= len + 2 - (next ? next.length + 2 : 0);
    out[i] = next;
  }
  return out;
}

// ---------- section builders ----------

const daysAgo = (d: Date, now = new Date()) => {
  const n = Math.max(0, Math.round((now.getTime() - d.getTime()) / 86_400_000));
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};
const list = (a: string[], n = 3) => a.filter(Boolean).slice(0, n).join('; ');

function planBlock(p: PlanContent): string {
  const l = ['TREATMENT PLAN (agreed with the user, they can change it; follow it gently, never announce it):'];
  l.push('Goals: ' + p.goals.map((g) => g.title + (g.note ? ` (${g.note})` : '')).join(' | '));
  if (p.focusAreas.length) l.push('Focus areas: ' + p.focusAreas.join(', '));
  l.push(`Preferred approach: ${p.approach}; pace: ${p.pace}; tone: ${p.tone === 'DIRECT' ? 'more direct and concrete' : 'warm and gentle'}; language: ${p.language}`);
  if (p.whatHelps) l.push('What has helped: ' + p.whatHelps);
  if (p.whatDoesnt) l.push('What has not helped: ' + p.whatDoesnt);
  if (p.background) l.push('Background: ' + p.background);
  return l.join('\n');
}

function noteLine(n: StoredNote, full: boolean): string {
  const c = n.content;
  const mood = n.moodBefore != null || n.moodAfter != null ? ` (mood ${n.moodBefore ?? '?'} -> ${n.moodAfter ?? '?'})` : '';
  if (!full) return `- ${daysAgo(n.startedAt)}: ${cut(c.summary, 110)}${c.themes.length ? ` [${list(c.themes, 2)}]` : ''}`;
  const parts = [`- ${daysAgo(n.startedAt)}${mood}: ${cut(c.summary, 360)}`];
  if (c.unresolved.length) parts.push(`  Left open: ${cut(list(c.unresolved), 160)}`);
  if (c.keyInsights.length) parts.push(`  Their insight: ${cut(list(c.keyInsights, 2), 160)}`);
  if (c.homework.length) parts.push(`  Task given: ${cut(list(c.homework, 2), 120)}`);
  if (c.progressNote) parts.push(`  Progress: ${cut(c.progressNote, 140)}`);
  return parts.join('\n');
}

/** The newest note in full, the next two in brief. Everything older only enters through relevance (see memoryBlock). */
function notesBlock(notes: StoredNote[]): string {
  if (!notes.length) return '';
  const lines = notes.slice(0, 3).map((n, i) => noteLine(n, i === 0));
  return `EARLIER SESSION NOTES (private background, newest first):\n${lines.join('\n')}`;
}

/** Notes beyond this many are only represented by their themes / insights digest (rolling summarisation). */
export const FULL_NOTES = 10;
const RELEVANT_LIMIT = 5;
const digestLine = (n: StoredNote) => `- ${daysAgo(n.startedAt)}: ${[list(n.content.themes, 3), list(n.content.keyInsights, 2)].filter(Boolean).join('; ')}`;
const noteSearchText = (n: StoredNote, full: boolean) =>
  full ? [n.content.summary, ...n.content.themes, ...n.content.keyInsights, ...n.content.unresolved, ...n.content.agenda].join(' ')
    : [...n.content.themes, ...n.content.keyInsights].join(' ');

/**
 * Long-term memory for the prompt: a pinned handful (life summary, what helps) plus the few facts / older notes that are most
 * relevant to what the user just said. Never a dump. Only called when continuity is on.
 */
export function memoryBlock(userText: string, mems: MemoryView[], olderNotes: StoredNote[], now = new Date()): string {
  const life = lifeSummaryOf(mems);
  const helps = mems.filter((m) => m.kind === 'HELPS' || m.kind === 'DOESNT_HELP').slice(0, 3);
  const pinnedIds = new Set(helps.map((m) => m.id));
  const cands = [
    ...mems.filter((m) => m.kind !== 'SUMMARY' && !pinnedIds.has(m.id)).map((m) => ({ text: m.text, at: m.updatedAt ?? m.createdAt, line: `- ${m.text}` })),
    ...olderNotes.map((n, i) => {
      const full = i + 3 < FULL_NOTES;
      return { text: noteSearchText(n, full), at: n.startedAt, line: full ? noteLine(n, true) : digestLine(n) };
    }),
  ];
  const relevant = rankRelevant(userText, cands, RELEVANT_LIMIT, now);
  const lines: string[] = [];
  if (life) lines.push(`Their life so far: ${cut(life.text, 600)}`);
  if (helps.length) lines.push('What helps / does not help them: ' + helps.map((m) => m.text).join('; '));
  if (relevant.length) lines.push('Possibly relevant to what they just said:\n' + relevant.map((r) => r.line).join('\n'));
  if (!lines.length) return '';
  return 'WHAT YOU REMEMBER ABOUT THEM (private background from earlier sessions; use it naturally and sparingly, at most one detail per reply and only when it fits what they say; never recite it, never list it, never say you are reading notes):\n' + lines.join('\n');
}

// Headers written by buildWellnessContext (contextService.ts), in this order, always last: saved memories, then past-session summaries.
const MEMORIES_HEADER = '\nThings the user asked you to remember:';
const SUMMARIES_HEADER = '\nShort summaries of earlier conversations:';
/**
 * Memory hygiene: material from earlier sessions must not reach the prompt when it was not consented to. Summaries of earlier
 * conversations need continuity (opt-in AND rememberThis); memories the user explicitly asked to keep are dropped when this
 * session is rememberThis=false. Check-in, sleep and Kaizen lines (current data, not session history) always stay.
 */
export function withoutEarlierSessionMaterial(wellness: string, keep: { memories: boolean; summaries: boolean }): string {
  const m = wellness.indexOf(MEMORIES_HEADER), sm = wellness.indexOf(SUMMARIES_HEADER);
  if (m < 0 && sm < 0) return wellness;
  const first = Math.min(...[m, sm].filter((i) => i >= 0));
  const mem = m >= 0 ? wellness.slice(m, sm > m ? sm : undefined) : '';
  const sums = sm >= 0 ? wellness.slice(sm) : '';
  const out = (wellness.slice(0, first) + (keep.memories ? mem : '') + (keep.summaries ? sums : '')).trimEnd();
  return out.split('\n').length > 1 ? out : '';
}

export async function buildSessionSystemPrompt(d: SessionContextDeps, i: SessionContextInput): Promise<string> {
  const row = await d.db.therapySession.findFirst({ where: { id: i.sessionId, userId: i.userId } });
  if (!row) return `${d.systemPrompt}\n\n${languageDirective(i.lang)}`;
  const res = i.resolved ?? (await resolveSession(d, row, i.userText));
  const layered = res.guided || res.continuity;

  // Static first (cache-friendly prefix): persona, language, action-offer rules. Everything person- or turn-specific follows.
  const head = `${d.systemPrompt}\n\n${languageDirective(i.lang)}\n\n${ACTION_RULES}`;
  const sections: Section[] = [];
  const add = (text: string, max: number) => sections.push({ text, max });

  // Highest priority first; fitSections trims from the end.
  add(res.guided ? SAFETY_LAYER : '', 500);
  add(res.guided ? `SESSION PHASE (${res.state.phase}):\n${res.state.nextStep}` : '', 1100);
  add(res.resuming ? RESUMING_BLOCK : '', 420);

  let topicText = '';
  if (row.topicId) {
    const t = await d.db.topic.findFirst({ where: { id: row.topicId, userId: i.userId } }).catch(() => null);
    if (t) { const c = unpackTopic(d.cipher, t.encryptedContent); topicText = topicBlock(c.kind, c.label); }
  }
  let name = '';
  if (layered) {
    const prof = await d.db.userProfile.findUnique({ where: { userId: i.userId }, select: { displayName: true } });
    if (prof?.displayName) name = `USER PROFILE:\nName the user likes to be called: ${prof.displayName}`;
  }
  add(name, 200);
  add(topicText, 1100);
  const prog = res.program;
  add(prog ? `PROGRAM: "${cut(prog.title, 80)}", Day ${prog.dayNumber} of ${prog.plannedDays}.${prog.goal ? ` The user's own goal for it: ${cut(prog.goal, 300)}` : ''} Keep today's work connected to this goal; you are an AI companion and never diagnose.` : '', 500);
  // Feature A continuity: the one ongoing Kaizen task, so the AI can naturally ask how it is going.
  if (layered && !row.isIntake) {
    const kzTask = await activeTaskOf(d.db, i.userId).catch(() => null);
    add(kzTask ? taskPromptLine(kzTask, (x) => d.cipher.decrypt(x)) : '', 400);
  }
  add(res.plan ? planBlock(res.plan) : '', 1200);
  add(res.guided && res.time ? timeBlock(res.time) : '', 520);

  let notes: StoredNote[] = [], themes: string[] = [], homework: string[] = [], memory = '', screening = '';
  if (res.continuity) {
    // Coarse band + trend only (never scores or answers); gated like the rest of earlier-session material.
    screening = await assessmentContextBlock(d.db, d.cipher, i.userId).catch(() => '');
    // Program sittings see only their own program's notes and homework (no other programs, no legacy sessions).
    let allNotes = row.programId ? await getProgramNotes(d.db, d.cipher, i.userId, row.programId, 2, i.sessionId).catch(() => []) : await getRecentNotes(d.db, d.cipher, i.userId, 30, i.sessionId).catch(() => []);
    if (row.topicId && !row.programId) {
      // Same-topic notes first (stable); with no same-topic history we fall back to general memory as before.
      const same = new Set((await d.db.therapySession.findMany({ where: { userId: i.userId, topicId: row.topicId }, select: { id: true } })).map((x) => x.id));
      allNotes = [...allNotes.filter((n) => same.has(n.sessionId)), ...allNotes.filter((n) => !same.has(n.sessionId))];
    }
    notes = allNotes.slice(0, 3);
    const mems = await listMemories(d.db, d.cipher, i.userId, { source: 'SESSION', take: 300 }).catch(() => []);
    memory = memoryBlock(i.userText, mems, row.programId ? [] : allNotes.slice(3));
    if (!row.programId) themes = (await getTopThemes(d.db, d.cipher, i.userId, 6).catch(() => [])).map((t) => `${t.label} (${t.count}x)`);
    homework = (await (row.programId ? getProgramHomework(d.db, d.cipher, i.userId, row.programId) : getHomework(d.db, d.cipher, i.userId)).catch(() => [])).slice(0, 6)
      .map((h) => `- ${h.title} [${h.status}${h.feedback ? `, their feedback: ${cut(h.feedback, 80)}` : ''}]`);
  }
  add(homework.length ? `HOMEWORK STATUS:\n${homework.join('\n')}` : '', 600);
  add(notesBlock(notes), 2400);
  add(notes.length || homework.length ? CALLBACK_DIRECTIVE : '', 420);
  // Same consent gate as notes (continuity implies rememberThis); program sittings only, intake sittings get none.
  add(res.continuity && row.programId && !row.isIntake ? callbackBlock(callbackCandidates(notes)) : '', 500);
  add(memory, 1500);
  add(themes.length ? `RECURRING THEMES (patterns across sessions; mention only if relevant): ${themes.join(', ')}` : '', 300);
  add(screening, 500);

  const wellness = await buildWellnessContext(d.db, d.cipher, i.userId, i.sessionId, { includeName: !layered }).catch(() => '');
  add(withoutEarlierSessionMaterial(wellness, { memories: row.rememberThis, summaries: res.continuity && !row.programId }), 1100);
  let knowledge = '';
  if (d.retriever) knowledge = formatKnowledge(await d.retriever.retrieve(i.userText, i.lang).catch(() => []));
  add(knowledge, 1200);

  // The scope card is PINNED: its budget is reserved first and the other sections are fitted into what is left, so heavy context never trims it.
  // Not injected at all when the person already chose to switch, or on any risk.
  let scope = '';
  if (!i.skipScope && row.scopeChoice !== 'SWITCHED') {
    const card = await ensureScopeCard(d, row);
    if (card) scope = cut(scopeBlock(card), SCOPE_BLOCK_MAX);
  }
  const body = fitSections(sections, CONTEXT_CHAR_BUDGET - (scope ? scope.length + 2 : 0)).filter(Boolean).join('\n\n');
  let system = [head, scope, body].filter(Boolean).join('\n\n');
  // Recency matters for smaller models: in the opening reply of a continued session, restate the callback at the very end with a concrete hook.
  if (res.guided && res.state.phase === 'OPENING' && (notes.length || homework.length)) {
    const hook = homework[0] ?? notes[0]?.content.themes[0] ?? cut(notes[0]?.content.summary ?? '', 80);
    if (hook) system += `\n\nFOR THIS REPLY: greet them by name in one short phrase, then gently ask about this from last time, in your own words: "${hook}". After that you may invite a 1-10 mood rating. Two or three short sentences.`;
  }
  if (i.spoken) system += `\n\n${SPOKEN_ADDENDUM}`;
  return system;
}
