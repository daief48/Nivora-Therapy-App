# Safety protocol (draft)

Nivora is an AI wellness companion. It is **not** a therapist, doctor or emergency service. This protocol says what the app does and says at each risk level, per topic. It describes the code as it is (`backend/src/services/safetyService.ts`, `riskFallback.ts`, `styleGuard.ts`, `systemPrompt.ts`, `backend/src/data/lexicon.ts`) and is a **draft: it must be reviewed by a licensed clinician and a native Bangla speaker before launch** (see `clinical-review.md`). Phone numbers are never written here or in code: the only source of numbers is the `SupportResource` table, procedure and verification rules in [`CRISIS_RESOURCES.md`](CRISIS_RESOURCES.md).

## 1. How risk is assessed

1. `assess(text)` = max(rule result, draft-lexicon result). The lexicon can only **raise** the level, never lower it; a look-alike idiom ("exam e mara gelam", "hasi te more jachhi") cancels only lexicon matches, never a rule match.
2. Negated mentions ("I'm not suicidal") are lowered by one level by the rules, never to NONE. Any classifier error becomes ELEVATED.
3. For languages the rules do not cover, a model-based check runs only when the rules found nothing (also when only the lexicon raised the level to ELEVATED). Its failure mode is ELEVATED.
4. The lexicon is unreviewed (`reviewed: false` on every entry). Until it is signed off, treat its flags as "better a footer than a miss".

| Level | Trigger examples | What the system does |
| --- | --- | --- |
| IMMINENT | intent plus time or means ("tonight", pills, rope, "ekhoni"), or an act in progress (took pills) | Fixed crisis reply, model **not called**, user text **not stored**, safety event recorded |
| HIGH | explicit suicidal ideation or plan, passive ideation ("sleep and never wake up"), self-harm, intent to hurt others, possible overdose | Same as IMMINENT, with the calmer opening |
| ELEVATED | hopelessness, being a burden, abuse, relapse or craving, negated mentions, unclear idioms | Model is called with the safety note; a short support footer is appended; session agenda and exercises give way to presence |
| NONE | everything else, including ordinary sadness, anxiety or tiredness | Normal flow (tone still follows the emotion read) |

## 2. What the reply may and may not do, by level

**IMMINENT / HIGH (fixed reply, not model-written).** It says: thank you for telling me; your safety comes first; I am an AI and cannot contact anyone for you; if you might act on these thoughts or are in danger call your local emergency number now or go to the nearest emergency room; stay with someone you trust; here are the verified options for your country, or tell me your country. It never claims anyone was notified, never invents a number, never asks for details of the method, never argues, never promises "it will be fine", and never offers an exercise as a substitute.

**ELEVATED (model-written, guarded).** Warm, short, check how they are and whether they are safe, name the feeling in their words, one open question at most, gently mention someone they trust or local emergency services if they feel unsafe. No exercises as a replacement for support, no advice stack, no reassurance that cannot be known.

**All levels, every reply (checked by `styleGuard` and `checkOutput` / `checkSpokenOutput`):**

| Never | Because | Check |
| --- | --- | --- |
| Diagnose ("you have depression", "sounds like you have an anxiety disorder") | not qualified | `checkOutput` DIAGNOSIS |
| Name, dose, start, stop or change a medicine | not qualified, can harm | `checkSpokenOutput` MEDICATION, UNSAFE |
| Say "I am your therapist / a doctor / a person" | false, undermines trust | `checkSpokenOutput` HUMAN_CLAIM |
| Say help was called or is on the way | the app cannot contact anyone | `checkOutput` FALSE_CLAIM |
| Promise it will be fine, minimise, lecture or define terms early | false reassurance, feels dismissive | `styleGuard` FILLER, DEFINITION |
| Ask more than one question; list; exceed 5 sentences (text) or 3 (voice) | overwhelming, especially when distressed | `styleGuard`, voice limit |
| Give advice before the person feels heard (first 2 turns) | invalidating | `styleGuard` EARLY_ADVICE |
| Encourage or describe self-harm, suicide methods, or substance use | harm | `checkOutput` UNSAFE |

A blocked reply is replaced by the safe fallback; style violations trigger one corrective regeneration only.

## 3. By topic

### Depression and low mood (risk: self-harm, suicide)
- NONE: sadness, emptiness, tiredness ("mon ta bhar lagche", "kichu bhalo lagche na"). Reflect, validate, one gentle question. No diagnosis, no "cheer up".
- ELEVATED: hopelessness, "ar parchi na", being a burden, "nobody would miss me". Check in on safety directly and kindly; mention a trusted person; footer.
- HIGH / IMMINENT: passive or active ideation, plan, means. Fixed crisis reply. Do not continue the exercise or session plan in that turn.
- Do not say: "you are depressed", "think positive", "others have it worse", "don't do something stupid".

### Addiction and substance use (risk: relapse, overdose, withdrawal)
- NONE: nicotine cravings, wanting to cut down; supportive, curious, no shame.
- ELEVATED: relapse, craving, "cannot stop", local substance names (yaba, phensedyl, ganja, heroin, alcohol) used as a statement of use. Non-judgemental: a slip is information, not failure; ask what was happening just before; encourage contacting their doctor, a treatment service or a trusted person. Never give quantities, "safe" amounts, tapering advice, or tips on obtaining or using.
- HIGH: possible overdose ("took too much", passed out after using), use combined with self-harm intent. Fixed crisis reply: this is a medical emergency, call the local emergency number now. Sudden stopping after heavy alcohol or sedative use can itself be dangerous: advise medical help, never a plan.
- Do not say: "just stop", "you will be fine", anything that normalises a dose, anything that sounds like a medical instruction.

### Anxiety and panic (risk: panic, hopelessness, rarely self-harm)
- NONE: worry, racing thoughts, "dom bondho lage", "buk dhorfor korche". Slow, short, present-tense grounding in the user's words; one question. Voice replies: 3 sentences maximum.
- ELEVATED: "cannot go on like this", "cannot take the panic anymore", panic with hopelessness. Check safety; footer.
- HIGH: anxiety with a wish to die or hurt oneself. Fixed crisis reply.
- A panic attack with chest tightness is not diagnosed by the app. If the person may have a medical problem (chest pain, cannot breathe, faints), suggest local emergency or a doctor rather than guessing it is panic.

### Abuse and violence
- ELEVATED: someone hurts or threatens them, fear at home. Believe them, ask if they are safe now, mention local emergency services and trusted people. Do not advise confronting or leaving, and do not promise protection.
- HIGH: intent to hurt someone else. Fixed reply; the app does not contact anyone.

## 4. Language and tone

- Reply in the user's language and script mix (Bangla, Banglish, English). Do not correct their spelling. Do not switch to formal Bangla if they use casual speech.
- The crisis wording exists in English, Bangla, Hindi and Nepali; sessions in other languages get the English reply. All of it needs native review.
- Voice: calm, slow, three short sentences, at most one question, last. Never read a list of numbers aloud without confirming the country first.

## 5. Known limits (do not hide these in marketing or UI)

- Phrase matching misses unseen wording. A held-out probe of 30 fresh messages, run before the lexicon was extended for them, flagged only 2 of 27 risky ones; figures from `npm run eval:safety` are on fixtures the lexicon has since been tuned for, so they overstate real recall. See the eval header and `clinical-review.md`.
- Idioms cause both over- and under-flagging in Bangla and Banglish; spelling is not standardised.
- There is no human escalation and no auto-contact. The product must never imply there is.
- Panic, intoxication and trauma can look like risk and the other way round. A clinician must define the boundary cases.

## 6. Change control

Any change to patterns, lexicon entries, levels, crisis wording or this file needs: a new fixture in `backend/src/tests/evals/safety-recall.eval.ts` (include a benign look-alike), a passing `npm run eval:safety` and the existing safety tests, and a clinician note in the review log. Never loosen an assertion to make a number pass.
