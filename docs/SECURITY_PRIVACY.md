# Security & privacy

No measure here makes the system "completely secure". This lists what exists, what to verify, and what is still on you.

## Implemented
- **Passwords:** Argon2id (m=19 MiB, t=2). Dummy-hash verification on unknown emails to flatten timing.
- **Sessions:** HS256 access JWT (15 min) bound to a login "family"; opaque 384-bit refresh tokens stored only as SHA-256 hashes, rotated on every use, **reuse of a rotated token revokes the family**. Every authenticated request checks the family is still active and the user is `ACTIVE`, so logout / device revoke / password reset / account deletion take effect immediately.
- **Encryption at rest:** AES-256-GCM, per-record random IV, key id prefix for rotation (`DATA_ENCRYPTION_KEYS=id:base64,…`, first key encrypts, all decrypt). Encrypted: chat messages, summaries, mood notes, journal text, goal notes. Not encrypted (needed for queries): scores, timestamps, goal titles, email, display name, session metadata. Disk/volume encryption is still required.
- **Authorization:** every query is scoped by `userId` (sessions, goals via owner check, etc.); foreign IDs → 404. Cross-user tests exist for sessions, journal, moods, goals, devices.
- **Input:** Zod 4 validation on all routes, 128 kB body limit, 4000-char message limit, unknown PATCH fields rejected (`.strict()`), Prisma parameterised queries.
- **Transport/headers:** Helmet, CORS allowlist (`CORS_ORIGINS`), `trust proxy` in production. **TLS must be terminated by your proxy** (the app does not serve HTTPS).
- **Rate limiting:** global, auth, per-user AI messages.
- **Logging:** pino with redaction; only method + path (no query string, headers, bodies). A test asserts passwords, tokens, chat text, journal text and query strings never appear in logs. Provider errors are mapped to generic messages; provider bodies are never forwarded or logged. Stacks are omitted in production.
- **Mobile:** tokens in SecureStore (Keychain/Keystore); no secrets in the bundle (only `EXPO_PUBLIC_API_URL`).
- **Safety:** see CRISIS_RESOURCES.md. HIGH/IMMINENT messages are not sent to the model and the user's text is not stored; `SafetyEvent` keeps severity/category/action only.

## Data retention & deletion
| Data | Retention | Deleted by |
|---|---|---|
| Messages, summaries | until user deletes | session delete, account delete |
| Mood, goals, check-ins | until user deletes | item delete, account delete |
| Journal | until user deletes | delete blanks content immediately; tombstone row (no content) remains until a purge job removes `deletedAt` rows (**job not implemented** — add a cron `DELETE … WHERE deletedAt < now() - interval '30 days'`) |
| SafetyEvent | coarse metadata, user FK set NULL on account deletion | purge policy needed (suggest 12 months) |
| UsageRecord | token counts only | cascades with account |
| AuditLog | actor id + action, no content | not cascaded (kept for accountability); define a retention period |
| **Database backups** | per your backup policy | deleted data persists in backups until they expire — state this in the Privacy Notice |

## Third parties
Chat text (and journal text the user explicitly shares, and conversations the user asks to summarise) is sent to the configured AI provider (OpenAI by default; GLM/Z.AI if that fallback is used) to produce replies, and the text of each reply is sent to OpenAI to create speech when *Natural voice* is on. The Privacy Notice must say so, name the provider's region/terms, and the consent text in the app already states messages are sent to an AI service. Device speech recognition may use the vendor's cloud when on-device is unavailable.

## Natural voice (text-to-speech)
`POST /speech` sends the text of an AI reply to OpenAI to generate audio; it is authenticated, consent-gated, rate-limited (60/min/user) and the text is never stored or logged (tested). Microphone audio never leaves the phone through this app (recognition uses the device engine). State this in the Privacy Notice and keep the in-app switch (*Profile → Natural voice*).

## Pre-launch checklist
- [ ] TLS everywhere; HSTS at the proxy; `NODE_ENV=production`; `CORS_ORIGINS` set
- [ ] Secrets in a secret manager; keys generated per environment; rotation procedure tested (add new first key, re-encrypt lazily or by script)
- [ ] Managed PostgreSQL with encryption at rest, PITR backups, least-privilege DB user
- [ ] Real mailer for password reset; reset link deep-link into the app
- [ ] `npm audit` clean or accepted; dependency updates scheduled
- [ ] Legal: Privacy Notice, Terms, provider DPA, store data-safety / privacy-nutrition labels, regulator rules for health-adjacent data in your markets (GDPR, etc.)
- [ ] Penetration test + threat model review; abuse monitoring for the AI endpoint
- [ ] Retention jobs (above); DSAR process using `/privacy/export` and `/privacy/account`
- [ ] Clinical review sign-off (CRISIS_RESOURCES.md)
- [ ] Accessibility audit with TalkBack / VoiceOver, in Bangla and English
