import express, { Router, type RequestHandler } from 'express';
import { AppError } from '../../utils/errors.js';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { requireConsents } from '../consents/consentService.js';
import type { Deps } from '../deps.js';
import { contextTail } from '../../services/sttClient.js';
import { cleanTranscript } from '../../services/transcriptCleanup.js';

/** Tail of the user's own session, for recognition context. Any failure just means no context. */
async function recentContext(d: Deps, userId: string, sessionId: unknown): Promise<string> {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 64) return '';
  try {
    const s = await d.db.therapySession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
    if (!s) return '';
    const rows = await d.db.sessionMessage.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'desc' }, take: 3 });
    return contextTail(rows.reverse().map((m) => d.cipher.decrypt(m.encryptedContent)).join(' '));
  } catch {
    return '';
  }
}

/**
 * POST /speech: turns an AI reply into natural-sounding speech (mp3). Needs the same consents as chat.
 * The text is only forwarded to the voice provider and is never stored or logged.
 */
export function speechRouter(d: Deps) {
  const r = Router();
  // Voice is switched off unless VOICE_ENABLED=1 (checked per request, after authentication).
  const voiceOn: RequestHandler = (_req, _res, next) => next(d.config.VOICE_ENABLED === '1' ? undefined : new AppError(400, 'MODE_DISABLED', 'Voice is not available'));
  r.post('/speech', d.authenticate, voiceOn, d.ttsLimiter,
    validate({ body: z.object({ text: z.string().trim().min(1).max(1200), language: z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']).default('mixed') }) }),
    asyncHandler(async (req, res) => {
      await requireConsents(d.db, req.user.id);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      const audio = await d.tts.synthesize(req.body.text, req.body.language, ac.signal);
      res.status(200).set({ 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store' }).end(audio);
    }));
  // POST /speech/transcribe?language=bn: the raw recording (audio/*) in, the words out. The audio is never stored or logged.
  // Optional: sessionId=<own session> (the last ~200 chars of that conversation are sent to the recogniser as a prompt, helps names and
  // mixed-language words; read server-side, never put message text in the URL) and clean=1 (opt-in light model clean-up of obvious
  // mis-heard words, 1.5 s budget, original returned on any doubt; default off to keep latency low; never changes crisis-looking text).
  r.post('/speech/transcribe', d.authenticate, voiceOn, d.sttLimiter,
    express.raw({ type: () => true, limit: '5mb' }),
    asyncHandler(async (req, res) => {
      await requireConsents(d.db, req.user.id);
      const mime = String(req.headers['content-type'] ?? '');
      const body = req.body as Buffer;
      if (!mime.startsWith('audio/') && !mime.startsWith('video/webm')) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the recording as audio.');
      if (!Buffer.isBuffer(body) || body.length < 800) throw new AppError(400, 'AUDIO_TOO_SHORT', 'The recording was empty.');
      const language = z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']).catch('bn').parse(req.query.language);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      const context = await recentContext(d, req.user.id, req.query.sessionId);
      let text = await d.stt.transcribe(body, mime, language, ac.signal, context || undefined);
      if (text && (req.query.clean === '1' || req.query.clean === 'true')) text = await cleanTranscript(d.glm, text, { lang: language, context, signal: ac.signal });
      res.status(200).set('Cache-Control', 'no-store').json({ data: { text } });
    }));
  return r;
}
