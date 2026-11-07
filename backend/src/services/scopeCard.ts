import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import type { GlmClient } from './glmClient.js';
import { TOPIC_KINDS, type TopicKind } from './topicPrompts.js';
import { unpackTopic } from './topicService.js';

/**
 * Scope card: what a session / section is for, what is in scope and what would be a different section. Built from rules (English, per kind),
 * optionally enriched by a cheap model call that fails safe to the rules. Stored encrypted on TherapySession.scopeCardEnc; the goal is
 * the person's own words, so the whole card is encrypted like SessionProgram.goalEncrypted. The scope is a gentle lock: it never refuses anything
 * (see topicDrift.ts) and is dropped completely whenever there is any sign of risk.
 */
export const SCOPE_KINDS = [...TOPIC_KINDS, 'KAIZEN'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const isScopeKind = (k: unknown): k is ScopeKind => typeof k === 'string' && (SCOPE_KINDS as readonly string[]).includes(k);

export interface ScopeCard { kind: ScopeKind; topic: string; goal: string; inScope: string[]; outOfScope: string[] }
export const GOAL_MAX = 240;
const ITEM_MAX = 80;
const LIST_MAX = 6;

const TOPIC_NAME: Record<ScopeKind, string> = {
  ADDICTION: 'recovery from addiction', DEPRESSION: 'low mood and energy', ANXIETY: 'worry and anxiety', RELATIONSHIP: 'relationships and communication',
  SLEEP: 'sleep', GRIEF: 'grief and loss', OTHER: 'the topic the person chose', KAIZEN: 'Kaizen: small daily steps toward a goal',
};
const DEFAULT_GOAL: Record<ScopeKind, string> = {
  ADDICTION: 'Support recovery and handle urges and triggers', DEPRESSION: 'Lift low mood with small, doable steps', ANXIETY: 'Ease worry and tension with grounding and perspective',
  RELATIONSHIP: 'Understand feelings and communicate needs in a relationship', SLEEP: 'Sleep better with a calmer wind-down and routine', GRIEF: 'Make room for loss and carry it gently',
  OTHER: 'Work on what the person came to talk about', KAIZEN: 'Choose and keep one tiny step toward the goal',
};
const IN_SCOPE: Record<ScopeKind, string[]> = {
  ADDICTION: ['cravings, urges and triggers', 'slips and relapse prevention', 'support people and routines in recovery'],
  DEPRESSION: ['low mood and low energy', 'small behavioural steps', 'hopeless or heavy feelings'],
  ANXIETY: ['worry, tension and panic', 'grounding and breathing', 'what is in their control'],
  RELATIONSHIP: ['feelings about a partner, family or friend', 'communication and boundaries', 'conflict and needs'],
  SLEEP: ['bedtime routine and wind-down', 'racing thoughts at night', 'light, caffeine and sleep habits'],
  GRIEF: ['the person or thing they lost', 'memories and mixed feelings', 'small gentle routines'],
  OTHER: ['whatever the person chose to talk about', 'how it makes them feel', 'one small next step'],
  KAIZEN: ['their goal and the one small step for today', 'what got in the way and how to make it smaller', 'streaks, habits and routines'],
};
/** Words that signal "this is about the section". Lower-case, matched as word prefixes. */
const IN_LEXICON: Record<ScopeKind, string[]> = {
  ADDICTION: ['craving', 'urge', 'relapse', 'recover', 'sober', 'drink', 'drug', 'smok', 'addict', 'trigger', 'slip', 'quit', 'clean', 'alcohol', 'gambl', 'porn'],
  DEPRESSION: ['depress', 'mood', 'energy', 'motivat', 'hopeless', 'empty', 'numb', 'sad', 'bed', 'worthless', 'tired', 'low'],
  ANXIETY: ['anxi', 'worry', 'worri', 'panic', 'nervous', 'tense', 'fear', 'overthink', 'breath', 'racing', 'dread', 'ground'],
  RELATIONSHIP: ['partner', 'husband', 'wife', 'boyfriend', 'girlfriend', 'friend', 'family', 'mother', 'father', 'parent', 'sibling', 'argu', 'fight', 'trust', 'boundar', 'relationship', 'marriage', 'breakup'],
  SLEEP: ['sleep', 'insomnia', 'bed', 'nap', 'wake', 'woke', 'night', 'dream', 'nightmare', 'rest', 'caffeine', 'tired', 'wind'],
  GRIEF: ['grief', 'griev', 'lost', 'loss', 'died', 'death', 'passed', 'funeral', 'miss', 'memor', 'mourn'],
  OTHER: [],
  KAIZEN: ['goal', 'habit', 'task', 'step', 'streak', 'routine', 'plan', 'daily', 'kaizen', 'progress', 'tiny', 'small', 'consisten', 'practice', 'today'],
};
/** What counts as a different section: every other kind's own lexicon is checked in topicDrift; these are the display lines. */
const OUT_OF_SCOPE: Record<ScopeKind, string[]> = {
  ADDICTION: ['work or study tasks', 'unrelated practical help (code, recipes, shopping)', 'news, sports, trivia'],
  DEPRESSION: ['work or study tasks', 'unrelated practical help (code, recipes, shopping)', 'a different life topic such as a relationship conflict'],
  ANXIETY: ['work or study tasks', 'unrelated practical help (code, recipes, shopping)', 'a different life topic such as grief'],
  RELATIONSHIP: ['work or study tasks', 'unrelated practical help (code, recipes, shopping)', 'a different life topic such as sleep problems'],
  SLEEP: ['work or study tasks', 'unrelated practical help (code, recipes, shopping)', 'a different life topic such as a relationship conflict'],
  GRIEF: ['work or study tasks', 'unrelated practical help (code, recipes, shopping)', 'a different life topic such as sleep problems'],
  OTHER: ['unrelated practical help (code, recipes, shopping)', 'news, sports, trivia'],
  KAIZEN: ['unrelated practical help (code, recipes, shopping)', 'news, sports, trivia', 'deep personal topics better held in their own section'],
};
export const inLexicon = (k: ScopeKind) => IN_LEXICON[k];
export const allInLexicons = () => SCOPE_KINDS.map((k) => [k, IN_LEXICON[k]] as const);

const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Rule-based card. `label` is the person's own label for OTHER topics. Never calls a model. */
export function buildScopeCard(kind: ScopeKind, opts: { label?: string | null; goal?: string | null } = {}): ScopeCard {
  const label = clean(opts.label, 60);
  const goal = clean(opts.goal, GOAL_MAX);
  const topic = kind === 'OTHER' && label ? label : TOPIC_NAME[kind];
  const inScope = [...IN_SCOPE[kind]];
  if (goal) inScope.unshift(`their own goal: ${goal.slice(0, ITEM_MAX)}`);
  return { kind, topic, goal: goal || DEFAULT_GOAL[kind], inScope: inScope.slice(0, LIST_MAX), outOfScope: [...OUT_OF_SCOPE[kind]] };
}

/** Words of the person's own goal / label, used as extra in-scope keywords. Stopwords and short words dropped. */
const STOP = new Set('the a an and or but not for with from that this these those have has had will would can could should to of in on at by as it is am are was were be been my me i you your we they what when where why how who which so if then than too very just really also about get got want need more less some all any out up down over after before our their'.split(' '));
export function goalWords(card: Pick<ScopeCard, 'goal' | 'topic'>, kind: ScopeKind): string[] {
  const src = kind === 'OTHER' ? `${card.topic} ${card.goal}` : card.goal === DEFAULT_GOAL[kind] ? '' : card.goal;
  return [...new Set((src.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)))].slice(0, 20);
}

/** The prompt block. Always injected OUTSIDE the context budget (see buildSessionSystemPrompt). */
export function scopeBlock(card: ScopeCard): string {
  const l = [
    `SESSION SCOPE (a gentle focus, never a wall): this section is for "${card.topic}". Goal: ${card.goal}`,
    `In scope: ${card.inScope.join('; ')}.`,
    `Better in a separate section: ${card.outOfScope.join('; ')}.`,
    'Stay with the scope by default. If the person drifts clearly elsewhere, you may gently say so and offer exactly two choices: go back to the topic, or open a separate section for the new thing. Never refuse, never lecture, never leave them without an answer; if they decide to switch, go with it. If they show distress or any risk, drop this scope entirely and follow the safety rules.',
  ];
  return l.join('\n');
}

export function packCard(cipher: Cipher, card: ScopeCard): string { return cipher.encrypt(JSON.stringify(card)); }
export function unpackCard(cipher: Cipher, enc: string | null | undefined): ScopeCard | null {
  if (!enc) return null;
  try {
    const c = JSON.parse(cipher.decrypt(enc));
    if (!isScopeKind(c?.kind) || typeof c.topic !== 'string') return null;
    const list = (a: unknown) => (Array.isArray(a) ? a.map((x) => clean(x, ITEM_MAX)).filter(Boolean).slice(0, LIST_MAX) : []);
    return { kind: c.kind, topic: clean(c.topic, 80), goal: clean(c.goal, GOAL_MAX), inScope: list(c.inScope), outOfScope: list(c.outOfScope) };
  } catch { return null; }
}

/** Optional cheap-model enrichment of the in/out lists from the person's own goal. ANY failure or odd output => the rule-based card unchanged. */
export async function enrichScopeCard(glm: GlmClient | undefined, card: ScopeCard, opts: { signal?: AbortSignal } = {}): Promise<ScopeCard> {
  if (!glm) return card;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
    let r;
    try {
      r = await glm.chat([
        { role: 'system', content: 'You help scope a wellness-companion section. Given the section topic and the person\'s own goal, reply with ONLY JSON {"inScope":[up to 4 short phrases],"outOfScope":[up to 3 short phrases]}: what belongs in this section and what would be better in a separate section. English, no advice, no diagnosis.' },
        { role: 'user', content: `Topic: ${card.topic}\nGoal: ${card.goal}` },
      ], { maxTokens: 200, signal });
    } finally { clearTimeout(timer); }
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) return card;
    const j = JSON.parse(m[0]);
    const pick = (a: unknown, n: number) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => clean(x, ITEM_MAX)).filter(Boolean).slice(0, n) : []);
    const inS = pick(j.inScope, 4), outS = pick(j.outOfScope, 3);
    if (!inS.length && !outS.length) return card;
    return { ...card, inScope: [...new Set([...card.inScope.slice(0, 2), ...inS])].slice(0, LIST_MAX), outOfScope: outS.length ? outS : card.outOfScope };
  } catch { return card; }
}

/** Kind + label for a session row (topic first, else its own scopeKind). null = nothing to scope to. */
export async function scopeSourceOf(d: { db: Db; cipher: Cipher }, row: { userId: string; topicId?: string | null; scopeKind?: string | null }): Promise<{ kind: ScopeKind; label?: string } | null> {
  if (row.topicId) {
    const t = await d.db.topic.findFirst({ where: { id: row.topicId, userId: row.userId } }).catch(() => null);
    if (t) { const c = unpackTopic(d.cipher, t.encryptedContent); return { kind: c.kind as TopicKind, label: c.label ?? undefined }; }
  }
  return isScopeKind(row.scopeKind) ? { kind: row.scopeKind } : null;
}

/**
 * The stored card of a session, built lazily (rules only) the first time it is needed for older rows and program sittings. Never throws.
 * Programs: the program's own goal becomes the card goal.
 */
export async function ensureScopeCard(
  d: { db: Db; cipher: Cipher },
  row: { id: string; userId: string; topicId?: string | null; scopeKind?: string | null; scopeCardEnc?: string | null; programId?: string | null },
): Promise<ScopeCard | null> {
  try {
    const have = unpackCard(d.cipher, row.scopeCardEnc);
    if (have) return have;
    const src = await scopeSourceOf(d, row);
    if (!src) return null;
    let goal: string | null = null;
    if (row.programId) {
      const p = await d.db.sessionProgram.findFirst({ where: { id: row.programId, userId: row.userId }, select: { goalEncrypted: true } });
      goal = p?.goalEncrypted ? d.cipher.decrypt(p.goalEncrypted) : null;
    }
    const card = buildScopeCard(src.kind, { label: src.label, goal });
    await d.db.therapySession.update({ where: { id: row.id }, data: { scopeKind: row.scopeKind ?? src.kind, scopeCardEnc: packCard(d.cipher, card) } });
    return card;
  } catch { return null; }
}
