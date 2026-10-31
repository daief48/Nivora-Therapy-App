import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { durationMinutes, sleepScore } from '../../services/sleepService.js';
import { addDays, localDate } from '../../utils/dates.js';
import { activeConsents, requireConsent } from '../consents/consentService.js';
import { NEUTRAL_RESTED } from '../sleep/routes.js';
import type { Deps } from '../deps.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Device health import (Health Connect on Android, HealthKit on iOS). Needs the HEALTH_IMPORT consent.
 * Imported rows carry `source`; a night the user entered by hand is never overwritten; editing an imported night (PATCH /sleep/:id)
 * turns it into a manual one. Disconnecting deletes every row that is still imported and withdraws the consent.
 */
export function healthRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  r.get('/status', asyncHandler(async (req, res) => {
    const [consents, sleepRows, activityRows] = await Promise.all([
      activeConsents(d.db, req.user.id),
      d.db.sleepEntry.count({ where: { userId: req.user.id, source: { not: 'manual' } } }),
      d.db.dailyActivity.count({ where: { userId: req.user.id, source: { not: 'manual' } } }),
    ]);
    res.json({ data: { connected: consents.has('HEALTH_IMPORT'), importedSleepNights: sleepRows, importedActivityDays: activityRows } });
  }));

  r.post('/import', validate({ body: z.object({
    source: z.enum(['healthconnect', 'healthkit']),
    sleep: z.array(z.object({
      date, bedtime: hhmm, wakeTime: hhmm, awakenings: z.number().int().min(0).max(20).default(0), latencyMin: z.number().int().min(0).max(600).default(0),
    })).max(120).default([]),
    activity: z.array(z.object({
      date, steps: z.number().int().min(0).max(200_000).optional(), walkingMin: z.number().int().min(0).max(1440).optional(), exerciseMin: z.number().int().min(0).max(1440).optional(),
    })).max(120).default([]),
  }) }), asyncHandler(async (req, res) => {
    await requireConsent(d.db, req.user.id, 'HEALTH_IMPORT', 'Importing from your device needs your explicit consent');
    const { source } = req.body as { source: 'healthconnect' | 'healthkit' };
    const uid = req.user.id;
    // The last record per date wins within one batch.
    const sleepIn = [...new Map((req.body.sleep as { date: string; bedtime: string; wakeTime: string; awakenings: number; latencyMin: number }[]).map((s) => [s.date, s])).values()].sort((a, b) => a.date.localeCompare(b.date));
    const actIn = [...new Map((req.body.activity as { date: string; steps?: number; walkingMin?: number; exerciseMin?: number }[]).map((s) => [s.date, s])).values()];

    let sleepImported = 0, sleepSkipped = 0, activityImported = 0, activitySkipped = 0;
    if (sleepIn.length) {
      const existing = await d.db.sleepEntry.findMany({ where: { userId: uid, date: { gte: addDays(sleepIn[0]!.date, -7) } }, orderBy: { date: 'asc' } });
      const byDate = new Map(existing.map((e) => [e.date, e]));
      for (const s of sleepIn) {
        const cur = byDate.get(s.date);
        if (cur && cur.source === 'manual') { sleepSkipped++; continue; }
        const prev = [...byDate.values()].filter((e) => e.date < s.date).slice(-6).reverse();
        const durationMin = durationMinutes(s.bedtime, s.wakeTime);
        const score = sleepScore({ durationMin, awakenings: s.awakenings, rested: NEUTRAL_RESTED, recentBedtimes: [s.bedtime, ...prev.map((p) => p.bedtime)], routineRate: 0 }).score;
        const data = { bedtime: s.bedtime, wakeTime: s.wakeTime, durationMin, latencyMin: s.latencyMin, awakenings: s.awakenings, rested: null, score, source, noteEncrypted: null };
        // Never overwrite a manual night, even when the user saves one between the read above and this write: update only non-manual rows,
        // create if none exists, and treat a unique-key clash as "a manual row appeared".
        let wrote = (await d.db.sleepEntry.updateMany({ where: { userId: uid, date: s.date, source: { not: 'manual' } }, data })).count > 0;
        if (!wrote) {
          try { await d.db.sleepEntry.create({ data: { userId: uid, date: s.date, ...data } }); wrote = true; } catch (e) { if ((e as { code?: string }).code !== 'P2002') throw e; }
        }
        const row = await d.db.sleepEntry.findUnique({ where: { userId_date: { userId: uid, date: s.date } } });
        if (row) byDate.set(s.date, row);
        if (wrote) sleepImported++; else sleepSkipped++;
      }
    }
    for (const a of actIn) {
      const cur = await d.db.dailyActivity.findUnique({ where: { userId_date: { userId: uid, date: a.date } } });
      if (cur && cur.source === 'manual') { activitySkipped++; continue; }
      const data = { steps: a.steps ?? null, walkingMin: a.walkingMin ?? null, exerciseMin: a.exerciseMin ?? null, source };
      let wrote = (await d.db.dailyActivity.updateMany({ where: { userId: uid, date: a.date, source: { not: 'manual' } }, data })).count > 0;
      if (!wrote) {
        try { await d.db.dailyActivity.create({ data: { userId: uid, date: a.date, ...data } }); wrote = true; } catch (e) { if ((e as { code?: string }).code !== 'P2002') throw e; }
      }
      if (wrote) activityImported++; else activitySkipped++;
    }
    res.json({ data: { source, imported: { sleep: sleepImported, activity: activityImported }, skippedManual: { sleep: sleepSkipped, activity: activitySkipped } } });
  }));

  r.get('/activity', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }) }), asyncHandler(async (req, res) => {
    const { days } = q<{ days: number }>(req);
    const u = await d.db.user.findUnique({ where: { id: req.user.id } });
    const rows = await d.db.dailyActivity.findMany({ where: { userId: req.user.id, date: { gte: addDays(localDate(u?.timezone), -(days - 1)) } }, orderBy: { date: 'asc' } });
    res.json({ data: rows.map((x) => ({ date: x.date, steps: x.steps, walkingMin: x.walkingMin, exerciseMin: x.exerciseMin, source: x.source })) });
  }));

  // Disconnect: deletes everything still marked as imported (sleep nights and activity days) and withdraws the consent.
  r.delete('/import', asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const [sleep, activity, consent] = await d.db.$transaction([
      d.db.sleepEntry.deleteMany({ where: { userId: uid, source: { not: 'manual' } } }),
      d.db.dailyActivity.deleteMany({ where: { userId: uid, source: { not: 'manual' } } }),
      d.db.userConsent.updateMany({ where: { userId: uid, consentType: 'HEALTH_IMPORT', withdrawnAt: null }, data: { withdrawnAt: new Date() } }),
    ]);
    res.json({ data: { deleted: { sleep: sleep.count, activity: activity.count }, consentWithdrawn: consent.count > 0 } });
  }));
  return r;
}
