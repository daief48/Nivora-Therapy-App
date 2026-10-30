import { z } from 'zod';
import type { Db } from '../config/database.js';
import type { GlmClient } from './glmClient.js';
import type { Cipher } from '../utils/crypto.js';
import { checkOutput } from './safetyService.js';
import { bumpTheme, continuityEnabled, EMPTY_NOTE, themeKeyOf, type NoteContent } from './therapyData.js';

/** Produces the SessionNote (+ homework, themes, legacy summary) for a session exactly once (idempotent via finalizedAt). Never throws. */
export interface FinalizeDeps { db: Db; glm: GlmClient; cipher: Cipher }
export type FinalizeReason = 'USER_END' | 'IDLE' | 'ABANDONED';

const str = (n: number) => z.string().trim().min(1).max(n);
const list = (n: number, len: number) => z.array(str(len)).max(n).default([]);
export const noteSchema = z.object({
  summary: z.string().trim().max(1500).default(''), progressNote: z.string().trim().max(800).default(''),
  agenda: list(6, 200), themes: list(6, 60), techniques: list(6, 100), keyInsights: list(6, 300), unresolved: list(6, 300), homework: list(4, 200),
});

const LANGS: Record<string, string> = { bn: 'Bangla', en: 'English', hi: 'Hindi (हिन्दी)', ne: 'Nepali (नेपाली)' };
const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(t.slice(a, b + 1));
}

const noteIsSafe = (n: NoteContent) => [n.summary, n.progressNote, ...n.agenda, ...n.themes, ...n.techniques, ...n.keyInsights, ...n.unresolved, ...n.homework].every((t) => checkOutput(t).ok);

/** Rule-based minimal note used when the model fails or its output is rejected. No user text is copied into it. */
function fallbackNote(userMsgs: number, lang: string): NoteContent {
  const s = lang === 'bn' ? `এই সেশনে ${userMsgs}টি বার্তা শেয়ার করা হয়েছে।`
    : lang === 'hi' ? `इस सत्र में ${userMsgs} संदेश साझा किए गए।`
    : lang === 'ne' ? `यो सत्रमा ${userMsgs} सन्देश साझा गरियो।`
    : `You shared ${userMsgs} message${userMsgs === 1 ? '' : 's'} in this guided session.`;
  return { ...EMPTY_NOTE, summary: s };
}

async function buildNote(d: FinalizeDeps, session: { id: string; language: string }, transcript: string, userMsgs: number): Promise<{ note: NoteContent; usage?: { i: number; o: number } }> {
  const lang = LANGS[session.language] ?? 'the same mix of Bangla and English';
  try {
    const r = await d.glm.chat([
      {
        role: 'system', content: `You write a short, factual session note for a self-help wellness guided session (the companion is an AI, not a clinician). Write in ${lang}. Reply with ONLY strict JSON of this shape: {"summary":string (2-4 sentences),"progressNote":string (1-2 sentences, self-reported only),"agenda":string[],"themes":string[] (short labels, max 4),"techniques":string[] (skills practised),"keyInsights":string[] (in the user's own words where possible),"unresolved":string[],"homework":string[] (0-3 small optional practices the user agreed to)}. Never diagnose, never name disorders, never prescribe, never invent content that was not discussed.`,
      },
      { role: 'user', content: transcript },
    ], { maxTokens: 700 });
    const note = { ...EMPTY_NOTE, ...noteSchema.parse(extractJson(r.content)) };
    if (!noteIsSafe(note)) throw new Error('unsafe');
    return { note, usage: { i: r.inputTokens, o: r.outputTokens } };
  } catch {
    return { note: fallbackNote(userMsgs, session.language) };
  }
}

export async function finalizeSession(d: FinalizeDeps, sessionId: string, reason: FinalizeReason): Promise<void> {
  try {
    const s = await d.db.therapySession.findUnique({ where: { id: sessionId } });
    if (!s || s.finalizedAt) return;
    // claim the work first so concurrent runs cannot double-finalize
    const claim = await d.db.therapySession.updateMany({
      where: { id: sessionId, finalizedAt: null },
      data: { finalizedAt: new Date(), ...(reason !== 'USER_END' && s.status !== 'ENDED' ? { status: 'ENDED', endedAt: new Date() } : {}) },
    });
    if (claim.count === 0) return;
    if (s.status !== 'ENDED' && !s.endedAt && reason === 'USER_END') await d.db.therapySession.update({ where: { id: sessionId }, data: { status: 'ENDED', endedAt: new Date() } });

    const flagged = await d.db.safetyEvent.count({ where: { sessionId, severity: { in: ['HIGH', 'IMMINENT'] } } });
    const crisis = flagged > 0 || s.riskFlag === 'HIGH';
    if (crisis) { // crisis text is never summarised; finalize with an empty note
      if (s.riskFlag !== 'HIGH') await d.db.therapySession.update({ where: { id: sessionId }, data: { riskFlag: 'HIGH' } });
      await d.db.sessionNote.upsert({
        where: { sessionId }, create: { sessionId, userId: s.userId, encryptedContent: d.cipher.encrypt(JSON.stringify(EMPTY_NOTE)) },
        update: { encryptedContent: d.cipher.encrypt(JSON.stringify(EMPTY_NOTE)) },
      });
      return;
    }
    if (!s.rememberThis) return; // nothing at all is kept

    const msgs = await d.db.sessionMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 80 });
    if (msgs.length < 2) return;
    const userMsgs = msgs.filter((m) => m.role === 'user').length;
    const transcript = msgs.map((m) => `${m.role}: ${d.cipher.decrypt(m.encryptedContent)}`).join('\n');
    const { note, usage } = await buildNote(d, s, transcript, userMsgs);

    await d.db.sessionNote.upsert({
      where: { sessionId }, create: { sessionId, userId: s.userId, encryptedContent: d.cipher.encrypt(JSON.stringify(note)) },
      update: { encryptedContent: d.cipher.encrypt(JSON.stringify(note)) },
    });
    if (note.summary) {
      await d.db.sessionSummary.upsert({
        where: { sessionId }, create: { sessionId, encryptedSummary: d.cipher.encrypt(note.summary) },
        update: { encryptedSummary: d.cipher.encrypt(note.summary) },
      });
    }
    if (usage) await d.db.usageRecord.create({ data: { userId: s.userId, sessionId, inputTokens: usage.i, outputTokens: usage.o } });

    const due = dateStr(new Date(Date.now() + 7 * 86_400_000));
    const existing = await d.db.homework.count({ where: { sessionId } });
    if (!existing && note.homework.length) {
      await d.db.homework.createMany({ data: note.homework.map((h) => ({ userId: s.userId, sessionId, titleEncrypted: d.cipher.encrypt(h), dueDate: due })) });
    }
    if (await continuityEnabled(d.db, s.userId)) {
      const seen = new Map(note.themes.map((x) => [themeKeyOf(s.userId, x), x]));
      for (const t of seen.values()) await bumpTheme(d.db, d.cipher, s.userId, t);
    }
  } catch {
    // never throws to callers; a failed run leaves finalizedAt set only if the claim succeeded (note stays absent)
  }
}
