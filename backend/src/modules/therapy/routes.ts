import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';
import { lifeSummaryOf, listMemories } from '../../services/memoryService.js';
import { EMPTY_NOTE, getActivePlan, getHomework, savePlan, themeKeyOf, type NoteContent, type PlanContent } from '../../services/therapyData.js';

const id = z.object({ id: z.string().uuid() });
const s = (n: number) => z.string().trim().min(1).max(n);
const planBody = z.object({
  goals: z.array(z.object({ id: s(40), title: s(200), note: z.string().trim().max(500).optional() })).max(10),
  focusAreas: z.array(s(80)).max(10),
  approach: z.enum(['CBT', 'MI', 'ACT', 'MIXED']), pace: z.enum(['GENTLE', 'STEADY']), tone: z.enum(['WARM', 'DIRECT']),
  language: z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']),
  background: z.string().trim().max(1500).optional(), whatHelps: z.string().trim().max(800).optional(), whatDoesnt: z.string().trim().max(800).optional(),
});
const noteEdit = z.object({
  summary: z.string().trim().max(1500).optional(), themes: z.array(s(60)).max(6).optional(), keyInsights: z.array(s(300)).max(6).optional(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const mood = z.object({ moodBefore: z.number().int().min(1).max(10).optional(), moodAfter: z.number().int().min(1).max(10).optional() })
  .refine((b) => (b.moodBefore === undefined) !== (b.moodAfter === undefined), 'Provide exactly one of moodBefore or moodAfter');
const schedule = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).max(7), timeMin: z.number().int().min(0).max(1439),
  lengthMin: z.union([z.literal(15), z.literal(30), z.literal(45)]), remindersOn: z.boolean(),
});
const prefsBody = z.object({ continuityOptIn: z.boolean().optional(), qualityReviewOptIn: z.boolean().optional(), guidedAck: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const PREF_DEFAULTS = { continuityOptIn: false, qualityReviewOptIn: false, guidedAck: false };

export function therapyRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const { db, cipher } = d;
  const dec = <T,>(v: string) => JSON.parse(cipher.decrypt(v)) as T;
  const noteOf = (enc: string): NoteContent => ({ ...EMPTY_NOTE, ...dec<Partial<NoteContent>>(enc) });
  const owned = async (userId: string, sid: string) => {
    const x = await db.therapySession.findFirst({ where: { id: sid, userId }, include: { note: true } });
    if (!x) throw notFound('Session not found'); // same response for "not yours" and "doesn't exist"
    return x;
  };
  const sessionHead = (x: any) => ({
    sessionId: x.id, startedAt: x.startedAt, endedAt: x.endedAt, sessionType: x.sessionType, lengthMin: x.lengthMin, phase: x.phase,
    isIntake: x.isIntake, moodBefore: x.moodBefore, moodAfter: x.moodAfter, finalized: !!x.finalizedAt,
  });
  const prefsOf = async (userId: string) => {
    const p = await db.userProfile.findUnique({ where: { userId }, select: { preferencesJson: true } });
    return { ...(p?.preferencesJson ?? {}) as Record<string, unknown> };
  };
  const hwView = (h: { id: string; sessionId: string | null; title: string; dueDate: string | null; status: string; feedback: string | null; createdAt: Date }) => h;

  // ---- plan ----
  r.get('/plan', asyncHandler(async (req, res) => {
    const cur = await getActivePlan(db, cipher, req.user.id);
    const history = await db.treatmentPlan.findMany({ where: { userId: req.user.id }, orderBy: { version: 'desc' }, select: { version: true, createdAt: true }, take: 50 });
    res.json({ data: { plan: cur?.plan ?? null, version: cur?.version ?? null, history } });
  }));
  r.put('/plan', validate({ body: planBody }), asyncHandler(async (req, res) => {
    const version = await savePlan(db, cipher, req.user.id, req.body as PlanContent);
    res.json({ data: { plan: req.body, version } });
  }));

  // ---- sessions ----
  r.get('/sessions', validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) }), asyncHandler(async (req, res) => {
    const { limit } = q<{ limit: number }>(req);
    const rows = await db.therapySession.findMany({ where: { userId: req.user.id }, orderBy: { startedAt: 'desc' }, take: limit, include: { note: true } });
    const hw = await db.homework.groupBy({ by: ['sessionId'], where: { userId: req.user.id, sessionId: { in: rows.map((x) => x.id) } }, _count: { _all: true } });
    const counts = new Map(hw.map((h) => [h.sessionId, h._count._all]));
    res.json({
      data: rows.map((x) => {
        const n = x.note ? noteOf(x.note.encryptedContent) : null;
        return { ...sessionHead(x), themes: n?.themes ?? [], summary: n?.summary ?? null, progressNote: n?.progressNote ?? null, homeworkCount: counts.get(x.id) ?? 0 };
      }),
    });
  }));
  r.get('/sessions/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    const x = await owned(req.user.id, req.params.id);
    const hw = (await getHomework(db, cipher, req.user.id)).filter((h) => h.sessionId === x.id);
    const messageCount = await db.sessionMessage.count({ where: { sessionId: x.id } });
    res.json({ data: { ...sessionHead(x), rememberThis: x.rememberThis, note: x.note ? noteOf(x.note.encryptedContent) : null, homework: hw.map(hwView), messageCount } });
  }));
  r.patch('/sessions/:id/note', validate({ params: id, body: noteEdit }), asyncHandler(async (req, res) => {
    const x = await owned(req.user.id, req.params.id);
    if (!x.note) throw notFound('No note for this session');
    const note = { ...noteOf(x.note.encryptedContent), ...req.body } as NoteContent;
    await db.sessionNote.update({ where: { sessionId: x.id }, data: { encryptedContent: cipher.encrypt(JSON.stringify(note)) } });
    res.json({ data: { sessionId: x.id, note } });
  }));
  r.post('/sessions/:id/mood', validate({ params: id, body: mood }), asyncHandler(async (req, res) => {
    const x = await owned(req.user.id, req.params.id);
    const u = await db.therapySession.update({ where: { id: x.id }, data: req.body });
    res.json({ data: { sessionId: u.id, moodBefore: u.moodBefore, moodAfter: u.moodAfter } });
  }));
  r.delete('/sessions/:id', validate({ params: id }), asyncHandler(async (req, res) => {
    const x = await owned(req.user.id, req.params.id);
    if (x.note) {
      for (const label of noteOf(x.note.encryptedContent).themes) {
        const where = { userId_themeKey: { userId: req.user.id, themeKey: themeKeyOf(req.user.id, label) } };
        const t = await db.themeTracker.findUnique({ where });
        if (!t) continue;
        if (t.count <= 1) await db.themeTracker.delete({ where }); else await db.themeTracker.update({ where, data: { count: { decrement: 1 } } });
      }
    }
    await db.$transaction([
      db.homework.deleteMany({ where: { userId: req.user.id, sessionId: x.id } }),
      db.safetyEvent.updateMany({ where: { sessionId: x.id }, data: { sessionId: null } }),
      db.therapySession.delete({ where: { id: x.id } }), // cascades messages, note, summary
    ]);
    res.status(204).end();
  }));

  // ---- homework ----
  r.get('/homework', validate({ query: z.object({ status: z.enum(['ASSIGNED', 'DONE', 'SKIPPED']).optional() }) }), asyncHandler(async (req, res) => {
    res.json({ data: (await getHomework(db, cipher, req.user.id, q<{ status?: string }>(req).status)).map(hwView) });
  }));
  r.post('/homework/:id/complete', validate({ params: id, body: z.object({ status: z.enum(['DONE', 'SKIPPED']), feedback: z.string().trim().max(1000).optional() }) }), asyncHandler(async (req, res) => {
    const h = await db.homework.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!h) throw notFound('Homework not found');
    const u = await db.homework.update({
      where: { id: h.id },
      data: { status: req.body.status, completedAt: new Date(), feedbackEncrypted: req.body.feedback ? cipher.encrypt(req.body.feedback) : null },
    });
    res.json({ data: { id: u.id, status: u.status, completedAt: u.completedAt } });
  }));

  // ---- themes ----
  r.get('/themes', asyncHandler(async (req, res) => {
    const rows = await db.themeTracker.findMany({ where: { userId: req.user.id }, orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }], take: 50 });
    res.json({ data: rows.map((t) => ({ id: t.id, label: cipher.decrypt(t.labelEncrypted), count: t.count, lastSeenAt: t.lastSeenAt })) });
  }));

  // ---- schedule ----
  const schedView = (x: { weekdays: number[]; timeMin: number; lengthMin: number; remindersOn: boolean } | null) =>
    x ? { weekdays: x.weekdays, timeMin: x.timeMin, lengthMin: x.lengthMin, remindersOn: x.remindersOn } : null;
  r.get('/schedule', asyncHandler(async (req, res) => {
    res.json({ data: schedView(await db.sessionSchedule.findUnique({ where: { userId: req.user.id } })) });
  }));
  r.put('/schedule', validate({ body: schedule }), asyncHandler(async (req, res) => {
    const weekdays = [...new Set<number>(req.body.weekdays)].sort();
    const row = await db.sessionSchedule.upsert({
      where: { userId: req.user.id }, create: { userId: req.user.id, ...req.body, weekdays }, update: { ...req.body, weekdays },
    });
    res.json({ data: schedView(row) });
  }));

  // ---- preferences ----
  r.get('/preferences', asyncHandler(async (req, res) => {
    const p = await prefsOf(req.user.id);
    res.json({ data: Object.fromEntries(Object.entries(PREF_DEFAULTS).map(([k, v]) => [k, typeof p[k] === 'boolean' ? p[k] : v])) });
  }));
  r.put('/preferences', validate({ body: prefsBody }), asyncHandler(async (req, res) => {
    const merged = { ...(await prefsOf(req.user.id)), ...req.body };
    const upd = await db.userProfile.updateMany({ where: { userId: req.user.id }, data: { preferencesJson: merged } });
    if (upd.count === 0) throw notFound('Profile not found');
    res.json({ data: Object.fromEntries(Object.entries(PREF_DEFAULTS).map(([k, v]) => [k, typeof merged[k] === 'boolean' ? merged[k] : v])) });
  }));

  // ---- memory overview (what Nivora remembers; shown even when continuity is off so it can always be reviewed and deleted) ----
  r.get('/memory-overview', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const mems = await listMemories(db, cipher, userId, { take: 500 });
    const mv = (m: (typeof mems)[number]) => ({ id: m.id, text: m.text, kind: m.kind, source: m.source, createdAt: m.createdAt, updated: m.updated });
    const life = lifeSummaryOf(mems);
    const pinned = [...(life ? [mv(life)] : []), ...mems.filter((m) => m.kind === 'HELPS' || m.kind === 'DOESNT_HELP').slice(0, 3).map(mv)];
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const recent = mems.filter((m) => !pinnedIds.has(m.id)).sort((a, b) => (b.updatedAt ?? b.createdAt).getTime() - (a.updatedAt ?? a.createdAt).getTime()).slice(0, 8).map(mv);
    const themeRows = await db.themeTracker.findMany({ where: { userId }, orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }], take: 8 });
    const [notes, homework] = await Promise.all([db.sessionNote.count({ where: { userId } }), db.homework.count({ where: { userId } })]);
    res.json({ data: {
      pinned, recent,
      themes: themeRows.map((t) => ({ id: t.id, label: cipher.decrypt(t.labelEncrypted), count: t.count, lastSeenAt: t.lastSeenAt })),
      counts: { user: mems.filter((m) => m.source === 'USER').length, session: mems.filter((m) => m.source === 'SESSION').length, notes, homework },
    } });
  }));

  // ---- export / delete ----
  r.get('/export', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const plans = await db.treatmentPlan.findMany({ where: { userId }, orderBy: { version: 'asc' } });
    const sessions = await db.therapySession.findMany({ where: { userId }, orderBy: { startedAt: 'asc' }, include: { note: true } });
    const themes = await db.themeTracker.findMany({ where: { userId }, orderBy: { count: 'desc' } });
    const out = {
      exportedAt: new Date().toISOString(),
      preferences: await prefsOf(userId),
      plans: plans.map((p) => ({ version: p.version, active: p.active, createdAt: p.createdAt, plan: dec<PlanContent>(p.encryptedContent) })),
      sessions: sessions.map((x) => ({ ...sessionHead(x), phase: x.phase, rememberThis: x.rememberThis, note: x.note ? noteOf(x.note.encryptedContent) : null })),
      homework: await getHomework(db, cipher, userId),
      themes: themes.map((t) => ({ label: cipher.decrypt(t.labelEncrypted), count: t.count, lastSeenAt: t.lastSeenAt })),
      schedule: schedView(await db.sessionSchedule.findUnique({ where: { userId } })),
      memories: (await listMemories(db, cipher, userId, { take: 1000 })).map((m) => ({ text: m.text, kind: m.kind, source: m.source, createdAt: m.createdAt })),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="nivora-guided-sessions-export.json"');
    res.json({ data: out });
  }));
  r.delete('/data', validate({ query: z.object({ includeSessions: z.enum(['true', 'false']).default('false') }) }), asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const all = q<{ includeSessions: string }>(req).includeSessions === 'true';
    await db.$transaction([
      db.sessionNote.deleteMany({ where: { userId } }),
      db.treatmentPlan.deleteMany({ where: { userId } }),
      db.homework.deleteMany({ where: { userId } }),
      db.themeTracker.deleteMany({ where: { userId } }),
      db.memory.deleteMany({ where: { userId, source: 'SESSION' } }),
      db.sessionSchedule.deleteMany({ where: { userId } }),
      db.sessionSummary.deleteMany({ where: { session: { userId, ...(all ? {} : { OR: [{ lengthMin: { gt: 0 } }, { isIntake: true }, { phase: { not: 'OPENING' } }] }) } } }),
      all
        ? db.therapySession.deleteMany({ where: { userId } })
        : db.therapySession.updateMany({ where: { userId }, data: { lengthMin: 0, phase: 'OPENING', isIntake: false, moodBefore: null, moodAfter: null } }),
    ]);
    res.status(204).end();
  }));

  return r;
}
