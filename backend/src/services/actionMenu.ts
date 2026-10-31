import type { Db } from '../config/database.js';
import { activeConsents, type ConsentType } from '../modules/consents/consentService.js';
import type { Cipher } from '../utils/crypto.js';
import { localClock } from '../utils/dates.js';
import { ACTION_COPY, CTA_TRY, pick, reasonText, type ReasonKey } from './actionCopy.js';
import { assessmentDecoder, hasRiskSignals } from './riskState.js';
import { copyLang } from './wellnessCopy.js';

/**
 * The App Action Menu: a registry of the things the app can actually open for a person, and a RULE-BASED (no model) builder that picks at most
 * four that fit right now. The session model may only choose from the menu it is shown; anything else it returns is dropped (see extractAction).
 *
 * Filters, in order: risk (risk signals => only crisis support), the person's "how much should Nivora suggest" level, consent, time of day,
 * minimum data, the last 3 shown actions, the previous kind (rotation), kinds dismissed or thumbed-down in the last 7 days.
 */
export const ACTION_KINDS = ['BREATHING', 'GROUNDING', 'THOUGHT_RECORD', 'JOURNAL', 'SLEEP', 'KAIZEN', 'MOVEMENT', 'SOUNDS', 'REACH_OUT', 'CRISIS'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const SURFACES = ['CHAT', 'CALL', 'TODAY', 'INSIGHTS', 'SESSION_CLOSE', 'WEEKLY', 'MONTHLY'] as const;
export type Surface = (typeof SURFACES)[number];
export const SUGGESTION_LEVELS = ['OFTEN', 'SOMETIMES', 'RARELY', 'NEVER'] as const;
export type SuggestionLevel = (typeof SUGGESTION_LEVELS)[number];
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** Where the app should navigate. `route` is a name from mobile/src/navigation/types.ts (RootParams) or one of the NEW_ROUTES below. */
export interface DeepLink { route: string; params?: Record<string, string | number | boolean> }
/** Routes that do not exist in the app yet; the mobile side must add them (light screens/flows for Phase D). */
export const NEW_ROUTES = ['ActionWalk', 'ActionReachOut'] as const;

export interface ActionDef {
  id: string; kind: ActionKind; titleKey: string; whyKey: string; deepLink: DeepLink; minutes: number;
  requires: { consent?: ConsentType; timeOfDay?: TimeOfDay[]; minData?: 'KAIZEN_GOAL' | 'TRUSTED_CONTACT' | 'VOICE' };
  tags: string[];
  crisis?: boolean;
  /** One English line for the model: what this action is. Not shown to the user. */
  modelHint: string;
  /** Base weight when no tag matches (so the menu is never empty for a quiet context). */
  weight: number;
}

const def = (id: string, kind: ActionKind, minutes: number, deepLink: DeepLink, tags: string[], modelHint: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id, kind, titleKey: `action.${id}.title`, whyKey: `action.${id}.why`, deepLink, minutes, requires: {}, tags, modelHint, weight: 1, ...extra,
});

export const ACTIONS: ActionDef[] = [
  def('BREATHING', 'BREATHING', 2, { route: 'Exercise', params: { kind: 'breathing' } }, ['anxiety', 'panic', 'stress', 'anger', 'overwhelm'], 'a 2-minute guided slow-breathing exercise (for anxiety, panic, anger, tension)', { weight: 2 }),
  def('GROUNDING', 'GROUNDING', 3, { route: 'Exercise', params: { kind: 'grounding' } }, ['anxiety', 'panic', 'overwhelm'], 'a 3-minute 5-4-3-2-1 grounding exercise to come back to the present', { weight: 1.5 }),
  def('THOUGHT_RECORD', 'THOUGHT_RECORD', 5, { route: 'Exercise', params: { kind: 'thought' } }, ['looping', 'anxiety', 'low_mood'], 'a 5-minute thought record: write one troubling thought down and look at it gently', { weight: 1 }),
  def('JOURNAL_TEXT', 'JOURNAL', 3, { route: 'JournalEdit' }, ['reflect', 'looping', 'stress', 'anger', 'overwhelm'], 'writing a few lines in the private journal', { weight: 2 }),
  def('JOURNAL_VOICE', 'JOURNAL', 2, { route: 'JournalEdit', params: { mode: 'voice' } }, ['reflect', 'overwhelm', 'low_energy'], 'speaking a short voice note into the private journal instead of typing', { requires: { minData: 'VOICE' }, weight: 1 }),
  def('GRATITUDE_NOTE', 'JOURNAL', 2, { route: 'Exercise', params: { kind: 'gratitude' } }, ['gratitude', 'low_mood', 'calm'], 'a one-line note about one small thing that went okay today', { weight: 1.5 }),
  def('SLEEP_ROUTINE', 'SLEEP', 5, { route: 'Routine' }, ['sleep'], "looking at tonight's gentle wind-down routine", { requires: { timeOfDay: ['afternoon', 'evening', 'night'] }, weight: 0.5 }),
  def('KAIZEN_STEP', 'KAIZEN', 2, { route: 'Tabs', params: { screen: 'KaizenTab' } }, ['low_energy', 'low_mood', 'motivation'], "today's one tiny step from their Kaizen goal", { requires: { minData: 'KAIZEN_GOAL' }, weight: 1.5 }),
  def('WALK_10', 'MOVEMENT', 10, { route: 'ActionWalk' }, ['low_energy', 'low_mood', 'stress', 'anger', 'motivation'], 'a 10-minute walk or another small pleasant activity, added as a Kaizen step', { requires: { timeOfDay: ['morning', 'afternoon', 'evening'] }, weight: 1 }),
  def('SOUNDS', 'SOUNDS', 5, { route: 'Sounds' }, ['sleep', 'anxiety', 'calm', 'stress'], 'calming sounds to rest the mind', { weight: 1 }),
  def('REACH_OUT', 'REACH_OUT', 3, { route: 'ActionReachOut' }, ['loneliness', 'low_mood'], 'drafting a gentle message to a trusted person (the app sends nothing; the person decides)', { requires: { timeOfDay: ['morning', 'afternoon', 'evening'], minData: 'TRUSTED_CONTACT' }, weight: 0.5 }),
  def('SAFETY_PLAN', 'CRISIS', 0, { route: 'SafetyPlan' }, [], "opening the person's own safety plan", { crisis: true, weight: 0 }),
  def('EMERGENCY', 'CRISIS', 0, { route: 'Emergency' }, [], 'emergency numbers and support lines', { crisis: true, weight: 0 }),
  def('TRUSTED_PERSON', 'CRISIS', 0, { route: 'ActionReachOut', params: { support: true } }, [], 'reaching out to a trusted person', { crisis: true, weight: 0 }),
];
export const ACTION_IDS = ACTIONS.map((a) => a.id);
export const actionById = (id: string, registry: ActionDef[] = ACTIONS) => registry.find((a) => a.id === id);

/** The localized card the app renders. `offerId` is set once the offer is recorded (chat / call / close), null for a plain menu read. */
export interface ActionCard {
  offerId: string | null; id: string; kind: ActionKind; crisis: boolean; minutes: number; deepLink: DeepLink; surface: Surface;
  title: string; why: string; reason: string; cta: string; notNow: string;
  titleKey: string; whyKey: string; reasonKey: string;
}

export function toCard(a: ActionDef, locale: string | null | undefined, surface: Surface, reasonKey: ReasonKey, over: { offerId?: string | null; cta?: string; title?: string; deepLink?: DeepLink; reason?: string } = {}): ActionCard {
  const c = ACTION_COPY[a.id];
  return {
    offerId: over.offerId ?? null, id: a.id, kind: a.kind, crisis: !!a.crisis, minutes: a.minutes, deepLink: over.deepLink ?? a.deepLink, surface,
    title: over.title ?? (c ? pick(c.title, locale) : a.id), why: c ? pick(c.why, locale) : '', reason: over.reason ?? reasonText(reasonKey, locale),
    cta: over.cta ?? (c?.cta ? pick(c.cta, locale) : pick(CTA_TRY, locale)), notNow: pick({ en: 'Not now', bn: 'এখন নয়', hi: 'अभी नहीं', ne: 'अहिले होइन' }, locale),
    titleKey: a.titleKey, whyKey: a.whyKey, reasonKey,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Context: tags from what the person said (rule-based, text never stored) and from their own numbers.
// ---------------------------------------------------------------------------------------------------------------------------------------------

const TAG_RULES: { tag: string; re: RegExp }[] = [
  { tag: 'sleep', re: /\b(sleep|insomnia|can'?t sleep|awake at night|nightmare|tossing)\b|ঘুম|নিদ্রা|नींद|सो नहीं|निद्रा|निदाउ/i },
  { tag: 'looping', re: /\b(overthink\w*|keep (?:thinking|replaying)|can'?t stop thinking|going round|racing thoughts|same thought|ruminat\w*)\b|ভাবনা.{0,10}(ঘুর|থামছে না)|বারবার ভাব|बार-बार (?:सोच|विचार)|सोचना बंद|दिमाग.{0,8}घूम|घुमिरहन|बारम्बार सोच/i },
  { tag: 'anxiety', re: /\b(anxi\w*|panic\w*|worr\w*|nervous|scared|afraid|on edge|dread)\b|উদ্বেগ|ভয়|চিন্তা|ঘাবড়|घबरा|चिंता|डर|बेचैन|चिन्ता|डराउ/i },
  { tag: 'panic', re: /\b(panic\w*|can'?t breathe|heart (?:is )?racing)\b|দম বন্ধ|হৃদস্পন্দন|साँस नहीं|धड़कन|सास फेर्न/i },
  { tag: 'low_energy', re: /\b(no energy|exhaust\w*|drained|can'?t get (?:up|started)|unmotivated|no motivation|so tired|wiped out)\b|ক্লান্ত|শক্তি নেই|ইচ্ছে করছে না|थक|ऊर्जा नहीं|मन नहीं लग|थाक|उर्जा छैन/i },
  { tag: 'low_mood', re: /\b(sad|down|low|empty|hopeless|numb|miserable)\b|মন খারাপ|বিষণ্ণ|উদাস|उदास|मन भारी|निराश|मन दुखी|उदास/i },
  { tag: 'loneliness', re: /\b(lonely|alone|no one|nobody|isolated|left out)\b|একা|একাকী|কেউ নেই|अकेला|अकेली|अकेलापन|कोई नहीं|एक्लो|कोही छैन/i },
  { tag: 'anger', re: /\b(angry|furious|irritat\w*|annoy\w*|rage|mad at)\b|রাগ|বিরক্ত|गुस्स\w*|क्रोध|चिढ़|रिस|झन्क/i },
  { tag: 'stress', re: /\b(stress\w*|pressure|overwhelm\w*|too much|deadline|burn\w* ?out)\b|চাপ|ভারাক্রান্ত|তনাব|तनाव|दबाव|बोझ|तनाब|थिच/i },
  { tag: 'overwhelm', re: /\b(overwhelm\w*|too much|can'?t cope|drowning)\b|ভারাক্রান্ত|সামলাতে পারছি না|संभाल नहीं|सम्हाल्न सक्दिन/i },
  { tag: 'gratitude', re: /\b(grateful|thankful|appreciate|good news|went well)\b|কৃতজ্ঞ|ধন্যবাদ|ভালো খবর|आभारी|कृतज्ञ|शुक्रगुज़ार|राम्रो खबर|धन्यवाद/i },
  { tag: 'reflect', re: /\b(i need to (?:vent|write)|get it out|put it into words)\b/i },
];
/** Tags found in a piece of text (a user's message). Pure; the text is not kept anywhere. */
export function inferTags(text: string | undefined | null): string[] {
  if (!text) return [];
  return TAG_RULES.filter((r) => r.re.test(text)).map((r) => r.tag);
}

const TAG_REASON: Record<string, ReasonKey> = {
  sleep: 'tag_sleep', sleep_short: 'sleep_short', looping: 'tag_looping', anxiety: 'tag_anxiety', panic: 'tag_anxiety', stress: 'tag_stress', overwhelm: 'tag_stress',
  anger: 'tag_anger', low_energy: 'tag_low_energy', low_mood: 'tag_low_mood', loneliness: 'tag_loneliness', gratitude: 'tag_gratitude',
};

/** Tags from the person's own numbers (no model): short last night, low mood, low energy, high stress in the latest check-in. */
export async function numericTags(db: Db, userId: string, tz: string | null | undefined, now = new Date()): Promise<string[]> {
  const today = localClock(tz, now).date;
  const [sleep, checkIn] = await Promise.all([
    db.sleepEntry.findFirst({ where: { userId }, orderBy: { date: 'desc' } }),
    db.checkIn.findFirst({ where: { userId, createdAt: { gte: new Date(now.getTime() - 36 * 3_600_000) } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const tags: string[] = [];
  if (sleep && sleep.date >= new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) && (sleep.score < 55 || sleep.durationMin < 360)) tags.push('sleep_short', 'sleep');
  if (checkIn) {
    if (checkIn.mood <= 4) tags.push('low_mood');
    if (checkIn.energy <= 3) tags.push('low_energy');
    if (checkIn.stress >= 7) tags.push('stress');
  }
  return tags;
}

export const timeOfDayOf = (hour: number): TimeOfDay => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night');

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Suggestion level
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface LevelRules { max: number; chatPerDay: number; gapTurns: number }
export const LEVEL_RULES: Record<SuggestionLevel, LevelRules> = {
  OFTEN: { max: 4, chatPerDay: 6, gapTurns: 2 },
  SOMETIMES: { max: 4, chatPerDay: 3, gapTurns: 5 },
  RARELY: { max: 2, chatPerDay: 1, gapTurns: 12 },
  NEVER: { max: 0, chatPerDay: 0, gapTurns: 0 },
};
export const parseLevel = (v: unknown): SuggestionLevel => ((SUGGESTION_LEVELS as readonly string[]).includes(String(v)) ? (v as SuggestionLevel) : 'SOMETIMES');

// ---------------------------------------------------------------------------------------------------------------------------------------------
// buildMenu
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface MenuDeps { db: Db; cipher: Cipher }
export interface MenuContext {
  surface: Surface;
  /** The person's latest words (or recent words); only used to infer tags, never stored. */
  text?: string;
  /** Extra tags the caller already knows (e.g. from a pattern card). */
  tags?: string[];
  sessionId?: string;
  now?: Date;
  /** Cap below the level's own cap. */
  max?: number;
  /** Skip the per-day / per-gap chat caps (used by non-chat surfaces). Default: caps apply to CHAT and CALL only. */
  voiceEnabled?: boolean;
  /** Only actions that pass this predicate (e.g. "tiny enough for the session-close card"). */
  only?: (a: ActionDef) => boolean;
}
export interface MenuItem { def: ActionDef; reasonKey: ReasonKey }
export interface Menu {
  items: MenuItem[]; riskMode: boolean; level: SuggestionLevel; locale: string; tz: string; hour: number; tags: string[];
  /** Why the list is empty (or crisis-only), for logs and tests. */
  note: 'OK' | 'LEVEL_NEVER' | 'RISK' | 'CAP_DAY' | 'CAP_GAP' | 'NO_MATCH';
}

const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000);
/** Stable small number from a string (rotation without randomness, so tests are deterministic). */
const hashOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
export const crisisItems = (registry: ActionDef[] = ACTIONS): MenuItem[] => registry.filter((a) => a.crisis).map((def) => ({ def, reasonKey: 'risk_support' as ReasonKey }));

export async function buildMenu(d: MenuDeps, userId: string, ctx: MenuContext, registry: ActionDef[] = ACTIONS): Promise<Menu> {
  const now = ctx.now ?? new Date();
  const user = await d.db.user.findUnique({ where: { id: userId }, select: { timezone: true, locale: true, profile: { select: { suggestionLevel: true } } } });
  const tz = user?.timezone ?? 'UTC', locale = user?.locale ?? 'en';
  const clock = localClock(tz, now);
  const hour = Math.floor(clock.minutes / 60);
  const level = parseLevel(user?.profile?.suggestionLevel);
  const base = { level, locale, tz, hour, tags: [] as string[] };

  // 1. Risk signals: nothing but crisis support, regardless of the level or any other filter.
  if (await hasRiskSignals(d.db, userId, assessmentDecoder((s) => d.cipher.decrypt(s)), now)) return { ...base, items: crisisItems(registry), riskMode: true, note: 'RISK' };
  const rules = LEVEL_RULES[level];
  if (rules.max === 0) return { ...base, items: [], riskMode: false, note: 'LEVEL_NEVER' };

  // 2. Chat / call frequency caps from the person's level.
  const chatLike = ctx.surface === 'CHAT' || ctx.surface === 'CALL';
  if (chatLike) {
    const today = await d.db.actionOffer.count({ where: { userId, surface: { in: ['CHAT', 'CALL'] }, createdAt: { gte: daysAgo(1, now) } } });
    if (today >= rules.chatPerDay) return { ...base, items: [], riskMode: false, note: 'CAP_DAY' };
    const last = ctx.sessionId ? await d.db.actionOffer.findFirst({ where: { userId, sessionId: ctx.sessionId }, orderBy: { createdAt: 'desc' } }) : null;
    if (last) {
      const since = await d.db.sessionMessage.count({ where: { sessionId: ctx.sessionId!, role: 'assistant', createdAt: { gt: last.createdAt } } });
      if (since < rules.gapTurns) return { ...base, items: [], riskMode: false, note: 'CAP_GAP' };
    }
  }

  // 3. Variety: last 3 shown, the previous kind, kinds dismissed / thumbed-down in the last 7 days.
  const [recent, bad, consents] = await Promise.all([
    d.db.actionOffer.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 3 }),
    d.db.actionOffer.findMany({ where: { userId, createdAt: { gte: daysAgo(7, now) }, OR: [{ outcome: 'DISMISSED' }, { feedback: -1 }] }, select: { kind: true } }),
    activeConsents(d.db, userId),
  ]);
  const recentIds = new Set(recent.map((r) => r.actionId));
  const lastKind = recent[0]?.kind;
  const badKinds = new Set(bad.map((b) => b.kind));
  const [contacts, goal] = await Promise.all([
    d.db.trustedContact.count({ where: { userId } }),
    d.db.kaizenGoal.count({ where: { userId, status: 'ACTIVE' } }),
  ]);

  const tod = timeOfDayOf(hour);
  const tags = [...new Set([...(ctx.tags ?? []), ...inferTags(ctx.text), ...(await numericTags(d.db, userId, tz, now))])];
  const active = new Set(tags);
  const day = clock.date;

  const scored: (MenuItem & { score: number })[] = [];
  for (const a of registry) {
    if (a.crisis) continue;
    const r = a.requires;
    if (r.consent && !consents.has(r.consent)) continue;
    if (r.timeOfDay && !r.timeOfDay.includes(tod)) continue;
    if (r.minData === 'TRUSTED_CONTACT' && contacts === 0) continue;
    if (r.minData === 'KAIZEN_GOAL' && goal === 0) continue;
    if (r.minData === 'VOICE' && !ctx.voiceEnabled) continue;
    if (ctx.only && !ctx.only(a)) continue;
    if (recentIds.has(a.id) || a.kind === lastKind || badKinds.has(a.kind)) continue;
    const hits = a.tags.filter((t) => active.has(t));
    let score = hits.length * 3 + a.weight;
    let reasonKey: ReasonKey = chatLike ? 'chat' : 'general';
    const first = hits[0];
    if (first && TAG_REASON[first]) reasonKey = TAG_REASON[first]!;
    if (a.id === 'SLEEP_ROUTINE' && tod !== 'morning') { score += tod === 'evening' ? 2 : 1; if (!hits.length) reasonKey = 'evening'; }
    if (a.id === 'KAIZEN_STEP' && tod === 'morning') { score += 1; if (!hits.length) reasonKey = 'morning'; }
    if (hits.includes('sleep_short') && a.id === 'SLEEP_ROUTINE') reasonKey = 'sleep_short';
    // With a context that points somewhere, actions that match nothing are left out; with a quiet context the generic ones fill in.
    if (active.size > 0 && hits.length === 0 && a.weight < 1.5) continue;
    scored.push({ def: a, reasonKey, score });
  }
  // Highest score first; a stable daily rotation breaks ties so the same card is not always on top.
  scored.sort((x, y) => y.score - x.score || hashOf(day + x.def.id) - hashOf(day + y.def.id));
  const cap = Math.min(rules.max, ctx.max ?? 4);
  const items: MenuItem[] = [];
  const kinds = new Set<string>();
  for (const s of scored) {
    if (kinds.has(s.def.kind)) continue;
    kinds.add(s.def.kind);
    items.push({ def: s.def, reasonKey: s.reasonKey });
    if (items.length >= cap) break;
  }
  return { ...base, tags, items, riskMode: false, note: items.length ? 'OK' : 'NO_MATCH' };
}

export const menuCards = (m: Menu, surface: Surface, ids: Record<string, string | null> = {}): ActionCard[] =>
  m.items.map((i) => toCard(i.def, m.locale, surface, i.reasonKey, { offerId: ids[i.def.id] ?? null }));

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The session prompt: static rules (first) and the per-turn menu (last)
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Static part: identical for every turn and every person, so it sits right after the base prompt (cache-friendly prefix). */
export const ACTION_RULES = `OFFERING AN ACTION (optional, rare)
- Near the end of this prompt an ACTION MENU may be listed. It lists what the app can actually open for the person, changes every turn and may be empty.
- Offer at most ONE action, and only after the person has felt heard for several turns or asked what to do. Most replies offer nothing.
- Only from the menu. Never invent features, screens, exercises or ids, and never name something that is not listed. If there is no menu, offer nothing.
- Say it as a warm invitation in your own words ("if you like, we could ..."), never an order; it is fine for them to say no. Do not describe how the app looks.
- If you do offer one, put a final line with exactly [[ACTION:ID]] (the id from the menu) after your reply. The person never sees that line. If you offer nothing, add no line.`;

/** Per-turn part: the eligible actions for this person right now. Empty string when there is nothing to offer. */
export function menuPromptBlock(items: MenuItem[], riskMode = false): string {
  if (!items.length) return '';
  const lines = items.map((i) => `- ${i.def.id}: ${i.def.modelHint}${i.def.minutes ? ` (about ${i.def.minutes} min)` : ''}`);
  return `ACTION MENU (this turn only; offer at most one, or none):\n${lines.join('\n')}${riskMode ? '\nThe person may be going through something heavy: offer one of these only if it comes up naturally, as a gentle option, never as a task.' : ''}`;
}

const MARKER = /\[\[\s*ACTION\s*:\s*([A-Za-z0-9_]*)\s*\]\]/gi;
/** Removes every [[ACTION:ID]] marker from a finished reply. The last id found (if any) is returned as `id`. */
export function extractAction(raw: string): { text: string; id: string | null } {
  let id: string | null = null;
  const text = raw.replace(MARKER, (_m, g: string) => { id = g.trim().toUpperCase() || null; return ''; }).replace(/[ \t]+\n/g, '\n').trimEnd();
  return { text, id };
}

/** True when `id` is one of the actions that were on this turn's menu. Anything else is dropped (the model must not invent features). */
export const validateChoice = (id: string | null, items: MenuItem[]): MenuItem | null => (id ? items.find((i) => i.def.id === id) ?? null : null);

const OPEN = '[[ACTION:';
/**
 * Streaming filter: passes text through but holds back anything that could be (the start of) the marker, and drops the marker itself.
 * Usage: push() every delta (it returns what is safe to show), end() once at the end (returns held-back text that turned out not to be a marker).
 */
export function createMarkerFilter() {
  let held = '';
  return {
    push(t: string): string {
      held += t;
      let out = '';
      for (;;) {
        const i = held.indexOf('[');
        if (i < 0) { out += held; held = ''; return out; }
        out += held.slice(0, i); held = held.slice(i);
        const probe = held.slice(0, OPEN.length).toUpperCase();
        if (probe.length < OPEN.length) {
          if (OPEN.startsWith(probe)) return out; // might still become the marker: hold it back
          out += '['; held = held.slice(1); continue;
        }
        if (probe !== OPEN) { out += '['; held = held.slice(1); continue; } // some other bracket: plain text
        const close = held.indexOf(']]');
        if (close < 0) return out; // the marker is still arriving
        held = held.slice(close + 2); // drop it and carry on with whatever follows
      }
    },
    end(): string {
      const rest = held; held = '';
      return OPEN.startsWith(rest.toUpperCase().slice(0, OPEN.length)) || rest.toUpperCase().startsWith(OPEN) ? '' : rest;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Offers and outcomes (the variety ledger)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export async function recordOffer(db: Db, userId: string, a: ActionDef, surface: Surface, link: { sessionId?: string | null; messageId?: string | null } = {}): Promise<string> {
  const row = await db.actionOffer.create({ data: { userId, actionId: a.id, kind: a.kind, surface, sessionId: link.sessionId ?? null, messageId: link.messageId ?? null } });
  return row.id;
}

export const OUTCOMES = ['ACCEPTED', 'DISMISSED', 'THUMBS_UP', 'THUMBS_DOWN'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** `ref` is an offer id (uuid) or a registry id (a card from a plain menu read: the row is created now). Returns null when it is neither. */
export async function setOutcome(db: Db, userId: string, ref: string, outcome: Outcome, surface: Surface = 'TODAY', registry: ActionDef[] = ACTIONS) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  let row = isUuid ? await db.actionOffer.findFirst({ where: { id: ref, userId } }) : null;
  if (!row && !isUuid) {
    const a = actionById(ref.toUpperCase(), registry);
    if (!a) return null;
    row = await db.actionOffer.create({ data: { userId, actionId: a.id, kind: a.kind, surface } });
  }
  if (!row) return null;
  const data = outcome === 'THUMBS_UP' ? { feedback: 1 } : outcome === 'THUMBS_DOWN' ? { feedback: -1 } : { outcome, outcomeAt: new Date() };
  return db.actionOffer.update({ where: { id: row.id }, data });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Mapping to Kaizen (what "accept" saves) and from feeling words (Emotion Reading)
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Kaizen category a menu action becomes when it is saved as a small step. KAIZEN_STEP and the crisis actions are not saved. */
export const KAIZEN_FOR_ACTION: Record<string, { category: string; minutes: number }> = {
  BREATHING: { category: 'BREATHING', minutes: 2 }, GROUNDING: { category: 'GROUNDING', minutes: 2 }, THOUGHT_RECORD: { category: 'REFLECTION', minutes: 5 },
  JOURNAL_TEXT: { category: 'JOURNALING', minutes: 2 }, JOURNAL_VOICE: { category: 'JOURNALING', minutes: 2 }, GRATITUDE_NOTE: { category: 'GRATITUDE', minutes: 2 },
  SLEEP_ROUTINE: { category: 'SLEEP_ROUTINE', minutes: 5 }, WALK_10: { category: 'SHORT_WALK', minutes: 10 }, SOUNDS: { category: 'RELAXATION', minutes: 5 },
  REACH_OUT: { category: 'SOCIAL', minutes: 3 },
};
/** "Tiny" = fits the session-close card: 5 minutes or less and savable to Kaizen. */
export const isTiny = (a: ActionDef) => !a.crisis && !!KAIZEN_FOR_ACTION[a.id] && a.minutes <= 5 && a.id !== 'KAIZEN_STEP';

const FEELING_RULES: { re: RegExp; actionId: string; category: string }[] = [
  { re: /panic|can'?t breathe|ঘাবড়|घबरा/i, actionId: 'GROUNDING', category: 'GROUNDING' },
  { re: /anxi|worr|nervous|scared|afraid|dread|চিন্তা|ভয়|উদ্বিগ্ন|चिंता|चिन्ता|डर|घबरा/i, actionId: 'BREATHING', category: 'BREATHING' },
  { re: /angry|mad\b|furious|annoy|irritat|রাগ|বিরক্ত|गुस्स|क्रोध|रिस/i, actionId: 'BREATHING', category: 'BREATHING' },
  { re: /grate|thank|appreciat|কৃতজ্ঞ|ধন্যবাদ|आभार|कृतज्ञ|धन्यवाद/i, actionId: 'GRATITUDE_NOTE', category: 'GRATITUDE' },
  { re: /tired|exhaust|drain|ক্লান্ত|অবসন্ন|थक|थाक/i, actionId: 'SOUNDS', category: 'RELAXATION' },
  { re: /lonely|alone|একা|अकेल|एक्लो/i, actionId: 'REACH_OUT', category: 'SOCIAL' },
];
/** Simple rules from feeling words (and the writing itself) to a menu action + Kaizen category. Default: just notice how you feel. */
export function stepForFeelings(words: string[], text = ''): { actionId: string; category: string } {
  const hay = `${words.join(' ')} ${text}`;
  const hit = FEELING_RULES.find((r) => r.re.test(hay));
  return hit ? { actionId: hit.actionId, category: hit.category } : { actionId: 'KAIZEN_STEP', category: 'SELF_OBSERVATION' };
}

export const localeOf = (l?: string | null) => copyLang(l);
