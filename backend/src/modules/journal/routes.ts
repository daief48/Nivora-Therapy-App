import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, q, validate } from '../../middleware/validateRequest.js';
import { aiReplyLanguage } from '../../services/systemPrompt.js';
import { assessSafely, crisisMessage, getResources, pickLang } from '../../services/safetyService.js';
import { journalEmotions } from '../../services/journalEmotions.js';
import { cleanTranscript } from '../../services/transcriptCleanup.js';
import { AppError, notFound } from '../../utils/errors.js';
import { activeConsents, requireConsents } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

const types = ['FREE', 'THOUGHT_RECORD', 'GRATITUDE', 'DAILY_REFLECTION', 'SLEEP_STRESS'] as const;
const idp = z.object({ id: z.string().uuid() });

export function journalRouter(d: Deps) {
  const r = Router();
  r.use(d.authenticate);
  const view = (e: any) => ({ id: e.id, entryType: e.entryType, content: d.cipher.decrypt(e.encryptedContent), createdAt: e.createdAt, updatedAt: e.updatedAt, source: e.source, hasAudio: !!e.audioEncrypted });
  const mine = (userId: string, id: string) => d.db.journalEntry.findFirst({ where: { id, userId, deletedAt: null } });

  r.post('/', validate({ body: z.object({ content: z.string().trim().min(1).max(20_000), entryType: z.enum(types).default('FREE') }) }),
    asyncHandler(async (req, res) => {
      const e = await d.db.journalEntry.create({ data: { userId: req.user.id, entryType: req.body.entryType, encryptedContent: d.cipher.encrypt(req.body.content) } });
      res.status(201).json({ data: view(e) });
    }));

  // Voice journal: recording in, transcript stored as a normal entry. Order matters: transcribe, RISK-CHECK the transcript, then store.
  // High-risk text is never stored and never reaches the model (crisis support is returned instead, like journal-ai/emotions).
  // The raw recording is discarded after transcription unless the user passes keepAudio=1 (stored encrypted, readable only via GET /:id/audio).
  // Emotion reading and the optional transcript clean-up (clean=1) call the model, so they run only with JOURNAL_AI_SHARING consent.
  // Limits: body <= 5 MB (413), durationSec (client-reported) <= 180 (400 AUDIO_TOO_LONG); the server cannot measure duration itself.
  const MAX_VOICE_SEC = 180;
  const langs = z.enum(['en', 'bn', 'hi', 'ne', 'auto']);
  r.post('/voice', (req, _res, next) => next(d.config.VOICE_ENABLED === '1' ? undefined : new AppError(400, 'MODE_DISABLED', 'Voice is not available')), d.sttLimiter,
    express.raw({ type: () => true, limit: '5mb' }),
    asyncHandler(async (req, res) => {
      await requireConsents(d.db, req.user.id);
      const mime = String(req.headers['content-type'] ?? '');
      const body = req.body as Buffer;
      if (!mime.startsWith('audio/') && !mime.startsWith('video/webm')) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the recording as audio.');
      if (!Buffer.isBuffer(body) || body.length < 800) throw new AppError(400, 'AUDIO_TOO_SHORT', 'The recording was empty.');
      const dur = req.query.durationSec == null ? null : Number(req.query.durationSec);
      if (dur != null && (!Number.isFinite(dur) || dur < 0)) throw new AppError(400, 'BAD_REQUEST', 'Invalid durationSec');
      if (dur != null && dur > MAX_VOICE_SEC) throw new AppError(400, 'AUDIO_TOO_LONG', `Voice notes can be up to ${MAX_VOICE_SEC} seconds.`);
      const user = await d.db.user.findUnique({ where: { id: req.user.id } });
      const language = langs.catch(user?.locale === 'bn' || user?.locale === 'hi' || user?.locale === 'ne' ? user.locale : 'auto').parse(req.query.language);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      let text = (await d.stt.transcribe(body, mime, language, ac.signal)).trim();
      if (!text) throw new AppError(422, 'NO_SPEECH', 'No speech was recognised in the recording.');
      text = text.slice(0, 20_000);

      const a = assessSafely(text);
      if (a.severity === 'HIGH' || a.severity === 'IMMINENT') {
        const profile = await d.db.userProfile.findUnique({ where: { userId: req.user.id } });
        const resources = await getResources(d.db, profile?.countryCode);
        await d.db.safetyEvent.create({ data: { userId: req.user.id, severity: a.severity, category: a.categories.join(',') || null, actionTaken: 'CRISIS_RESPONSE_SHOWN' } });
        res.json({ data: { crisis: true, entry: null, emotions: null, safety: { severity: a.severity, crisis: true, resources, message: crisisMessage(a.severity, pickLang('mixed', text), resources) } } });
        return;
      }
      const shared = (await activeConsents(d.db, req.user.id)).has('JOURNAL_AI_SHARING');
      if (shared && (req.query.clean === '1' || req.query.clean === 'true')) {
        const cleaned = await cleanTranscript(d.glm, text, { lang: language, signal: ac.signal });
        if (cleaned && assessSafely(cleaned).severity !== 'HIGH' && assessSafely(cleaned).severity !== 'IMMINENT') text = cleaned;
      }
      const keep = req.query.keepAudio === '1' || req.query.keepAudio === 'true';
      const entry = await d.db.journalEntry.create({ data: {
        userId: req.user.id, entryType: 'FREE', source: 'voice', encryptedContent: d.cipher.encrypt(text),
        ...(keep && { audioEncrypted: d.cipher.encrypt(body.toString('base64')), audioMime: mime.slice(0, 60) }),
      } });
      let safety: unknown = { severity: a.severity, crisis: false };
      if (a.severity === 'ELEVATED') {
        await d.db.safetyEvent.create({ data: { userId: req.user.id, severity: a.severity, category: a.categories.join(',') || null, actionTaken: 'SUPPORT_FOOTER_ADDED' } });
        safety = { severity: a.severity, crisis: false, resources: await getResources(d.db, (await d.db.userProfile.findUnique({ where: { userId: req.user.id } }))?.countryCode), message: null };
      }
      let emotions: unknown = null;
      if (shared && req.query.emotions !== '0') {
        const bn = /[ঀ-৿]/.test(text) || language === 'bn';
        emotions = await journalEmotions(d.glm, text, bn ? 'bn' : 'en', aiReplyLanguage(language === 'auto' ? (user?.locale === 'auto' ? 'auto' : user?.locale) : language));
      }
      res.status(201).set('Cache-Control', 'no-store').json({ data: { crisis: false, entry: view(entry), emotions, consentNeeded: shared ? null : 'JOURNAL_AI_SHARING', safety } });
    }));

  r.get('/:id/audio', validate({ params: idp }), asyncHandler(async (req, res) => {
    const e = await mine(req.user.id, req.params.id);
    if (!e || !e.audioEncrypted) throw notFound('Recording not found');
    const audio = Buffer.from(d.cipher.decrypt(e.audioEncrypted), 'base64');
    res.status(200).set({ 'Content-Type': e.audioMime || 'audio/mp4', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store' }).end(audio);
  }));

  r.get('/', validate({ query: z.object({
    entryType: z.enum(types).optional(), search: z.string().trim().max(100).optional(),
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
  }) }), asyncHandler(async (req, res) => {
    const { entryType, search, from, to, limit } = q<any>(req);
    // Content is encrypted at rest, so text search happens in memory over a bounded recent window.
    const rows = await d.db.journalEntry.findMany({
      where: { userId: req.user.id, deletedAt: null, ...(entryType && { entryType }), createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } },
      orderBy: { createdAt: 'desc' }, take: search ? 500 : limit,
    });
    let out = rows.map(view);
    if (search) { const s = search.toLowerCase(); out = out.filter((e) => e.content.toLowerCase().includes(s)).slice(0, limit); }
    res.json({ data: out });
  }));

  r.get('/:id', validate({ params: idp }), asyncHandler(async (req, res) => {
    const e = await mine(req.user.id, req.params.id);
    if (!e) throw notFound('Journal entry not found');
    res.json({ data: view(e) });
  }));

  r.patch('/:id', validate({ params: idp, body: z.object({ content: z.string().trim().min(1).max(20_000) }) }), asyncHandler(async (req, res) => {
    if (!(await mine(req.user.id, req.params.id))) throw notFound('Journal entry not found');
    const e = await d.db.journalEntry.update({ where: { id: req.params.id }, data: { encryptedContent: d.cipher.encrypt(req.body.content) } });
    res.json({ data: view(e) });
  }));

  r.delete('/:id', validate({ params: idp }), asyncHandler(async (req, res) => {
    if (!(await mine(req.user.id, req.params.id))) throw notFound('Journal entry not found');
    // Soft delete that immediately destroys the content; the empty tombstone row carries no personal data.
    await d.db.journalEntry.update({ where: { id: req.params.id }, data: { deletedAt: new Date(), encryptedContent: '', audioEncrypted: null, audioMime: null } });
    res.status(204).end();
  }));
  return r;
}
