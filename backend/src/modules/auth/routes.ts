import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validateRequest.js';
import type { Deps } from '../deps.js';
import { createAuthService } from './authService.js';

const email = z.string().trim().email().max(254);
export const password = z.string().min(10, 'Password must be at least 10 characters').max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password needs letters and a number');

const registerBody = z.object({
  email, password,
  displayName: z.string().trim().min(1).max(60),
  locale: z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']).default('en'),
  timezone: z.string().max(64).default('UTC'),
  countryCode: z.string().length(2).optional(),
  // Each must be explicitly true: age confirmation, AI disclosure, privacy consent.
  consents: z.object({ age18Plus: z.literal(true), aiDisclosure: z.literal(true), privacy: z.literal(true) }),
});
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export function authRouter(d: Deps) {
  const r = Router();
  const svc = createAuthService(d.db, d.config, d.mailer);
  const ua = (req: any) => req.headers['user-agent'] as string | undefined;

  r.post('/register', d.authLimiter, validate({ body: registerBody }), asyncHandler(async (req, res) => {
    const { userId, tokens } = await svc.register(req.body, ua(req));
    res.status(201).json({ data: { userId, ...tokens } });
  }));
  r.post('/login', d.authLimiter, validate({ body: z.object({ email, password: z.string().min(1).max(128) }) }), asyncHandler(async (req, res) => {
    const { userId, tokens } = await svc.login(req.body.email, req.body.password, ua(req));
    res.json({ data: { userId, ...tokens } });
  }));
  r.post('/refresh', d.authLimiter, validate({ body: refreshBody }), asyncHandler(async (req, res) => {
    res.json({ data: await svc.refresh(req.body.refreshToken, ua(req)) });
  }));
  r.post('/logout', validate({ body: refreshBody }), asyncHandler(async (req, res) => {
    await svc.logout(req.body.refreshToken);
    res.status(204).end();
  }));
  r.post('/logout-all', d.authenticate, asyncHandler(async (req, res) => {
    await svc.logoutAll(req.user.id);
    res.status(204).end();
  }));
  r.get('/devices', d.authenticate, asyncHandler(async (req, res) => {
    res.json({ data: await svc.devices(req.user.id, req.user.familyId) });
  }));
  r.delete('/devices/:id', d.authenticate, validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => {
    await svc.revokeDevice(req.user.id, req.params.id);
    res.status(204).end();
  }));
  r.post('/forgot-password', d.authLimiter, validate({ body: z.object({ email }) }), asyncHandler(async (req, res) => {
    await svc.forgotPassword(req.body.email);
    res.status(202).json({ data: { message: 'If an account exists for that email, a reset link has been sent.' } });
  }));
  r.post('/reset-password', d.authLimiter, validate({ body: z.object({ token: z.string().min(10).max(200), password }) }), asyncHandler(async (req, res) => {
    await svc.resetPassword(req.body.token, req.body.password);
    res.status(204).end();
  }));
  return r;
}
