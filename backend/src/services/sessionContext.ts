import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { buildWellnessContext, recentHighStress } from './contextService.js';
import { formatKnowledge, type Retriever } from './knowledge/retriever.js';
import { computeState, type SessionState } from './sessionEngine.js';
import type { Lang } from './safetyService.js';
import { CALLBACK_DIRECTIVE, languageDirective, SAFETY_LAYER, SPOKEN_ADDENDUM } from './systemPrompt.js';
import {
  continuityEnabled, getActivePlan, getHomework, getRecentNotes, getTopThemes, type PlanContent, type StoredNote,
} from './therapyData.js';

/** Hard cap (characters) for everything we add on top of the base system prompt and language directive. */
export const CONTEXT_CHAR_BUDGET = 6000;

export interface SessionContextDeps { db: Db; cipher: Cipher; systemPrompt: string; retriever?: Retriever }
export interface SessionRow {
  id: string; userId: string; phase: string; lengthMin: number; startedAt: Date; isIntake: boolean; rememberThis: boolean;
  moodBefore: number | null; riskFlag: string; sessionType?: string;
}
export interface SessionResolution { state: SessionState; guided: boolean; continuity: boolean; plan: PlanContent | null }
export interface SessionContextInput {
  userId: string; sessionId: string; lang: Lang | 'auto'; spoken?: boolean; userText: string;
  /** Already resolved by the caller (conversationService) so the persisted phase matches the prompt. */
  resolved?: SessionResolution;
}

/** A session is "guided" when it was started with a length, as an intake, or with a mood check-in; plain chats stay as before. */
export const isGuided = (s: Pick<SessionRow, 'lengthMin' | 'isIntake' | 'moodBefore'>) => s.lengthMin > 0 || s.isIntake || s.moodBefore !== null;

export async function resolveSession(
  d: { db: Db; cipher: Cipher }, s: SessionRow, userText: string | undefined, now = new Date(),
): Promise<SessionResolution> {
  const guided = isGuided(s);
  const continuity = s.rememberThis && (await continuityEnabled(d.db, s.userId));
  const plan = continuity ? (await getActivePlan(d.db, d.cipher, s.userId))?.plan ?? null : null;
  const messageCount = await d.db.sessionMessage.count({ where: { sessionId: s.id } });
  const opts: Parameters<typeof computeState>[3] = { lastUserText: userText, approach: plan?.approach, pace: plan?.pace };
  if (continuity && !s.isIntake && s.phase === 'OPENING') {
    opts.finalizedCount = await d.db.therapySession.count({ where: { userId: s.userId, isIntake: false, finalizedAt: { not: null } } });
  }
  if (s.phase === 'OPENING') opts.highStress = await recentHighStress(d.db, s.userId).catch(() => false);
  return { state: computeState(s, messageCount, now, opts), guided, continuity, plan };
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

function notesBlock(notes: StoredNote[]): string {
  if (!notes.length) return '';
  const recent = notes.slice(0, 3).map((n) => noteLine(n, true));
  const older = notes.slice(3).map((n) => noteLine(n, false));
  const digest = older.length ? '\nOlder, in brief:\n' + older.join('\n') : '';
  return `EARLIER SESSION NOTES (private background, newest first):\n${recent.join('\n')}${digest}`;
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

  const head = `${d.systemPrompt}\n\n${languageDirective(i.lang)}`;
  const sections: Section[] = [];
  const add = (text: string, max: number) => sections.push({ text, max });

  // Highest priority first; fitSections trims from the end.
  add(res.guided ? SAFETY_LAYER : '', 500);
  add(res.guided ? `SESSION PHASE (${res.state.phase}):\n${res.state.nextStep}` : '', 1100);

  let name = '';
  if (layered) {
    const prof = await d.db.userProfile.findUnique({ where: { userId: i.userId }, select: { displayName: true } });
    if (prof?.displayName) name = `USER PROFILE:\nName the user likes to be called: ${prof.displayName}`;
  }
  add(name, 200);
  add(res.plan ? planBlock(res.plan) : '', 1200);

  let notes: StoredNote[] = [], themes: string[] = [], homework: string[] = [];
  if (res.continuity) {
    notes = await getRecentNotes(d.db, d.cipher, i.userId, 5, i.sessionId).catch(() => []);
    themes = (await getTopThemes(d.db, d.cipher, i.userId, 6).catch(() => [])).map((t) => `${t.label} (${t.count}x)`);
    homework = (await getHomework(d.db, d.cipher, i.userId).catch(() => [])).slice(0, 6)
      .map((h) => `- ${h.title} [${h.status}${h.feedback ? `, their feedback: ${cut(h.feedback, 80)}` : ''}]`);
  }
  add(homework.length ? `HOMEWORK STATUS:\n${homework.join('\n')}` : '', 600);
  add(notesBlock(notes), 2400);
  add(notes.length || homework.length ? CALLBACK_DIRECTIVE : '', 420);
  add(themes.length ? `RECURRING THEMES (patterns across sessions; mention only if relevant): ${themes.join(', ')}` : '', 300);

  const wellness = await buildWellnessContext(d.db, d.cipher, i.userId, i.sessionId, { includeName: !layered }).catch(() => '');
  add(withoutEarlierSessionMaterial(wellness, { memories: row.rememberThis, summaries: res.continuity }), 1100);
  let knowledge = '';
  if (d.retriever) knowledge = formatKnowledge(await d.retriever.retrieve(i.userText, i.lang).catch(() => []));
  add(knowledge, 1200);

  const body = fitSections(sections).filter(Boolean).join('\n\n');
  let system = body ? `${head}\n\n${body}` : head;
  // Recency matters for smaller models: in the opening reply of a continued session, restate the callback at the very end with a concrete hook.
  if (res.guided && res.state.phase === 'OPENING' && (notes.length || homework.length)) {
    const hook = homework[0] ?? notes[0]?.content.themes[0] ?? cut(notes[0]?.content.summary ?? '', 80);
    if (hook) system += `\n\nFOR THIS REPLY: greet them by name in one short phrase, then gently ask about this from last time, in your own words: "${hook}". After that you may invite a 1-10 mood rating. Two or three short sentences.`;
  }
  if (i.spoken) system += `\n\n${SPOKEN_ADDENDUM}`;
  return system;
}
