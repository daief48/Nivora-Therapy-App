import type { GlmClient } from './glmClient.js';
import { allInLexicons, goalWords, inLexicon, type ScopeCard, type ScopeKind } from './scopeCard.js';
import { copyLang, fill, type CopyLang } from './wellnessCopy.js';

/**
 * Topic-lock for scoped sessions: a GENTLE drift check, never a gate.
 *  - Per turn: rules first (lexicon overlap + continuity). Only a confident OFF-topic reading (no overlap with the section's words,
 *    clear signals of another section or unrelated practical help) counts. Anything unclear goes to an optional cheap model check;
 *    ANY failure / timeout / odd output / no model => ON-topic. Short messages are always on-topic.
 *  - Periodic: every DRIFT_EVERY user turns, the last few user messages are read together, to catch a slow drift that no single message shows.
 *  - The caller (conversationService) skips all of this on any risk (this turn, session riskFlag, userHasRisk) and when the person already chose to switch.
 * On drift the reply stays the model's own, with a prompt block asking for one warm line and exactly two choices (see redirectBlock).
 */
export const DRIFT_EVERY = 4;
export const DRIFT_WINDOW = 3;
/** After a redirect (or the person choosing to go back) it is not offered again for this many user turns. */
export const REDIRECT_COOLDOWN_TURNS = 4;
export const MIN_WORDS = 5;
const MODEL_TIMEOUT_MS = 3000;

export type Verdict = 'ON' | 'OFF' | 'UNKNOWN';

/** Words so common in feelings talk that they never count as a signal of ANOTHER section. */
const AMBIGUOUS = new Set(['tired', 'low', 'bed', 'night', 'rest', 'sad', 'miss', 'lost', 'small', 'today', 'step', 'plan', 'daily', 'friend', 'family', 'wake', 'woke', 'clean', 'quit', 'slip', 'fear', 'progress', 'practice', 'mood', 'energy', 'empty', 'numb', 'trust', 'fight', 'argu', 'memor', 'passed', 'drink', 'wind', 'dream', 'goal', 'habit', 'task', 'routine']);
const GENERIC_OFF = /\b(python|javascript|typescript|java\b|html|css|sql|code|coding|debug|compile|recipe|cook(?:ing)?|bake|baking|homework|assignment|essay|resume|cv\b|cover letter|stock|stocks|crypto|bitcoin|invest(?:ing|ment)?|football|cricket|soccer|basketball|movie|film|netflix|song lyrics|weather|forecast|election|politic\w*|president|prime minister|translate|translation|capital of|who won|score of|how many (?:km|miles)|exam answers?|math problem|equation|buy a|best phone|laptop|flight|hotel|visa)\b/i;

const wordsOf = (t: string) => t.toLowerCase().match(/\p{L}[\p{L}'’]*/gu) ?? [];
const hits = (words: string[], lex: readonly string[]) => words.filter((w) => lex.some((p) => w.startsWith(p))).length;
const mostlyLatin = (t: string) => { const ls = t.match(/\p{L}/gu) ?? []; return ls.length > 0 && ls.filter((c) => /[A-Za-z]/.test(c)).length / ls.length >= 0.8; };
const content = (ws: string[]) => new Set(ws.filter((w) => w.length >= 5));

export interface RuleContext { /** The person's previous messages (oldest first) and the assistant's last reply: for continuity. */ previousUser?: string[]; lastAssistant?: string }

/** Rule verdict for ONE message. OFF only when confident; ON for anything that touches the section, is short, or continues an on-topic thread. */
export function ruleVerdict(text: string, card: ScopeCard, ctx: RuleContext = {}): Verdict {
  const ws = wordsOf(text);
  if (ws.length < MIN_WORDS) return 'ON';
  if (!mostlyLatin(text)) return 'UNKNOWN'; // Bangla / Devanagari / other: no reliable English lexicon, leave it to the model (or ON)
  const own = [...inLexicon(card.kind), ...goalWords(card, card.kind)];
  if (hits(ws, own) > 0) return 'ON';
  // Continuity: it shares real words with the person's previous (on-topic) message or the assistant's last reply => same thread.
  const prev = ctx.previousUser?.at(-1);
  if (prev) {
    const prevWs = wordsOf(prev);
    const prevOn = prevWs.length < MIN_WORDS || hits(prevWs, own) > 0;
    const shared = [...content(ws)].filter((w) => content(prevWs).has(w)).length;
    if (prevOn && shared >= 1) return 'ON';
  }
  if (ctx.lastAssistant) {
    const shared = [...content(ws)].filter((w) => content(wordsOf(ctx.lastAssistant!)).has(w)).length;
    if (shared >= 2) return 'ON';
  }
  if (GENERIC_OFF.test(text)) return 'OFF';
  if (card.kind !== 'OTHER') {
    for (const [k, lex] of allInLexicons()) {
      if (k === card.kind) continue;
      const distinct = lex.filter((p) => !AMBIGUOUS.has(p));
      if (hits(ws, distinct) >= 2) return 'OFF';
    }
  }
  return 'UNKNOWN';
}

async function modelOnTopic(glm: GlmClient, card: ScopeCard, text: string, signal?: AbortSignal): Promise<boolean> {
  // true = on-topic. Everything unclear is on-topic.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), MODEL_TIMEOUT_MS);
  try {
    const r = await glm.chat([
      { role: 'system', content: `A wellness-companion section is about: "${card.topic}" (goal: ${card.goal}). Decide if the person's message is clearly about something ELSE entirely (a different life topic or unrelated practical help). Personal feelings, side comments and anything related count as on topic. Reply ONLY JSON {"onTopic":true|false}. When unsure, true.` },
      { role: 'user', content: text.slice(0, 600) },
    ], { maxTokens: 20, signal: signal ? AbortSignal.any([signal, ac.signal]) : ac.signal });
    const m = r.content.match(/\{[\s\S]*?\}/);
    if (!m) return true;
    return JSON.parse(m[0]).onTopic !== false;
  } catch { return true; } finally { clearTimeout(timer); }
}

export interface DriftInput {
  card: ScopeCard; text: string;
  previousUser: string[]; lastAssistant?: string;
  /** Number of user messages in the session INCLUDING this one. */
  userTurn: number;
  utilityGlm?: GlmClient; signal?: AbortSignal;
}
export interface DriftResult { drift: boolean; via: 'rules' | 'model' | 'periodic' | 'periodic-model' | null }

/** Never throws: any failure means "on topic". */
export async function checkDrift(i: DriftInput): Promise<DriftResult> {
  try {
    const v = ruleVerdict(i.text, i.card, { previousUser: i.previousUser, lastAssistant: i.lastAssistant });
    if (v === 'OFF') return { drift: true, via: 'rules' };
    if (v === 'UNKNOWN' && i.utilityGlm && wordsOf(i.text).length >= 8 && !(await modelOnTopic(i.utilityGlm, i.card, i.text, i.signal))) return { drift: true, via: 'model' };
    // Periodic multi-turn read (also catches slow drift where no single message is clearly off).
    if (i.userTurn >= DRIFT_EVERY && i.userTurn % DRIFT_EVERY === 0 && i.previousUser.length >= DRIFT_WINDOW - 1) {
      const window = [...i.previousUser.slice(-(DRIFT_WINDOW - 1)), i.text];
      const joined = window.join(' ');
      const ws = wordsOf(joined);
      const ownHits = hits(ws, [...inLexicon(i.card.kind), ...goalWords(i.card, i.card.kind)]);
      // Several messages that individually show too little, but together are plainly elsewhere (no continuity shortcut across the window).
      if (ownHits === 0 && ruleVerdict(joined, i.card) === 'OFF') return { drift: true, via: 'periodic' };
      if (ownHits === 0 && i.utilityGlm && ws.length >= 15 && !(await modelOnTopic(i.utilityGlm, i.card, joined, i.signal))) return { drift: true, via: 'periodic-model' };
    }
    return { drift: false, via: null };
  } catch { return { drift: false, via: null }; }
}

/** The person says outright that they want to move on / talk about something else. Their call, always honoured. */
const SWITCH_EN = /\b(?:let'?s|can we|could we|i(?:'d| would)? (?:want|like|prefer) to|i want to|i need to)\s+(?:talk|speak|switch|move|change|discuss)\b.*\b(?:something else|another|different|other|instead|topic|subject)\b|\b(?:change|switch) (?:the )?(?:topic|subject)\b|\bsomething else\b.*\binstead\b|\bmove on to\b|\b(?:separate|new|different) section\b/i;
const SWITCH_OTHER = /(অন্য (?:কিছু|বিষয়)|বিষয় বদল|টপিক বদল|कुछ और बात|दूसरे विषय|विषय बदल|अर्कै कुरा|अर्को विषय|विषय परिवर्तन)/;
export const wantsToSwitch = (t: string) => SWITCH_EN.test(t) || SWITCH_OTHER.test(t);

// ---------- copy (en, bn, hi, ne; hi/ne need native review like the rest of wellnessCopy) ----------
const COPY: Record<CopyLang, { intro: string; back: string; separate: string }> = {
  en: { intro: 'That sounds like it deserves its own space. What would you like?', back: 'Go back to {topic}', separate: 'Open a separate section for this' },
  bn: { intro: 'এটা বোধহয় আলাদা জায়গা পাওয়ার যোগ্য। আপনি কী চান?', back: '{topic}-এ ফিরে যাই', separate: 'এর জন্য আলাদা সেকশন খুলি' },
  hi: { intro: 'यह शायद अपनी अलग जगह का हकदार है। आप क्या चाहेंगे?', back: '{topic} पर लौटें', separate: 'इसके लिए अलग सेक्शन खोलें' },
  ne: { intro: 'यो बेग्लै ठाउँमा राख्न लायक जस्तो छ। तपाईं के चाहनुहुन्छ?', back: '{topic} मा फर्कौं', separate: 'यसका लागि छुट्टै सेक्सन खोलौं' },
};
export const SCOPE_CHOICES = ['RETURN', 'SEPARATE'] as const;
export type ScopeChoice = (typeof SCOPE_CHOICES)[number];
export interface ScopeRedirect { topic: string; kind: ScopeKind; intro: string; choices: { id: ScopeChoice; label: string }[] }

export function redirectCopy(card: ScopeCard, locale?: string | null): ScopeRedirect {
  const c = COPY[copyLang(locale)];
  return { topic: card.topic, kind: card.kind, intro: c.intro, choices: [{ id: 'RETURN', label: fill(c.back, { topic: card.topic }) }, { id: 'SEPARATE', label: c.separate }] };
}

/** Prompt block for the turn the drift was detected. The reply stays the model's own, in the person's language. */
export function redirectBlock(card: ScopeCard): string {
  return `TOPIC REDIRECT FOR THIS REPLY: the person's last message looks like something other than this section ("${card.topic}"). In your own warm words and the person's language: acknowledge what they said in one short sentence (do not work through it in depth), then offer exactly TWO choices in one short sentence: (1) go back to ${card.topic}, or (2) open a separate section for this new thing. No lecturing, no refusal, no more than three short sentences in total. If they seem upset, forget the choices and just be with them.`;
}

/** What the app can do once the person picks "open a separate section": a suggested new-section action (the person still decides). */
export const NEW_SECTION_ACTION = { id: 'NEW_SECTION', kind: 'NEW_SECTION', deepLink: { route: 'SessionLobby' } } as const;
