import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Db } from '../config/database.js';
import { unauthorized } from '../utils/errors.js';

export interface AuthUser { id: string; familyId: string }
declare global { namespace Express { interface Request { user?: AuthUser; id?: string } } }

export function authenticate(db: Db, secret: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const h = req.headers.authorization;
      if (!h?.startsWith('Bearer ')) throw unauthorized();
      let payload: jwt.JwtPayload;
      try { payload = jwt.verify(h.slice(7), secret, { algorithms: ['HS256'] }) as jwt.JwtPayload; }
      catch { throw unauthorized('Invalid or expired token'); }
      const { sub, fid } = payload as { sub?: string; fid?: string };
      if (!sub || !fid) throw unauthorized();
      // Immediate revocation: the login family must still have an active refresh token and the user must be active.
      const [active, user] = await Promise.all([
        db.refreshToken.count({ where: { familyId: fid, revokedAt: null, expiresAt: { gt: new Date() } } }),
        db.user.findUnique({ where: { id: sub }, select: { status: true } }),
      ]);
      if (!active || user?.status !== 'ACTIVE') throw unauthorized('Session ended');
      req.user = { id: sub, familyId: fid };
      next();
    } catch (e) { next(e); }
  };
}
