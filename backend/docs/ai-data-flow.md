# AI data flow (what leaves the server, and when)

Derived from the code in `backend/src` (mainly `services/glmClient.ts`, `app.ts`, `config/env.ts`). Where the code does not say, this document says "not determined from code".

## Which model and endpoint

All text-model calls go through one client, `createGlmClient` (`services/glmClient.ts`): `POST {baseUrl}/chat/completions` with `Authorization: Bearer <apiKey>`. The backend alone holds the key. Provider errors are mapped to generic client-safe errors; provider bodies are never forwarded to the app.

The provider is picked in `app.ts`:

| Condition | Provider | Base URL | Model |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` set | OpenAI-compatible | `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) | session/user-facing replies: `OPENAI_SESSION_MODEL` (default `gpt-4.1`, falls back to `OPENAI_MODEL`); utility calls such as the emotion read: `OPENAI_UTILITY_MODEL` (falls back to `OPENAI_MODEL`, default `gpt-4o-mini`) |
| otherwise | Z.AI GLM | `GLM_BASE_URL` (default `https://api.z.ai/api/paas/v4`) | `GLM_MODEL` (default empty; the client refuses to run with an empty model or key) |

Other settings: `GLM_TIMEOUT_MS` (45 s), `GLM_MAX_OUTPUT_TOKENS` (600), `GLM_THINKING`, `OPENAI_REASONING_EFFORT`. Which provider and model are used in production is not determined from code (it depends on the deployed environment). Server region or location of the provider endpoint: not determined from code.

Speech uses separate OpenAI endpoints (`OPENAI_BASE_URL`, models `OPENAI_STT_MODEL` / `OPENAI_TTS_MODEL`); audio and transcripts handling there is outside this document. Embeddings for retrieval use `OPENAI_BASE_URL` too (`createEmbedder`); what exactly is embedded: not determined here.

## What each feature sends to the model

| Feature (route / service) | Sent to the model | Consent required before the call |
| --- | --- | --- |
| Chat / voice session replies (`conversationService`, realtime relay) | Recent conversation messages, system prompt, remembered facts/summary, optionally a journal entry the user chose to share (first 3000 chars) | Base consents (age 18+, AI disclosure, privacy); sharing a journal entry also needs `JOURNAL_AI_SHARING`. Own flow, unchanged. |
| Session summary, memory extraction and merge, program/session engine, emotion read, transcript clean-up, model risk check for uncovered languages | Conversation text or transcript (risk check: first 1500 chars) | Base consents via the session/speech flow. Own flow, unchanged. |
| Journal prompts `POST /journal-ai/prompts` | Mood, stress, optional free-text topic | `JOURNAL_AI_SHARING` (added in this change) |
| Journal emotion words `POST /journal-ai/emotions` | The journal text (first 4000 chars) | `JOURNAL_AI_SHARING` |
| Sleep coach `POST /sleep/coach` | Last up to 7 nights: bedtimes, average duration, awakenings, rested score, sleep score, desired bedtime. The free-text sleep note is not sent. | `WELLNESS_AI_SHARING` (added in this change) |
| Daily analysis `POST /insights/analysis` | Last 7 days of per-day mood, stress, energy, sleep score, sleep hours, Kaizen status | `WELLNESS_AI_SHARING` (added in this change) |
| Kaizen weekly review `POST /kaizen/weekly-review` | Last 7 days of Kaizen step titles with status, difficulty feedback, restarts, hard-day count. Free-text reflection comments are not sent. | `WELLNESS_AI_SHARING` (added in this change) |

Consent behaviour for the tools above: a missing consent returns HTTP 403, error code `CONSENT_REQUIRED`, `details.consentType` naming the consent; the model is never called and no template is substituted. Withdrawing a consent (`DELETE /consents/:id`) blocks the tool again. The rule-based / static fallback (`ai: false`) is used only when the user has consented but the model fails, returns unusable output, or there is too little data.

Safety rules applied around model output: journal text with HIGH or IMMINENT risk is answered with the crisis response and never reaches the model; model output goes through `checkOutput` where the route applies it (journal AI). The sleep coach, daily analysis and weekly review only receive numeric or template-generated data, and their prompts forbid diagnosis, medication and shaming; whether their outputs are also passed through `checkOutput`: not determined from code (they are not, as of this change).

## Retention

- Model requests/responses of the three consent-gated tools above are not stored by the route code (only the user's own entries/diary live in their tables). Chat messages, summaries and memories are stored by their services (encrypted with the app cipher); input/output token counts are recorded alongside sessions/messages. Application logging of request bodies was not audited: not determined from code.
- No automatic retention/purge job was found in `src`; deletion is user-initiated (delete endpoints, privacy export/delete routes).
- Retention, logging, and training policy on the provider side (OpenAI or Z.AI): not determined from code. It depends on the provider account/contract and must be confirmed with the provider before the privacy text claims anything.

## Added features (wellness phases)

| Feature | Sent to the model | Consent before the call | Risk check |
| --- | --- | --- | --- |
| `GET /insights/monthly` | Only computed facts (counts, averages, which metrics moved together, weekday highs/lows). No free text. Statistics are computed server-side without a model; the model only phrases them and every number in its output is checked against the facts. | `WELLNESS_AI_SHARING` (not needed with `ai=0` or when there is too little data) | n/a (numbers only) |
| `POST /journal/voice` | Nothing for transcription except the audio itself, which goes to the speech-to-text provider (`OPENAI_BASE_URL`, `OPENAI_STT_MODEL`). Emotion words and the optional clean-up send the transcript to the text model. | Base consents for transcription; `JOURNAL_AI_SHARING` for emotion words and clean-up | Transcript is risk-checked before it is stored or sent anywhere; HIGH / IMMINENT is neither stored nor sent |
| `POST /practice/thought-record/alternative` | The thought and optional situation text | `JOURNAL_AI_SHARING` | Checked first; HIGH / IMMINENT never reaches the model and is never stored |
| Nudges, Today feed, health import, practice completions | Nothing (rule-based, no model) | n/a | n/a |

Raw voice recordings are discarded after transcription unless the user passes `keepAudio=1`, in which case they are stored encrypted with the app cipher in the journal entry and deleted with it. Device health data (`HEALTH_IMPORT` consent) is stored only in the database and is never sent to the model except as the computed aggregates above.

## Connected features, action menu and cost control (this change)

### What is rule-based (no model call, no consent needed)

The App Action Menu (`services/actionMenu.ts`, `GET /actions/menu`), the Today feed (`GET /today/feed`) including `SESSION_INVITE`, the nudges, the Sleep -> today adaptation (a short night shrinks today's Kaizen step once), the routine steps and the auto-marking of the routine after a practice, the pattern cards with their next-step buttons and the `practice` block of `GET /insights/monthly`, the session-close card, `WALK_10`, `GRATITUDE_NOTE`, `REACH_OUT` (drafts are fixed templates; nothing is sent), and the `reason` ("why am I seeing this") lines. All of them read only the person's own numbers or the registry; the text the person writes is used in memory to infer tags (for example "sleep", "lonely") and is not stored or sent anywhere by these features.

### New or changed model usage

| Feature | Sent to the model | Consent before the call | Risk check | Fallback |
| --- | --- | --- | --- | --- |
| Session chat / call: action offer | Nothing new about the person. A per-turn list of the actions the app can open (ids and one-line English descriptions) is added to the prompt after the person has been heard for at least 2 earlier turns. The model may return one id on a final `[[ACTION:ID]]` line; the line is stripped from what is shown, spoken and saved, and an id that was not on the menu is dropped. | Base consents (unchanged) | Risk signals -> the menu holds only Emergency, Safety plan and a trusted person; HIGH / IMMINENT text never reaches the model (unchanged) | No menu / no card |
| `POST /reports/weekly` ("Your week") | Only computed facts: counts and averages of Kaizen steps, sleep and mood for the last 7 days. One model call; every number in the answer must appear in the facts; shape, `outputOk` and the number check decide between the model text and the template. | `WELLNESS_AI_SHARING` (403 and no model call without it) | With risk signals the model is not called at all and only support options are returned | Template, `ai:false` |
| Emotion Reading `POST /journal-ai/emotions` (+ the 2-minute step) | The journal text, as before. The step itself is chosen by rules from the feeling words. The reading is stored encrypted with the entry (`JournalEntry.emotionEncrypted`). | `JOURNAL_AI_SHARING` (also needed to add the step to Kaizen) | HIGH / IMMINENT: crisis response, nothing derived. Any safety level (ELEVATED too) or risk signals: no step | Offline word list, `ai:false` (the step still comes from rules) |
| Sleep Coach `POST /sleep/coach` | Unchanged. The new `routineStep` is picked by rules from the same diary rows. | `WELLNESS_AI_SHARING` | n/a (numbers) | Rule-based tip, `ai:false` |

The model-call budget did not grow: the only new kind of model call is the single weekly report (and a stored report younger than 6 hours is returned without calling again). The action offer adds no call: it rides on the existing reply.

### Risk signals

`services/riskState.ts`: a HIGH / IMMINENT safety event or a session flagged HIGH in the last 14 days, a PHQ-9 item 9 flag or a severe / moderately severe PHQ-9 / GAD-7 band in the last 14 days, an ELEVATED event in the last 3 days, or a mood <= 2 with stress >= 9 check-in in the last 3 days. While any holds: the action menu, the Today feed, the monthly pattern buttons, the weekly report and the session-close card offer only Emergency, Safety plan and a trusted person (plus, for the invitation, a line suggesting a doctor or counsellor); no exercise, task, step or session is proposed.

### Prompt structure and caching

The session prompt is built static-first: persona and rules, language directive, the action-offer rules (all identical for every turn), then person- and session-specific material, then the per-turn parts (hidden-read note, reply shape, examples, the action menu), and the short reply reminder last. `services/glmClient.ts` sends a plain `chat/completions` body (`model`, `messages`, `max_tokens` / `max_completion_tokens`, `temperature`, optional penalties and `reasoning_effort`, `stream`, `stream_options`). It sets no cache control or cache key, and no provider-side caching option is documented in the client. So explicit prompt caching is **not available** here. What the ordering does is make the identical prefix as long as possible, which providers that cache identical prompt prefixes automatically (OpenAI does this for long prompts) can use without any code change; whether that happens in production is not determined from code.

### Opt-in anonymous product events

Written only when `UserProfile.analyticsOptIn` is true (`PUT /me/ai-settings`). Same daily-rotating pseudonym as `POST /analytics/events`; no user id, no text. Names and props: `action_offered`, `action_accepted`, `action_dismissed` `{kind, surface}`; `model_call` `{feature, bucket}` with bucket `lt1s | 1to3s | 3to6s | gt6s`; `fallback_used` `{feature}`. Aggregates: `npx tsx scripts/ai-usage-report.ts [days]`.

### Suggestion level

`UserProfile.suggestionLevel` (`OFTEN | SOMETIMES | RARELY | NEVER`, default `SOMETIMES`) via `GET/PUT /me/ai-settings`. NEVER: no action menu, no nudges, no invitation (crisis support is shown regardless of the level). RARELY: at most one chat offer a day, short menus, one nudge a day, no soft check-in nudge, invitation at most once a week.

### What the AI sees

`GET /privacy/ai-data` returns the consent state and a map of consent -> data keys, feature -> data keys, and what is never sent (`services/aiDataMap.ts`). Keep that file in step with this document.

### Known gap (not changed here)

The chat prompt's WELLNESS CONTEXT (`contextService.buildWellnessContext`) includes the latest check-in numbers, last night's sleep and today's Kaizen step under the base consents only. By the consent rules of the wellness features these numbers belong to `WELLNESS_AI_SHARING`; the page above lists this under `session_chat` -> `WELLNESS_SNAPSHOT` so it is shown honestly. Gating it would change existing chat behaviour and was left for a product decision.
