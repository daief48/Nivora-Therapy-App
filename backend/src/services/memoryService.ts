import { z } from 'zod';
import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { asciiDigits } from './piiScrubber.js';
import type { GlmClient } from './glmClient.js';
import { assessSafely, checkSpokenOutput } from './safetyService.js';
import { parseJsonLoose } from './sessionEngine.js';
import { continuityEnabled, themeKeyOf } from './therapyData.js';

/**
 * Long-term memory layer. Durable facts are extracted after a finalized session (only with continuity on and rememberThis),
 * stored as Memory rows with source 'SESSION' (AES-GCM encrypted JSON), de-duplicated and kept up to date. Rows the user added
 * themselves (source 'USER') stay plain encrypted text. Nothing here is a clinical profile; crisis text never reaches it.
 */
export const MEMORY_KINDS = ['PERSON', 'EVENT', 'WORK_STUDY', 'HELPS', 'DOESNT_HELP', 'PREFERENCE', 'PAST', 'SUMMARY', 'FACT'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const SESSION_MEMORY_CAP = 120;
/** When the cap is hit the oldest facts are merged into the life summary until this many remain. */
export const SESSION_MEMORY_FLOOR = 100;
export const MAX_FACTS_PER_SESSION = 8;
/** Extraction (and an automatic starting plan) needs at least this many user messages in the session. */
export const MIN_USER_MESSAGES = 3;
export const FACT_MAX_CHARS = 240;
export const USER_MEMORY_LIMIT = 50;

export interface MemoryView {
  id: string; text: string; source: 'USER' | 'SESSION'; kind: MemoryKind; createdAt: Date;
  /** True when a newer session replaced an older version of this fact. */
  updated: boolean; updatedAt: Date | null; sessionId: string | null;
}
interface Packed { v: 1; t: string; k: MemoryKind; u?: string; s?: string; was?: string }
interface MemoryRow { id: string; encryptedContent: string; source: string; createdAt: Date }

// ---------- encoding ----------

const isKind = (k: unknown): k is MemoryKind => typeof k === 'string' && (MEMORY_KINDS as readonly string[]).includes(k);
export const packSessionMemory = (cipher: Cipher, p: Omit<Packed, 'v'>) => cipher.encrypt(JSON.stringify({ v: 1, ...p }));

export function decodeMemory(cipher: Cipher, row: MemoryRow): MemoryView {
  const plain = cipher.decrypt(row.encryptedContent);
  const base = { id: row.id, createdAt: row.createdAt };
  if (row.source === 'SESSION') {
    try {
      const p = JSON.parse(plain) as Partial<Packed>;
      if (p && typeof p.t === 'string') {
        return {
          ...base, text: p.t, source: 'SESSION', kind: isKind(p.k) ? p.k : 'FACT', updated: !!p.u, updatedAt: p.u ? new Date(p.u) : null,
          sessionId: typeof p.s === 'string' ? p.s : null,
        };
      }
    } catch { /* plain text row */ }
  }
  return { ...base, text: plain, source: row.source === 'SESSION' ? 'SESSION' : 'USER', kind: 'FACT', updated: false, updatedAt: null, sessionId: null };
}

export async function listMemories(
  db: Db, cipher: Cipher, userId: string, opts: { source?: 'USER' | 'SESSION' | 'all'; take?: number } = {},
): Promise<MemoryView[]> {
  const where = { userId, ...(opts.source && opts.source !== 'all' ? { source: opts.source } : {}) };
  const rows = await db.memory.findMany({ where, orderBy: { createdAt: 'desc' }, take: opts.take ?? 300 });
  return rows.map((r) => decodeMemory(cipher, r));
}

/** Rewrites the text of one memory (user-scoped). Returns null when the row is not theirs. */
export async function rewriteMemory(db: Db, cipher: Cipher, userId: string, id: string, text: string, mark = true): Promise<MemoryView | null> {
  const row = await db.memory.findFirst({ where: { id, userId } });
  if (!row) return null;
  const cur = decodeMemory(cipher, row);
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, row.source === 'SESSION' ? FACT_MAX_CHARS : 300);
  const enc = row.source === 'SESSION'
    ? packSessionMemory(cipher, { t: clean, k: cur.kind, ...(cur.sessionId ? { s: cur.sessionId } : {}), ...(mark ? { u: new Date().toISOString() } : {}) })
    : cipher.encrypt(clean);
  const upd = await db.memory.updateMany({ where: { id, userId }, data: { encryptedContent: enc } });
  return upd.count ? { ...cur, text: clean, updated: row.source === 'SESSION' ? mark : false, updatedAt: mark ? new Date() : cur.updatedAt } : null;
}

// ---------- text normalisation, similarity, relevance ----------

const INDIC = /[ऀ-ॿঀ-৿]/;
const SUFFIXES = ['য়ের', 'দের', 'ের', 'কে', 'তে', 'টির', 'টার', 'টা', 'টি', 'র', 'ে', 'ाओं', 'ों', 'ें', 'हरू', 'हरु', 'लाई', 'को', 'का', 'की', 'ले', 'मा']
  .map((s) => s.normalize('NFC')).sort((a, b) => b.length - a.length);
const STOP = new Set(('the a an and or of to in on at is are was were be been being i me my mine we our you your it its that this these those with for from by as but not no do ' +
  'does did have has had will would can could should about what which who whom when where how so just very also too then than there here am im ok okay please ' +
  'remember forget told said tell tells let lets again really like get got going go it\'s dont don\'t ' +
  'আমার আমি আমাকে তুমি তুমার এই এটা এটি ওটা সেটা যা কি কী না ও এবং থেকে জন্য সম্পর্কে বিষয়ে ব্যাপারে নিয়ে আছে ছিল হয় করে করা বলেছি তা সব ' +
  'मेरा मेरी मेरे मैं मुझे हम हमारे तुम आप यह वह ये वो है हैं था थी थे कि और या से को का की के में पर भी तो जो कहा बारे ' +
  'मेरो म मलाई हाम्रो तिमी तपाईं यो त्यो छ हो थियो र वा को लाई बारेमा भनेको').split(/\s+/).map((s) => s.normalize('NFC')));

/** Lowercase content tokens (Latin, Bangla, Devanagari) with light suffix stripping, stop words removed. */
export function contentTokens(text: string): string[] {
  const raw = text.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (let t of raw) {
    if (STOP.has(t)) continue;
    if (INDIC.test(t)) {
      t = t.replace(/[ँं]/g, ''); // chandrabindu / anusvara: माँ == मां
      const suf = SUFFIXES.find((s) => t.endsWith(s) && t.length - s.length >= 2);
      if (suf) t = t.slice(0, -suf.length);
      if (t.length < 2 || STOP.has(t)) continue;
    } else {
      if (/^\d+$/.test(t) ? t.length < 2 : t.length < 3) continue;
      if (/^[a-z]+$/.test(t) && t.length > 4) t = t.replace(/(?:ing|ed|es|s|ly)$/, '');
    }
    out.push(t);
  }
  return [...new Set(out)];
}
const tokEq = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));
const hasTok = (set: string[], t: string) => set.some((x) => tokEq(x, t));

/** Overlap coefficient of content tokens (0..1). Needs at least two content tokens on each side to count. */
export function similarity(a: string, b: string): number {
  const ta = contentTokens(a), tb = contentTokens(b);
  if (ta.length < 2 || tb.length < 2) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  const shared = ta.filter((t) => hasTok(tb, t)).length;
  return shared / Math.min(ta.length, tb.length);
}

/** Lexical relevance of a document to a query (0 = unrelated). Longer shared words count a little more. */
export function relevanceScore(queryTokens: string[], docText: string): number {
  if (!queryTokens.length) return 0;
  const doc = contentTokens(docText);
  let s = 0;
  for (const q of queryTokens) if (hasTok(doc, q)) s += 1 + Math.min(q.length, 10) / 10;
  return s;
}

/** How many of the query tokens occur in the text. */
export function tokensMatchedIn(queryTokens: string[], text: string): number {
  const doc = contentTokens(text);
  return queryTokens.filter((q) => hasTok(doc, q)).length;
}

export interface Rankable { text: string; at: Date }
/** The `limit` items most relevant to `query` (score > 0), with a gentle recency boost. Deterministic. */
export function rankRelevant<T extends Rankable>(query: string, items: T[], limit = 5, now = new Date()): T[] {
  const q = contentTokens(query).slice(0, 40);
  return items
    .map((it) => {
      const base = relevanceScore(q, it.text);
      const age = Math.max(0, (now.getTime() - it.at.getTime()) / 86_400_000);
      return { it, score: base * (1 + 0.5 * Math.exp(-age / 45)) };
    })
    .filter((x) => x.score >= 1.3)
    .sort((a, b) => b.score - a.score || b.it.at.getTime() - a.it.at.getTime())
    .slice(0, limit).map((x) => x.it);
}

// ---------- what may be stored ----------

const SECRET = [
  /\b(pass(?:word|code|wd)|pin(?: code| number)?|otp|cvv|cvc|card (?:number|no)|credit card|debit card|bank account|account (?:number|no)|ssn|social security|passport (?:number|no)|nid (?:number|no)|api key|secret key|private key|login)\b/i,
  /(পাসওয়ার্ড|পিন নম্বর|ওটিপি|কার্ড নম্বর|একাউন্ট নম্বর|অ্যাকাউন্ট নম্বর)/,
  /(पासवर्ड|पिन नंबर|ओटीपी|कार्ड नंबर|खाता संख्या|खाता नंबर)/,
  /(पासवर्ड|पिन नम्बर|कार्ड नम्बर|खाता नम्बर)/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, /\bhttps?:\/\/|www\./i,
];
export const hasSecret = (text: string) => SECRET.some((r) => r.test(text)) || /\d{9,}/.test(asciiDigits(text).replace(/[\s-]/g, ''));

export function cleanFact(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[-*•\d.)\s]+/, '').trim().slice(0, FACT_MAX_CHARS);
}
/** No secrets, no crisis content, no diagnosis / medication wording, and a sensible length. */
export function factIsStorable(text: string): boolean {
  const t = text.trim();
  return t.length >= 4 && t.length <= 400 && !hasSecret(t) && assessSafely(t).severity === 'NONE' && checkSpokenOutput(t).ok;
}

// ---------- extraction ----------

export interface MemoryDeps { db: Db; glm: GlmClient; cipher: Cipher }
const LANGS: Record<string, string> = { bn: 'Bangla', en: 'English', hi: 'Hindi (हिन्दी)', ne: 'Nepali (नेपाली)' };
const factsSchema = z.object({
  facts: z.array(z.object({ kind: z.enum(MEMORY_KINDS).catch('FACT'), text: z.string().trim().min(4).max(400) })).max(20),
});
const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clip = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…');

/** Life-summary row (one per user). */
export const lifeSummaryOf = (all: MemoryView[]) => all.find((m) => m.source === 'SESSION' && m.kind === 'SUMMARY') ?? null;

async function mergeIntoLifeSummary(d: MemoryDeps, userId: string, old: MemoryView[]) {
  const all = await listMemories(d.db, d.cipher, userId, { source: 'SESSION' });
  const cur = lifeSummaryOf(all);
  const lines = old.map((m) => m.text);
  let merged = '';
  try {
    const r = await d.glm.chat([
      { role: 'system', content: 'Merge the existing life summary and the new facts into ONE short summary (max 6 short sentences, under 900 characters) of what is durably known about this person, written in the same language as the facts. Plain text only. No diagnoses, no medication, no secrets. Only use what is given.' },
      { role: 'user', content: `Existing summary: ${cur?.text ?? '(none)'}\nNew facts:\n${lines.map((l) => `- ${l}`).join('\n')}` },
    ], { maxTokens: 400 });
    const t = r.content.replace(/\s+/g, ' ').trim();
    if (t.length >= 10 && t.length <= 1200 && factIsStorable(t)) merged = t;
  } catch { /* deterministic fallback below */ }
  if (!merged) merged = clip([cur?.text, ...lines].filter(Boolean).join(' '), 1200);
  const enc = packSessionMemory(d.cipher, { t: merged, k: 'SUMMARY', u: new Date().toISOString() });
  if (cur) await d.db.memory.updateMany({ where: { id: cur.id, userId }, data: { encryptedContent: enc } });
  else await d.db.memory.create({ data: { userId, source: 'SESSION', encryptedContent: enc } });
  await d.db.memory.deleteMany({ where: { userId, id: { in: old.map((m) => m.id) } } });
}

/** Keeps at most SESSION_MEMORY_CAP session facts: when exceeded, the oldest are merged into the rolling life summary. */
export async function enforceSessionMemoryCap(d: MemoryDeps, userId: string): Promise<number> {
  const facts = (await listMemories(d.db, d.cipher, userId, { source: 'SESSION', take: 1000 })).filter((m) => m.kind !== 'SUMMARY');
  if (facts.length <= SESSION_MEMORY_CAP) return 0;
  const stamp = (m: MemoryView) => (m.updatedAt ?? m.createdAt).getTime();
  const oldest = facts.sort((a, b) => stamp(a) - stamp(b)).slice(0, facts.length - SESSION_MEMORY_FLOOR);
  await mergeIntoLifeSummary(d, userId, oldest);
  return oldest.length;
}

/**
 * Extracts durable facts from a finalized session and stores them. Only with continuity on, rememberThis and no crisis flag.
 * Newer facts update older, similar ones instead of piling up. Never throws; returns the number of rows created or updated.
 */
export async function extractSessionMemories(d: MemoryDeps, sessionId: string): Promise<number> {
  try {
    const s = await d.db.therapySession.findUnique({ where: { id: sessionId } });
    if (!s || !s.rememberThis || s.riskFlag === 'HIGH') return 0;
    if (!(await continuityEnabled(d.db, s.userId))) return 0;
    if ((await d.db.safetyEvent.count({ where: { sessionId, severity: { in: ['HIGH', 'IMMINENT'] } } })) > 0) return 0;
    const msgs = await d.db.sessionMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 80 });
    if (msgs.filter((m) => m.role === 'user').length < MIN_USER_MESSAGES) return 0; // very short chats are small talk
    const transcript = msgs.map((m) => `${m.role === 'assistant' ? 'companion' : 'user'}: ${d.cipher.decrypt(m.encryptedContent)}`).join('\n').slice(0, 12_000);
    const lang = LANGS[s.language] ?? "the user's own language (the same mix they used)";
    const r = await d.glm.chat([
      {
        role: 'system',
        content: `You extract long-term memory notes for a wellness companion app (the companion is an AI, not a clinician). Today is ${dateStr(new Date())}. From the conversation, list up to ${MAX_FACTS_PER_SESSION} DURABLE facts the USER stated about their own life that would help a future conversation: people and relationships (names, who they are), upcoming events with dates (turn "Friday" into an exact date), work or study situation, what helps or does not help them, preferences, important past events. Each fact is ONE short sentence (max 200 characters) written in ${lang}. Reply with ONLY strict JSON: {"facts":[{"kind":"PERSON|EVENT|WORK_STUDY|HELPS|DOESNT_HELP|PREFERENCE|PAST|FACT","text":string}]}. Never include diagnoses, labels of disorders, medication, thoughts of self-harm or any crisis detail, passwords, card or account numbers, phone numbers or addresses. Skip small talk and anything uncertain. If there is nothing durable reply {"facts":[]}.`,
      },
      { role: 'user', content: transcript },
    ], { maxTokens: 600 });
    await d.db.usageRecord.create({ data: { userId: s.userId, sessionId, inputTokens: r.inputTokens, outputTokens: r.outputTokens } }).catch(() => undefined);
    const parsed = factsSchema.safeParse(parseJsonLoose(r.content));
    if (!parsed.success) return 0;

    // Re-check right before writing: the user may have switched memory off or changed this session while the model ran.
    const fresh = await d.db.therapySession.findUnique({ where: { id: sessionId }, select: { rememberThis: true } });
    if (!fresh?.rememberThis || !(await continuityEnabled(d.db, s.userId))) return 0;

    const known = await listMemories(d.db, d.cipher, s.userId, { take: 1000 });
    let changed = 0;
    for (const f of parsed.data.facts) {
      if (changed >= MAX_FACTS_PER_SESSION) break;
      const text = cleanFact(f.text);
      if (!factIsStorable(text)) continue;
      const kind: MemoryKind = f.kind === 'SUMMARY' ? 'FACT' : f.kind;
      let best: { m: MemoryView; sim: number } | null = null;
      for (const m of known) {
        if (m.kind === 'SUMMARY') continue;
        const sim = similarity(text, m.text);
        if (!best || sim > best.sim) best = { m, sim };
      }
      if (best && best.sim >= 0.85) continue; // already known
      if (best && best.sim >= 0.5 && best.m.source === 'SESSION' && (best.m.kind === kind || best.sim >= 0.65)) {
        // same topic, different details: the newest statement wins
        const enc = packSessionMemory(d.cipher, { t: text, k: kind, s: sessionId, u: new Date().toISOString(), was: best.m.text });
        await d.db.memory.updateMany({ where: { id: best.m.id, userId: s.userId }, data: { encryptedContent: enc } });
        Object.assign(best.m, { text, kind, updated: true, updatedAt: new Date(), sessionId });
        changed++;
        continue;
      }
      const row = await d.db.memory.create({ data: { userId: s.userId, source: 'SESSION', encryptedContent: packSessionMemory(d.cipher, { t: text, k: kind, s: sessionId }) } });
      known.push(decodeMemory(d.cipher, row));
      changed++;
    }
    await enforceSessionMemoryCap(d, s.userId);
    return changed;
  } catch {
    return 0;
  }
}

// ---------- forgetting ----------

/**
 * Removes what a session contributed to long-term memory: its session-derived facts, note (with its theme counts), homework and
 * legacy summary. Used when the user says "forget this session" and by the memory settings. User-added memories are untouched.
 */
export async function retractSessionContribution(d: { db: Db; cipher: Cipher }, userId: string, sessionId: string): Promise<void> {
  const mine = await d.db.therapySession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!mine) return;
  const facts = await listMemories(d.db, d.cipher, userId, { source: 'SESSION', take: 1000 });
  const ids = facts.filter((m) => m.sessionId === sessionId).map((m) => m.id);
  if (ids.length) await d.db.memory.deleteMany({ where: { userId, id: { in: ids } } });
  const note = await d.db.sessionNote.findUnique({ where: { sessionId } });
  if (note) {
    try {
      const themes = (JSON.parse(d.cipher.decrypt(note.encryptedContent)) as { themes?: string[] }).themes ?? [];
      for (const label of new Set(themes.map((t) => themeKeyOf(userId, t)))) {
        const row = await d.db.themeTracker.findUnique({ where: { userId_themeKey: { userId, themeKey: label } } });
        if (!row) continue;
        if (row.count <= 1) await d.db.themeTracker.delete({ where: { id: row.id } });
        else await d.db.themeTracker.update({ where: { id: row.id }, data: { count: { decrement: 1 } } });
      }
    } catch { /* unreadable note: just delete it */ }
    await d.db.sessionNote.deleteMany({ where: { sessionId, userId } });
  }
  await d.db.homework.deleteMany({ where: { sessionId, userId } });
  await d.db.sessionSummary.deleteMany({ where: { sessionId } });
}
