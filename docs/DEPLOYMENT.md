# Deployment checklist

**Backend**
1. Provision managed PostgreSQL (14+). Create a limited-privilege app user.
2. Set env (see `backend/.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥32 random chars), `DATA_ENCRYPTION_KEYS`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` (or the GLM fallback: `GLM_API_KEY`, `GLM_MODEL`), `CORS_ORIGINS`, `PORT`. Store secrets in a secret manager, not in the image.
3. `npm ci && npm run build` → `npx prisma migrate deploy` → `npm run db:seed` (then verify resources, see CRISIS_RESOURCES.md) → `npm start` (`node dist/src/server.js`).
   (`build` emits to `dist/`; `prisma/seed.ts` is run with `tsx`, keep it as a dev dependency or run seeding from CI.)
4. Put it behind a TLS-terminating reverse proxy / platform load balancer that forwards `X-Forwarded-For` (the app uses `trust proxy: 1`). Route `/healthz` for liveness and `/readyz` for readiness. The process handles SIGTERM gracefully (stops accepting, closes Prisma, 10 s force-exit).
5. Run ≥2 instances? The rate limiter is **in-memory per instance**; add a shared store (e.g. Redis store for `express-rate-limit`) first.
6. Add: log shipping (JSON on stdout), error monitoring that scrubs bodies, DB backups + restore drill, a retention cron (SECURITY_PRIVACY.md), a real `Mailer` for password reset, alerts on AI and voice provider error rates, `AI_QUOTA_EXHAUSTED` / `TTS_QUOTA_EXHAUSTED` and `AI_NOT_CONFIGURED`.
7. Set a spend/usage cap with the AI provider (OpenAI bills chat tokens **and** natural-voice characters); `UsageRecord` stores token counts per user.

**Mobile**
1. `EXPO_PUBLIC_API_URL=https://api.your-domain` (HTTPS only), optional `EXPO_PUBLIC_SUPPORT_EMAIL`.
2. Change `ios.bundleIdentifier` / `android.package` (`com.example.nivora`) and app icons in `app.json`/`assets`.
3. EAS Build (`npx eas build`) for store binaries; speech recognition requires a dev/production build (not Expo Go).
4. Fill store privacy forms (health-adjacent data, microphone, third-party AI processing). Test on real devices: Android 10+ and iOS 16+, TalkBack/VoiceOver, large fonts, dark mode, offline, Bangla.
