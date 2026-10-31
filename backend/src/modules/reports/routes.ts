import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { parseJsonObject } from '../../services/aiOutput.js';
import { buildMenu, crisisItems, menuCards, toCard, type ActionCard } from '../../services/actionMenu.js';
import { userHasRisk } from '../../services/riskState.js';
import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { computeWeekFacts, templateWeek, validateWeekReport, WEEK_SYSTEM, weekFactLines, type WeekFacts } from '../../services/weeklyReport.js';
import { localClock, mondayOf } from '../../utils/dates.js';
import { requireConsent } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

/** A stored report younger than this is returned as is (cached:true) instead of calling the model again. */
export const REPORT_FRESH_MS = 6 * 3_600_000;

/**
 * POST /reports/weekly: the single combined "Your week" (Kaizen + sleep + mood). Needs WELLNESS_AI_SHARING (403 CONSENT_REQUIRED, model not called).
 * Numbers are computed without a model; ONE model call phrases them; the text is accepted only if its shape, output checks and numbers all hold,
 * else the template is returned with ai:false. With risk signals present the model is not called and the response holds support options only.
 * The result is stored in WeeklySummary (reportEncrypted); the three older endpoints keep working unchanged.
 */
export function reportsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);

  const view = (o: { weekStart: string; headline: string; text: string; ai: boolean; cached: boolean; facts: WeekFacts | null; nextStep: ActionCard | null; riskMode: boolean; support: ActionCard[]; createdAt: Date | null }) => ({
    weekStart: o.weekStart, headline: o.headline, text: o.text, ai: o.ai, cached: o.cached, riskMode: o.riskMode, nextStep: o.nextStep, support: o.support, createdAt: o.createdAt,
    stats: o.facts && { kaizenDone: o.facts.kaizenDone, kaizenTotal: o.facts.kaizenTotal, restarts: o.facts.restarts, sleepNights: o.facts.sleepNights, avgSleepScore: o.facts.avgSleepScore, avgSleepHours: o.facts.avgSleepHours, moodDays: o.facts.moodDays, avgMood: o.facts.avgMood, avgStress: o.facts.avgStress, daysWithData: o.facts.daysWithData },
  });

  r.post('/weekly', d.messageLimiter, validate({ body: z.object({ force: z.boolean().default(false) }).default({ force: false }) }), asyncHandler(async (req, res) => {
    const uid = req.user.id;
    await requireConsent(d.db, uid, 'WELLNESS_AI_SHARING', 'The weekly report needs your explicit consent to read your check-ins, sleep and Kaizen history');
    const u = await d.db.user.findUnique({ where: { id: uid }, select: { locale: true, timezone: true } });
    const locale = u?.locale ?? 'en', tz = u?.timezone ?? 'UTC';
    const weekStart = mondayOf(localClock(tz).date);
    const facts = await computeWeekFacts(d.db, uid, tz);
    const lines = weekFactLines(facts);

    // Risk signals: no model, no task. Support options only.
    if (await userHasRisk(d.db, d.cipher, uid)) {
      const t = templateWeek(facts, locale);
      res.json({ data: view({ weekStart, ...t, ai: false, cached: false, facts, nextStep: null, riskMode: true, createdAt: null, support: crisisItems().map((i) => toCard(i.def, locale, 'WEEKLY', 'risk_support')) }) });
      return;
    }

    const stored = await d.db.weeklySummary.findUnique({ where: { userId_weekStart: { userId: uid, weekStart } } });
    const nextStepFor = async () => {
      const tags = [...(facts.shortNights >= 2 ? ['sleep'] : []), ...(facts.kaizenDone <= 1 ? ['low_energy'] : [])];
      const menu = await buildMenu({ db: d.db, cipher: d.cipher }, uid, { surface: 'WEEKLY', max: 1, tags, voiceEnabled: false }).catch(() => null);
      return menu && !menu.riskMode ? menuCards(menu, 'WEEKLY')[0] ?? null : null;
    };
    if (stored?.reportEncrypted && stored.reportAt && !req.body.force && Date.now() - stored.reportAt.getTime() < REPORT_FRESH_MS) {
      const j = JSON.parse(d.cipher.decrypt(stored.reportEncrypted)) as { headline: string; text: string; ai: boolean };
      res.json({ data: view({ weekStart, ...j, cached: true, facts, nextStep: await nextStepFor(), riskMode: false, support: [], createdAt: stored.reportAt }) });
      return;
    }

    let out = templateWeek(facts, locale), ai = false;
    if (facts.daysWithData >= 2) {
      const t0 = Date.now();
      try {
        const m = await d.glm.chat([{ role: 'system', content: WEEK_SYSTEM(aiReplyLanguage(locale)) }, { role: 'user', content: lines.join('\n') }], { maxTokens: 500 });
        const ok = validateWeekReport(parseJsonObject(m.content), lines);
        if (ok) { out = ok; ai = true; }
        void d.telemetry.model(uid, 'weekly_report', Date.now() - t0, !ok);
      } catch { void d.telemetry.model(uid, 'weekly_report', Date.now() - t0, true); }
    }

    const reportEncrypted = d.cipher.encrypt(JSON.stringify({ ...out, ai }));
    const now = new Date();
    const stats = { done: facts.kaizenDone, total: facts.kaizenTotal, restarts: facts.restarts, hardDays: facts.hardDays, sleepNights: facts.sleepNights, moodDays: facts.moodDays };
    await d.db.weeklySummary.upsert({
      where: { userId_weekStart: { userId: uid, weekStart } },
      create: { userId: uid, weekStart, textEncrypted: d.cipher.encrypt(out.text), ai, statsJson: stats, reportEncrypted, reportAt: now },
      update: { reportEncrypted, reportAt: now }, // the older Kaizen review text on the same row is left as it is
    });
    res.json({ data: view({ weekStart, ...out, ai, cached: false, facts, nextStep: await nextStepFor(), riskMode: false, support: [], createdAt: now }) });
  }));

  // The latest stored report for this week (no model call). data:null when there is none yet.
  r.get('/weekly', asyncHandler(async (req, res) => {
    const u = await d.db.user.findUnique({ where: { id: req.user.id }, select: { timezone: true } });
    const weekStart = mondayOf(localClock(u?.timezone).date);
    const stored = await d.db.weeklySummary.findUnique({ where: { userId_weekStart: { userId: req.user.id, weekStart } } });
    if (!stored?.reportEncrypted) { res.json({ data: null }); return; }
    const j = JSON.parse(d.cipher.decrypt(stored.reportEncrypted)) as { headline: string; text: string; ai: boolean };
    res.json({ data: view({ weekStart, ...j, cached: true, facts: null, nextStep: null, riskMode: false, support: [], createdAt: stored.reportAt }) });
  }));
  return r;
}
