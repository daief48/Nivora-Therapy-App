import * as argon2 from 'argon2';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Db } from '../../config/database.js';
import type { Env } from '../../config/env.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { conflict, unauthorized, badRequest } from '../../utils/errors.js';
import { CONSENT_VERSION } from '../consents/consentService.js';
import type { Mailer } from '../deps.js';

export interface RegisterInput {
  email: string; password: string; displayName: string; locale: 'en' | 'bn' | 'mixed'; timezone: string; countryCode?: string;
}
export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

const ARGON = { type: argon2.argon2id as 2, raw: false as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };
let dummyHash: Promise<string> | undefined;

export function createAuthService(db: Db, cfg: Env, mailer: Mailer) {
  const accessTtl = cfg.ACCESS_TOKEN_TTL_MIN * 60;
  const refreshMs = cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000;

  function signAccess(userId: string, familyId: string) {
    return jwt.sign({ fid: familyId }, cfg.JWT_ACCESS_SECRET, { subject: userId, expiresIn: accessTtl, algorithm: 'HS256' });
  }

  async function issue(userId: string, familyId: string, userAgent?: string): Promise<TokenPair> {
    const refreshToken = randomToken();
    await db.refreshToken.create({
      data: { userId, familyId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + refreshMs), userAgent: userAgent?.slice(0, 200) },
    });
    return { accessToken: signAccess(userId, familyId), refreshToken, expiresIn: accessTtl };
  }

  return {
    async register(input: RegisterInput, userAgent?: string) {
      const email = input.email.toLowerCase();
      if (await db.user.findUnique({ where: { email } })) throw conflict('An account with this email already exists');
      const passwordHash = await argon2.hash(input.password, ARGON);
      const user = await db.user.create({
        data: {
          email, passwordHash, locale: input.locale, timezone: input.timezone,
          profile: { create: { displayName: input.displayName, countryCode: input.countryCode?.toUpperCase() } },
          consents: {
            create: ['AGE_18_PLUS', 'AI_DISCLOSURE', 'PRIVACY'].map((consentType) => ({ consentType, consentVersion: CONSENT_VERSION })),
          },
        },
      });
      await db.auditLog.create({ data: { actorId: user.id, action: 'REGISTER', resourceType: 'User' } });
      return { userId: user.id, tokens: await issue(user.id, crypto.randomUUID(), userAgent) };
    },

    async login(emailRaw: string, password: string, userAgent?: string) {
      const user = await db.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
      // Verify against a dummy hash when the user is unknown, so timing does not reveal account existence.
      dummyHash ??= argon2.hash('dummy-password-for-timing', ARGON);
      const ok = await argon2.verify(user?.passwordHash ?? (await dummyHash), password).catch(() => false);
      if (!user || !ok || user.status !== 'ACTIVE') throw unauthorized('Incorrect email or password');
      return { userId: user.id, tokens: await issue(user.id, crypto.randomUUID(), userAgent) };
    },

    async refresh(token: string, userAgent?: string) {
      const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (!row) throw unauthorized('Invalid refresh token');
      if (row.revokedAt) {
        // A rotated token was presented again: assume theft and end the whole login family.
        await db.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        throw unauthorized('Refresh token reuse detected; please sign in again');
      }
      if (row.expiresAt < new Date()) throw unauthorized('Refresh token expired');
      const claimed = await db.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (claimed.count !== 1) throw unauthorized('Invalid refresh token');
      const user = await db.user.findUnique({ where: { id: row.userId }, select: { status: true } });
      if (user?.status !== 'ACTIVE') throw unauthorized('Account unavailable');
      return issue(row.userId, row.familyId, userAgent ?? row.userAgent ?? undefined);
    },

    async logout(token: string) {
      const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (row) await db.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    },

    async logoutAll(userId: string) {
      await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    },

    async devices(userId: string, currentFamily: string) {
      const rows = await db.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({ id: r.familyId, userAgent: r.userAgent, lastActiveAt: r.createdAt, current: r.familyId === currentFamily }));
    },

    async revokeDevice(userId: string, familyId: string) {
      await db.refreshToken.updateMany({ where: { userId, familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    },

    async forgotPassword(emailRaw: string) {
      const user = await db.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
      if (!user || user.status !== 'ACTIVE') return; // caller always answers 202 to avoid account enumeration
      const token = randomToken(32);
      await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) } });
      await mailer.sendPasswordReset(user.email, token);
    },

    async resetPassword(token: string, newPassword: string) {
      const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('Reset link is invalid or has expired');
      const passwordHash = await argon2.hash(newPassword, ARGON);
      const claimed = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw badRequest('Reset link is invalid or has expired');
      await db.$transaction([
        db.user.update({ where: { id: row.userId }, data: { passwordHash } }),
        db.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        db.auditLog.create({ data: { actorId: row.userId, action: 'PASSWORD_RESET', resourceType: 'User' } }),
      ]);
    },

    verifyPassword: async (userId: string, password: string) => {
      const u = await db.user.findUnique({ where: { id: userId } });
      return !!u && (await argon2.verify(u.passwordHash, password).catch(() => false));
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
