import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { PROGRAM_IDS, PROGRAMS, type Lang, type ProgramDef, type ProgramId } from '../../services/programContent.js';
import { daysBetween, localDate } from '../../utils/dates.js';
import { conflict, notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const DAY_MS = 86_400_000;
const params = z.object({ id: z.enum(PROGRAM_IDS as [ProgramId, ...ProgramId[]]) });
const dayParams = params.extend({ day: z.coerce.number().int().min(1).max(21) });

export function programsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  async function who(userId: string) {
    const u = await d.db.user.findUnique({ where: { id: userId } });
    return { tz: u?.timezone ?? 'UTC', lang: (u?.locale === 'bn' ? 'bn' : 'en') as Lang };
  }
  const find = (userId: string, programId: string) => d.db.programEnrollment.findUnique({ where: { userId_programId: { userId, programId } } });
  const startedMs = (day: number) => new Date(Date.now() - (day - 1) * DAY_MS);

  /** Days open so far: one per calendar day in the user's timezone, capped at the programme length. Gaps never lock anything. */
  function unlocked(e: any, p: ProgramDef, tz: string) {
    if (!e) return 0;
    return Math.max(1, Math.min(p.days, daysBetween(localDate(tz, e.startedAt), localDate(tz)) + 1));
  }
  const nextDay = (e: { completedDays: number[] }, p: ProgramDef) => {
    for (let n = 1; n <= p.days; n++) if (!e.completedDays.includes(n)) return n;
    return null;
  };
  const summary = (p: ProgramDef, e: any, lang: Lang, tz: string) => ({
    id: p.id, days: p.days, title: p.title[lang], description: p.description[lang], safety: p.safety[lang],
    enrolled: !!e, status: e?.status ?? null, completedDays: e?.completedDays ?? [], completedCount: e?.completedDays.length ?? 0,
    unlockedDay: unlocked(e, p, tz), nextDay: e ? nextDay(e, p) : 1,
  });
  const dayView = (p: ProgramDef, n: number, lang: Lang) => {
    const c = p.content[n - 1]!;
    return { day: n, title: c.title[lang], lesson: c.lesson[lang], reflection: c.reflection[lang], practice: { text: c.practice[lang], minutes: c.practice.minutes, exercise: c.practice.exercise, kaizen: c.practice.kaizen } };
  };

  r.get('/', asyncHandler(async (req, res) => {
    const { tz, lang } = await who(req.user.id);
    const rows = await d.db.programEnrollment.findMany({ where: { userId: req.user.id } });
    res.json({ data: PROGRAM_IDS.map((id) => summary(PROGRAMS[id], rows.find((x) => x.programId === id), lang, tz)) });
  }));

  r.get('/:id', validate({ params }), asyncHandler(async (req, res) => {
    const p = PROGRAMS[req.params.id as ProgramId];
    const { tz, lang } = await who(req.user.id);
    const e = await find(req.user.id, p.id);
    const open = unlocked(e, p, tz);
    // Lessons are only revealed up to the current unlocked day; the rest are listed as locked titles-free placeholders.
    const days = Array.from({ length: p.days }, (_, i) => {
      const n = i + 1;
      return n <= open ? { ...dayView(p, n, lang), locked: false, completed: !!e?.completedDays.includes(n) } : { day: n, locked: true, completed: false };
    });
    res.json({ data: { ...summary(p, e, lang, tz), disclaimer: lang === 'bn' ? 'নিভোরা একটি সুস্থতার সঙ্গী, থেরাপি বা চিকিৎসা নয়।' : 'Nivora is a wellness companion, not therapy or medical treatment.', content: days } });
  }));

  r.post('/:id/enroll', validate({ params }), asyncHandler(async (req, res) => {
    const p = PROGRAMS[req.params.id as ProgramId];
    const { tz, lang } = await who(req.user.id);
    let e = await find(req.user.id, p.id);
    if (!e) e = await d.db.programEnrollment.create({ data: { userId: req.user.id, programId: p.id } });
    else if (e.status === 'PAUSED') {
      // Resuming picks up at the next unfinished day; paused time never counts as a gap.
      const n = nextDay(e, p);
      e = await d.db.programEnrollment.update({ where: { id: e.id }, data: { status: n ? 'ACTIVE' : 'COMPLETED', startedAt: startedMs(n ?? p.days) } });
    }
    res.status(201).json({ data: summary(p, e, lang, tz) });
  }));

  r.post('/:id/pause', validate({ params }), asyncHandler(async (req, res) => {
    const p = PROGRAMS[req.params.id as ProgramId];
    const { tz, lang } = await who(req.user.id);
    const e = await find(req.user.id, p.id);
    if (!e) throw notFound('Programme not started');
    const u = e.status === 'ACTIVE' ? await d.db.programEnrollment.update({ where: { id: e.id }, data: { status: 'PAUSED' } }) : e;
    res.json({ data: summary(p, u, lang, tz) });
  }));

  r.post('/:id/days/:day/complete', validate({ params: dayParams }), asyncHandler(async (req, res) => {
    const p = PROGRAMS[req.params.id as ProgramId];
    const day = req.params.day as unknown as number;
    if (day > p.days) throw notFound('Day not found');
    const { tz, lang } = await who(req.user.id);
    let e = await find(req.user.id, p.id);
    if (!e) throw notFound('Programme not started');
    if (!e.completedDays.includes(day)) {
      if (e.status === 'PAUSED') throw conflict('Programme is paused');
      if (day > unlocked(e, p, tz)) throw conflict('This day is not open yet');
      const done = [...e.completedDays, day].sort((a, b) => a - b);
      const finished = done.length >= p.days;
      // After a gap, re-anchor so the next day opens tomorrow rather than all at once.
      const behind = unlocked(e, p, tz) > Math.max(...done);
      e = await d.db.programEnrollment.update({ where: { id: e.id }, data: { completedDays: done, status: finished ? 'COMPLETED' : 'ACTIVE', ...(behind ? { startedAt: startedMs(Math.max(...done)) } : {}) } });
    }
    const finished = e.status === 'COMPLETED';
    const message = lang === 'bn'
      ? (finished ? 'আপনি পুরো প্রোগ্রামটি শেষ করেছেন। নিজের জন্য সময় দেওয়ার জন্য ধন্যবাদ।' : 'আজকের দিন শেষ হলো। ছোট পদক্ষেপও গুরুত্বপূর্ণ। পরের দিন আসলে আবার দেখা হবে।')
      : (finished ? 'You finished the whole programme. Thank you for making time for yourself.' : 'Today is done. Small steps count. The next day will be waiting whenever you come back.');
    res.json({ data: { ...summary(p, e, lang, tz), message } });
  }));
  return r;
}
