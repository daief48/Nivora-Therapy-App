import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { pick, REACH_OUT_DRAFTS, STEP_TITLE, WALK_CHOICES } from '../../services/actionCopy.js';
import {
  actionById, buildMenu, crisisItems, isTiny, KAIZEN_FOR_ACTION, menuCards, OUTCOMES, recordOffer, setOutcome, SUGGESTION_LEVELS, SURFACES, toCard, type ActionCard,
} from '../../services/actionMenu.js';
import { flowerTotal } from '../../services/gardenService.js';
import { addKaizenStep } from '../../services/kaizenExtras.js';
import { assessSafely } from '../../services/safetyService.js';
import { crisisSafety } from '../../services/crisisResponse.js';
import { copyLang, fill } from '../../services/wellnessCopy.js';
import { notFound } from '../../utils/errors.js';
import type { Deps } from '../deps.js';

const SESSION_CLOSE_PROMPT = { en: 'What are you taking with you?', bn: 'আপনি সঙ্গে কী নিয়ে যাচ্ছেন?', hi: 'आप अपने साथ क्या ले जा रहे हैं?', ne: 'तपाईं साथमा के लिएर जाँदै हुनुहुन्छ?' };

/**
 * The App Action Menu over HTTP: the same rule-based registry the session chat uses (services/actionMenu.ts), for the surfaces outside chat
 * (Today feed, Insights, session close), plus the small action flows of Phase D (walk, gratitude note, reach out, session close).
 * None of these endpoints calls a model.
 */
export function actionsRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const deps = { db: d.db, cipher: d.cipher };

  // A written idea (walk) is stored encrypted in userTextEncrypted; the stored title is a fixed template. The person sees their own words.
  const stepView = (a: { id: string; goalId: string; date: string; title: string; description: string; targetValue: number; unit: string; status: string; source: string; userTextEncrypted?: string | null }) => ({
    id: a.id, goalId: a.goalId, date: a.date, title: a.userTextEncrypted ? d.cipher.decrypt(a.userTextEncrypted) : a.title, description: a.description, targetValue: a.targetValue, unit: a.unit, status: a.status, source: a.source,
  });
  const me = async (userId: string) => {
    const u = await d.db.user.findUnique({ where: { id: userId }, select: { locale: true, timezone: true } });
    return { locale: u?.locale ?? 'en', tz: u?.timezone ?? 'UTC' };
  };
  async function crisisPayload(userId: string, severity: string, categories: string[], text: string) {
    return { crisis: true, safety: await crisisSafety(d.db, userId, severity, categories, text) };
  }
  const isHigh = (s: string) => s === 'HIGH' || s === 'IMMINENT';

  // ---- the menu for non-chat surfaces -------------------------------------------------------------------------------------------------
  r.get('/menu', validate({ query: z.object({
    context: z.enum(SURFACES).default('TODAY'), tags: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(4).default(4),
  }) }), asyncHandler(async (req, res) => {
    const { context, tags, limit } = q<{ context: (typeof SURFACES)[number]; tags?: string; limit: number }>(req);
    const menu = await buildMenu(deps, req.user.id, {
      surface: context, max: limit, tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8) : undefined, voiceEnabled: d.config.VOICE_ENABLED === '1',
    });
    // offerId is null here: a plain read records nothing. Report what the person did with POST /actions/:id/outcome (id = the action id).
    res.json({ data: { riskMode: menu.riskMode, suggestionLevel: menu.level, note: menu.note, actions: menuCards(menu, context) } });
  }));

  // ---- outcome of an offered action ---------------------------------------------------------------------------------------------------
  // :id = the offerId of a card (chat / call / session close) or the action id of a card from GET /actions/menu (the offer row is created now).
  r.post('/:id/outcome', validate({
    params: z.object({ id: z.string().min(1).max(64) }),
    body: z.object({ outcome: z.enum(OUTCOMES), surface: z.enum(SURFACES).default('TODAY'), saveToKaizen: z.boolean().default(false) }),
  }), asyncHandler(async (req, res) => {
    const { outcome, surface, saveToKaizen } = req.body as { outcome: (typeof OUTCOMES)[number]; surface: (typeof SURFACES)[number]; saveToKaizen: boolean };
    const row = await setOutcome(d.db, req.user.id, req.params.id, outcome, surface);
    if (!row) throw notFound('Action not found');
    let kaizen: ReturnType<typeof stepView> | null = null;
    if (outcome === 'ACCEPTED' && saveToKaizen) {
      const map = KAIZEN_FOR_ACTION[row.actionId];
      if (map) {
        const { locale, tz } = await me(req.user.id);
        const out = await addKaizenStep(d.db, req.user.id, { category: map.category, minutes: map.minutes, source: row.surface === 'SESSION_CLOSE' ? 'SESSION_CLOSE' : 'MENU', locale, tz });
        kaizen = stepView(out.action);
      }
    }
    if (outcome === 'ACCEPTED' || outcome === 'DISMISSED') void d.telemetry.track(req.user.id, outcome === 'ACCEPTED' ? 'action_accepted' : 'action_dismissed', { kind: row.kind, surface: row.surface });
    res.json({ data: { offerId: row.id, actionId: row.actionId, outcome: row.outcome, feedback: row.feedback, kaizen } });
  }));

  // ---- WALK_10: a small pleasant activity, added to Kaizen (counts for the Garden when done) --------------------------------------------
  r.get('/walk', asyncHandler(async (req, res) => {
    const { locale } = await me(req.user.id);
    res.json({ data: { choices: WALK_CHOICES.map((c) => ({ key: c.key, minutes: c.minutes, label: pick(c.label, locale) })) } });
  }));
  r.post('/walk', validate({ body: z.object({
    choice: z.enum(WALK_CHOICES.map((c) => c.key) as [string, ...string[]]).optional(), text: z.string().trim().min(1).max(80).optional(), minutes: z.number().int().min(1).max(60).optional(),
  }).refine((b) => !!b.choice || !!b.text, 'Pick an idea or write one') }), asyncHandler(async (req, res) => {
    const b = req.body as { choice?: string; text?: string; minutes?: number };
    const { locale, tz } = await me(req.user.id);
    if (b.text) { // a written idea: risk-checked first, and high-risk text is stored nowhere
      const a = assessSafely(b.text);
      if (isHigh(a.severity)) { res.json({ data: await crisisPayload(req.user.id, a.severity, a.categories, b.text) }); return; }
    }
    const pickd = WALK_CHOICES.find((c) => c.key === b.choice);
    const minutes = b.minutes ?? pickd?.minutes ?? 10;
    // A choice from the list keeps its (non-personal) label as title. A written idea is the person's own text: stored encrypted, the title stays a template.
    const title = b.text ? undefined : (pickd ? pick(pickd.label, locale) : '').slice(0, 80);
    const userTextEncrypted = b.text ? d.cipher.encrypt(b.text) : undefined;
    const out = await addKaizenStep(d.db, req.user.id, { category: 'SHORT_WALK', minutes, source: 'WALK', locale, tz, title, description: pick(ACTION_WHY_WALK, locale), userTextEncrypted });
    let action = out.action;
    // Today already has a planned walk step: the new idea replaces it (a finished one is left alone).
    if (!out.created && action.status === 'PLANNED') {
      const tplTitle = title ?? pick(STEP_TITLE.SHORT_WALK!, locale).replace('{n}', String(minutes));
      action = await d.db.kaizenAction.update({ where: { id: action.id }, data: { title: tplTitle, targetValue: minutes, userTextEncrypted: userTextEncrypted ?? null } });
    }
    res.status(out.created ? 201 : 200).json({ data: { crisis: false, created: out.created, alreadyDone: action.status === 'DONE', action: stepView(action), flowers: (await flowerTotal(d.db, req.user.id)).total } });
  }));

  // ---- GRATITUDE_NOTE: a one-field journal template, saved as a normal journal entry typed GRATITUDE ------------------------------------
  r.post('/gratitude', validate({ body: z.object({ text: z.string().trim().min(1).max(1000) }) }), asyncHandler(async (req, res) => {
    const text = req.body.text as string;
    const a = assessSafely(text);
    if (isHigh(a.severity)) { res.json({ data: await crisisPayload(req.user.id, a.severity, a.categories, text) }); return; }
    const e = await d.db.journalEntry.create({ data: { userId: req.user.id, entryType: 'GRATITUDE', encryptedContent: d.cipher.encrypt(text) } });
    res.status(201).json({ data: { crisis: false, entry: { id: e.id, entryType: e.entryType, createdAt: e.createdAt } } });
  }));

  // ---- REACH_OUT: trusted contacts + editable drafts. Nothing is sent by the app; the person copies or shares the text themselves ---------
  r.get('/reach-out', asyncHandler(async (req, res) => {
    const { locale } = await me(req.user.id);
    const rows = await d.db.trustedContact.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' }, take: 5 });
    const templates = REACH_OUT_DRAFTS[copyLang(locale)];
    const contacts = rows.map((c) => {
      const name = d.cipher.decrypt(c.nameEncrypted);
      return { id: c.id, name, relation: c.relation, phone: d.cipher.decrypt(c.phoneEncrypted), drafts: templates.map((t) => fill(t, { name })) };
    });
    res.json({ data: { contacts, templates, sent: false, hasContacts: contacts.length > 0 } });
  }));

  // ---- session close: ONE tiny action ("What are you taking with you?"). Accept it with POST /actions/:offerId/outcome { outcome:'ACCEPTED', saveToKaizen:true } ----
  r.post('/session-close', validate({ body: z.object({ sessionId: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    const s = await d.db.therapySession.findFirst({ where: { id: req.body.sessionId, userId: req.user.id }, select: { id: true, riskFlag: true } });
    if (!s) throw notFound('Session not found');
    const { locale } = await me(req.user.id);
    const prompt = pick(SESSION_CLOSE_PROMPT, locale);
    // A session that raised a safety level, or risk signals anywhere, gets support options only: never a task on the way out.
    const sessionRisk = s.riskFlag !== 'NONE' || (await d.db.safetyEvent.count({ where: { sessionId: s.id } })) > 0;
    // Words from this session's last messages only steer the choice (rule-based tags); they are read in memory and never stored or sent anywhere.
    const msgs = await d.db.sessionMessage.findMany({ where: { sessionId: s.id, role: 'user' }, orderBy: { createdAt: 'desc' }, take: 8 });
    const text = msgs.map((m) => d.cipher.decrypt(m.encryptedContent)).join('\n');
    const menu = await buildMenu(deps, req.user.id, { surface: 'SESSION_CLOSE', max: 1, text, only: isTiny, voiceEnabled: d.config.VOICE_ENABLED === '1' });
    if (menu.riskMode || sessionRisk) {
      const support: ActionCard[] = crisisItems().map((i) => toCard(i.def, locale, 'SESSION_CLOSE', 'risk_support'));
      res.json({ data: { prompt, riskMode: true, action: null, support } });
      return;
    }
    // Idempotent per session: asking again (retry, reopened screen) returns the offer made the first time, with the same offerId.
    const prior = await d.db.actionOffer.findFirst({ where: { userId: req.user.id, sessionId: s.id, surface: 'SESSION_CLOSE' }, orderBy: { createdAt: 'asc' } });
    const priorDef = prior ? actionById(prior.actionId) : null;
    const item = priorDef ? { def: priorDef } : menu.items[0];
    if (!item) { res.json({ data: { prompt, riskMode: false, action: null, support: [] } }); return; }
    const offerId = prior && priorDef ? prior.id : await recordOffer(d.db, req.user.id, item.def, 'SESSION_CLOSE', { sessionId: s.id });
    if (!prior) void d.telemetry.track(req.user.id, 'action_offered', { kind: item.def.kind, surface: 'SESSION_CLOSE' });
    const card = toCard(item.def, locale, 'SESSION_CLOSE', 'session_close', { offerId });
    res.json({ data: { prompt, riskMode: false, action: card, saveToKaizenOnAccept: !!KAIZEN_FOR_ACTION[item.def.id], support: [] } });
  }));

  // ---- the registry itself (so the app can render titles for ids it only knows by key) --------------------------------------------------
  r.get('/registry', asyncHandler(async (req, res) => {
    const { locale } = await me(req.user.id);
    const ids = ['BREATHING', 'GROUNDING', 'THOUGHT_RECORD', 'JOURNAL_TEXT', 'JOURNAL_VOICE', 'GRATITUDE_NOTE', 'SLEEP_ROUTINE', 'KAIZEN_STEP', 'WALK_10', 'SOUNDS', 'REACH_OUT', 'SAFETY_PLAN', 'EMERGENCY', 'TRUSTED_PERSON'];
    res.json({ data: { suggestionLevels: SUGGESTION_LEVELS, actions: ids.map((id) => toCard(actionById(id)!, locale, 'TODAY', 'general')) } });
  }));
  return r;
}

const ACTION_WHY_WALK = { en: 'A little movement or something pleasant, chosen by you.', bn: 'একটু নড়াচড়া বা ভালো লাগার কিছু, আপনার নিজের বেছে নেওয়া।', hi: 'थोड़ा चलना या कुछ अच्छा, आपकी अपनी पसंद का।', ne: 'अलि हिँडडुल वा मनपर्ने कुरा, तपाईंले आफैँ रोजेको।' };
