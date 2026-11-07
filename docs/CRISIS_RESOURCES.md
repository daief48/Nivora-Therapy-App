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
The table `SupportResource` is the only source of numbers shown. `prisma/seed.ts` seeds a minimal set of national emergency numbers, all with `lastVerifiedAt = NULL` → API `verified:false` → UI says "Not yet verified — double-check". **Bangladesh crisis/helpline numbers are added only after verification (Kaan Pete Roi is the only one so far; see below).**

For each row, a named operator must:
1. Find the number on the operating organisation's **official** website or an official government source (record URL + date + your name).
2. Call/text it (or confirm with the organisation) — check it is active, its hours, languages, free/paid, and whether it serves callers from that country.
3. Insert/update the row (`countryCode`, `language`, `resourceType`, `name`, `contactDetails`) and set `lastVerifiedAt = now()`.
4. Re-verify at least every 6 months (suggest alerting on `lastVerifiedAt < now() - 180 days`); mark `lastVerifiedAt = NULL` when in doubt.
5. Never copy numbers from search snippets, blogs, or an LLM.

```sql
UPDATE "SupportResource" SET "lastVerifiedAt" = now() WHERE id = '<uuid>';  -- only after steps 1-2
```

## Research log (2026-10-31)
Method: each number below was read on the official/authoritative page listed (fetched, not taken from search snippets). **Step 2 (placing a test call) was NOT done by us**, so "verified" here means "read on the official page on that date". Rows also store `sourceUrl`, which the API returns (only when verified) and the app shows. A named operator should still make the confirming calls before launch.

Seeded as verified (`prisma/seed.ts`):

| Country | Number | Official page read |
|---|---|---|
| US | 988 Suicide & Crisis Lifeline | https://988lifeline.org/ ("Call, text, or chat with a 988 Lifeline counselor") |
| GB | 999 (emergency), NHS 111 mental health option | https://www.nhs.uk/mental-health/get-urgent-help-for-mental-health/ |
| CA | 911, 9-8-8 Suicide Crisis Helpline | https://www.canada.ca/en/public-health/services/mental-health-services/mental-health-get-help.html |
| AU | 000, Lifeline 13 11 14 | https://www.lifeline.org.au/131114/ |
| AE | 999 police, 998 ambulance | https://u.ae/en/information-and-services/justice-safety-and-the-law/Safety/handling-emergencies |

Left UNVERIFIED (no official page could be read this session):

| Country | Number | Why not verified |
|---|---|---|
| BD | 999 | Only news articles found; try ictd.gov.bd / bangladesh.gov.bd |
| US | 911 | usa.gov page not reachable (404) |
| IN | 112, Tele-MANAS 14416 | mohfw/telemanas sites failed (TLS/403); PIB press releases mention 14416 / 1-800-891-4416 in search results but the page was not read |
| SA | 911 | my.gov.sa returned 403 (search summary mentions 911, 997, 999, 998, 937: unconfirmed) |
| MY | 999 | official page did not mention 999. Talian Kasih 15999 (JKM, a welfare/abuse helpline, not a suicide line) is confirmed at malaysia.gov.my/en/topics/talian-kasih-15999 but is deliberately not seeded as a crisis line |
| PK, NP, LK | police 15 / 100 / 119 | no official source searched; seeded as widely-published fallbacks |

Bangladesh: Kaan Pete Roi (09612-119911, listed as daily 3 PM–3 AM) was read on the organisation's own page, https://kaanpeteroi.org/helpline-service/ (2026-11-08) and is seeded as a verified CRISIS_LINE. It is an NGO line, not a government one; re-check the hours before launch. 999 stays unverified (press only). 16263 and 10921 were not checked and are not seeded.
