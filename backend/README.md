# Backend

Express + TypeScript + Prisma + PostgreSQL. Full setup is in the [root README](../README.md); API in [docs/API.md](../docs/API.md).

```
src/
  app.ts            composition root (createApp: dependencies injected, so tests swap the AI client, voice client, mailer and limits)
  server.ts         bootstrap + graceful shutdown
  config/           env (zod), prisma client
  middleware/       authenticate, errorHandler, rateLimiter, requestId, validateRequest
  modules/          auth, users(+consents), consents, sessions, moods, journal, goals, safety, speech (/speech text-to-audio), privacy
  services/         glmClient (OpenAI-compatible chat client, also used for GLM), ttsClient (natural voice), conversationService, safetyService, systemPrompt
  utils/            errors, logger (redacting), crypto (AES-256-GCM)
  tests/            vitest + supertest against a real embedded PostgreSQL (AI and voice providers mocked)
prisma/             schema.prisma, migrations/, seed.ts
scripts/dev-db.ts   embedded PostgreSQL for dev/tests
```

Scripts: `dev`, `build`, `start`, `test`, `lint` (= typecheck), `db:dev`, `prisma:migrate`, `prisma:deploy`, `db:seed`.

The system prompt lives in `src/services/systemPrompt.ts`; override it with `SYSTEM_PROMPT_FILE=/path/to/prompt.txt`. Prompt rules are *not* relied on for safety — see `safetyService.ts`.
