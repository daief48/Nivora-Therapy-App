import express, { Router } from 'express';
import { AppError } from '../../utils/errors.js';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import { requireConsents } from '../consents/consentService.js';
import type { Deps } from '../deps.js';

/**
 * POST /speech: turns an AI reply into natural-sounding speech (mp3). Needs the same consents as chat.
 * The text is only forwarded to the voice provider and is never stored or logged.
 */
export function speechRouter(d: Deps) {
  const r = Router();
  r.post('/speech', d.authenticate, d.ttsLimiter,
    validate({ body: z.object({ text: z.string().trim().min(1).max(1200), language: z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']).default('mixed') }) }),
    asyncHandler(async (req, res) => {
      await requireConsents(d.db, req.user.id);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      const audio = await d.tts.synthesize(req.body.text, req.body.language, ac.signal);
      res.status(200).set({ 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store' }).end(audio);
    }));
  // POST /speech/transcribe?language=bn: the raw recording (audio/*) in, the words out. The audio is never stored or logged.
  r.post('/speech/transcribe', d.authenticate, d.sttLimiter,
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
      const text = await d.stt.transcribe(body, mime, language, ac.signal);
      res.status(200).set('Cache-Control', 'no-store').json({ data: { text } });
    }));
  return r;
}
