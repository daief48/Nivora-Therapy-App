# Crisis safety & resource verification

## How the safety layer works
`backend/src/services/safetyService.ts` — deterministic, independent of the LLM.

| Severity | Trigger (examples) | Behaviour |
|---|---|---|
| `IMMINENT` | suicidal/self-harm intent **plus** timing or means ("tonight", "pills", "আজ রাতে", "ekhoni") | Fixed localized crisis reply, the AI model **not called**, user's text **not stored**, `SafetyEvent` written |
| `HIGH` | explicit suicidal ideation, self-harm, intent to harm others | same as above |
| `ELEVATED` | abuse, hopelessness, negated mentions ("I'm not suicidal…") | the AI model is called with a safety addendum; a support footer + resources are appended |
| `NONE` | otherwise | normal flow |

* Languages: English, Bangla script, romanized Bangla, mixed. Crisis replies are Bangla/English/both depending on session language and script of the message.
* Failure mode: if classification throws, the message is treated as `ELEVATED`, never as safe.
* Model output is also checked (harmful instructions, false claims like "I contacted emergency services", diagnosis statements); a hit is replaced with a safe fallback, including mid-stream.
* The crisis text never claims anyone was notified, says the AI cannot contact anyone, and asks for the country when none is known.
* The avatar's serious, caring face for severe wording (and the matching tone while a crisis reply is spoken) is **cosmetic**: it uses separate, simpler client-side keyword rules in `mobile/src/utils/reaction.ts` and is not part of the safety system. Natural voice reads the same fixed crisis text aloud; the text never claims anyone was notified.
* Tests: `backend/src/tests/safety.test.ts` has 18 curated scenarios + end-to-end flows. They use local fixtures only; crisis text is never sent to any external API.

**Known weaknesses:** phrase lists are not exhaustive; misspellings, slang, metaphor and dialects will be missed; negation handling is crude. This is a first line, not a clinical instrument.

## Required before public launch
1. A licensed mental-health professional (ideally with Bangladeshi / South Asian clinical context) reviews: the severity definitions, phrase lists, crisis wording (both languages), the "ask country" behaviour, and the ELEVATED policy.
2. Extend the fixture set with clinician-supplied scenarios, including false-positive cases; keep them in `safety.test.ts`.
3. Decide escalation policy for repeated HIGH events (this build deliberately has **no** human escalation or auto-contact; it must not imply one).

## Support resources: verification procedure
The table `SupportResource` is the only source of numbers shown. `prisma/seed.ts` seeds a minimal set of national emergency numbers, all with `lastVerifiedAt = NULL` → API `verified:false` → UI says "Not yet verified — double-check". **Bangladesh crisis/helpline numbers are intentionally absent: add them only after verification.**

For each row, a named operator must:
1. Find the number on the operating organisation's **official** website or an official government source (record URL + date + your name).
2. Call/text it (or confirm with the organisation) — check it is active, its hours, languages, free/paid, and whether it serves callers from that country.
3. Insert/update the row (`countryCode`, `language`, `resourceType`, `name`, `contactDetails`) and set `lastVerifiedAt = now()`.
4. Re-verify at least every 6 months (suggest alerting on `lastVerifiedAt < now() - 180 days`); mark `lastVerifiedAt = NULL` when in doubt.
5. Never copy numbers from search snippets, blogs, or an LLM.

```sql
UPDATE "SupportResource" SET "lastVerifiedAt" = now() WHERE id = '<uuid>';  -- only after steps 1-2
```
