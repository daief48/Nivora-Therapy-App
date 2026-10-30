# API reference — `/api/v1`

Success: `{ "data": ... }` (204 has no body). Error: `{ "error": { "code", "message", "details?", "requestId" } }`. Every response carries `X-Request-Id`. Authenticated routes need `Authorization: Bearer <accessToken>` (15 min). Unknown/foreign resource IDs return **404** (never 403) so IDs cannot be probed.

Operational: `GET /healthz` (liveness), `GET /readyz` (DB check) — outside `/api/v1`.

## Auth
| Method & path | Body | Result |
|---|---|---|
| POST `/auth/register` | `email, password (≥10, letters+number), displayName, locale en\|bn\|mixed, timezone?, countryCode?, consents:{age18Plus:true, aiDisclosure:true, privacy:true}` | 201 `{userId, accessToken, refreshToken, expiresIn}`; 409 duplicate; 400 validation |
| POST `/auth/login` | `email, password` | 200 tokens; 401 (same message for unknown user / wrong password) |
| POST `/auth/refresh` | `refreshToken` | 200 new pair (old token revoked). Reusing a rotated token revokes the whole login family → 401 |
| POST `/auth/logout` | `refreshToken` | 204 (revokes that login immediately) |
| POST `/auth/logout-all` 🔒 | – | 204 |
| GET `/auth/devices` 🔒 · DELETE `/auth/devices/:id` 🔒 | – | active logins / revoke one |
| POST `/auth/forgot-password` | `email` | always 202 (no account enumeration) |
| POST `/auth/reset-password` | `token, password` | 204; revokes all sessions |

## User & consent 🔒
`GET /me` · `PATCH /me {displayName?, locale?, timezone?, countryCode?, preferences?}` · `GET /consents` · `POST /consents {consentType: AGE_18_PLUS|AI_DISCLOSURE|PRIVACY|JOURNAL_AI_SHARING}` (idempotent) · `DELETE /consents/:id` (withdraw). Chat requires active `AGE_18_PLUS`, `AI_DISCLOSURE`, `PRIVACY` (403 `CONSENT_REQUIRED` otherwise).

## Sessions 🔒
* `POST /sessions {sessionType TEXT|VOICE, language}` → 201
* `GET /sessions?limit&status` · `GET /sessions/:id` (decrypted messages) · `DELETE /sessions/:id` (cascades messages + summary)
* `POST /sessions/:id/messages {text (≤4000), journalEntryId?}` — rate limited per user. Plain JSON → 201 `{message, safety:{severity, crisis, resources[]}}`. With `Accept: text/event-stream` → SSE events `delta {text}`, `replace {text}` (unsafe output swapped / crisis text), `done {message, safety}`, `error {code,message}`. Closing the connection cancels the upstream AI request and nothing is stored. Errors before streaming starts are normal JSON. `journalEntryId` needs active `JOURNAL_AI_SHARING`.
* `POST /sessions/:id/messages/:messageId/feedback {value: 1|-1}` · `POST /sessions/:id/end {summarize?}` · `GET /sessions/:id/summary` (AI-generated, flagged `generatedByAi`)
* 409 when messaging an ended session. Provider errors: `AI_NOT_CONFIGURED` 503, `AI_UNAVAILABLE` 503, `AI_TIMEOUT` 504, `AI_RATE_LIMITED` 429, `AI_BAD_RESPONSE` 502, `AI_MISCONFIGURED` 503, `AI_QUOTA_EXHAUSTED` 503 (provider balance/quota used up — shown as unavailable, not "busy"). A failed send stores nothing, so retrying cannot duplicate the user's message.

## Mood / Journal / Goals 🔒
* `POST /moods {moodScore 1-5, stressScore? 1-5, note?}` · `GET /moods?from&to&limit` · `DELETE /moods/:id` (entries are `source: "user_reported"`)
* `POST /journal {content ≤20000, entryType}` · `GET /journal?search&entryType&from&to&limit` (search is in-memory over the latest 500 entries because content is encrypted) · `GET|PATCH|DELETE /journal/:id` (delete destroys content immediately)
* `POST /goals {title, targetDate?}` · `GET /goals` · `PATCH /goals/:id {title?, status?, targetDate?}` · `DELETE /goals/:id` · `POST /goals/:id/check-ins {progressValue 0-100, note?}` (100 marks complete)

## Natural voice 🔒
* `POST /speech {text (1-1200 chars), language: en|bn|mixed}` → 200 `audio/mpeg` (mp3, `Cache-Control: no-store`). Needs the same active consents as chat. Rate limited to 60/min/user. The text is forwarded to the voice provider (OpenAI `gpt-4o-mini-tts`, voice from `OPENAI_TTS_VOICE`) and is **never stored or logged**. Errors: `TTS_NOT_CONFIGURED` 503, `TTS_QUOTA_EXHAUSTED` 503, `TTS_RATE_LIMITED` 429, `TTS_MISCONFIGURED` 503, `TTS_TIMEOUT` 504, `TTS_UNAVAILABLE` 503, `TTS_BAD_RESPONSE` 502, validation 400, consent 403. The app retries transient errors once, then falls back to the phone's own voice.

## Safety & privacy
* `GET /resources/crisis?country=BD` — **public**; each row has `verified` (false until an operator sets `lastVerifiedAt`). Unknown country → `resources: []` plus a generic fallback sentence.
* `POST /safety/check {text, language}` 🔒 — returns severity and, for HIGH/IMMINENT, the crisis message. Text is never stored.
* `POST /privacy/export` 🔒 — decrypted JSON of everything the user owns. `DELETE /privacy/account {password}` 🔒 — permanent, cascading; keeps only an audit row with no personal data.

## Limits
Global 300 req/min/IP, auth routes 10/min/IP, AI messages 20/min/user, JSON body 128 kB (`413`), message 4000 chars.
