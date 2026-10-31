# Clinical and language review checklist

**Release is blocked until every item below is signed off by the named reviewer type.** Nothing here has been reviewed yet: all of it was drafted by AI-assisted engineering. "Reviewed" fields in the code (`reviewed: false` in `backend/src/data/lexicon.ts`) must stay `false` until a reviewer has actually gone through the entry.

Reviewers
- **Clinician (C):** a licensed psychologist or psychiatrist with South Asian / Bangladeshi clinical context.
- **Language (L):** a native Bangla speaker (Dhaka usage as the baseline; note regional variants), comfortable with Banglish chat spelling.

How to sign off an item: tick the box, write your name, role, date and any change you required in the review log at the bottom. A partial review is not a tick: say which part was covered.

## A. Safety-critical artifacts

- [ ] **C + L. `backend/src/data/lexicon.ts`** (about 475 entries). For every entry: is the meaning right, is the language tag right, is the risk level right (NONE / ELEVATED / HIGH / IMMINENT), is the category right. Look hard at: idioms marked benign (do they ever hide real distress?), entries at ELEVATED that should be HIGH, addiction slang, ambiguous phrases ("ar thakte chai na", "chole jete ichha kore"). Missing common phrasing is also a finding: add examples.
- [ ] **C + L. Rule patterns in `backend/src/services/safetyService.ts`** (suicide, self-harm, violence, abuse, hopelessness, the near-miss variants, imminent markers, negation downgrade). Confirm levels and the Bangla, Hindi and Nepali wording.
- [ ] **C. `docs/safety-protocol.md`**: what to say and not say per level and topic (depression, addiction, anxiety, abuse). Confirm it is clinically sound and safe to publish internally.
- [ ] **C + L. Fixed crisis replies and the support footer** (`crisisMessage`, `elevatedFooter`, `UNSAFE_OUTPUT_FALLBACK` in `safetyService.ts`): tone, wording, order of actions, the "I am an AI and cannot contact anyone" line, the ask-for-country behaviour, in Bangla, English, Hindi and Nepali.
- [ ] **C. ELEVATED policy** (model is called, safety note, footer) and the decision on repeated HIGH events (this build has no human escalation by design).
- [ ] **C + L. Model-based risk fallback prompt** (`backend/src/services/riskFallback.ts`).
- [ ] **Operator. `docs/CRISIS_RESOURCES.md`**: every number in `SupportResource` verified against an official source, with date and name. No number may come from this repository's text or a language model.
- [ ] **C. Evaluation fixtures** (`backend/src/tests/evals/safety-recall.eval.ts`, `reply-style.eval.ts`): add clinician-written scenarios, including borderline and benign cases; confirm the 100% direct-recall rule and the false-positive limit are the right bars. Note the fixtures were tuned alongside the lexicon, so a clinician-supplied hold-out set is needed to estimate real recall.

## B. Content shown or spoken to users

- [ ] **C + L. `backend/src/services/systemPrompt.ts`** (persona, honesty rules, safety layer, spoken addendum, elevated addendum, reply reminder, language directives).
- [ ] **C + L. Reply-style rules** (`backend/src/services/styleGuard.ts`, `backend/src/services/spokenReply.ts`, `backend/src/services/therapyExamples.ts`): are the good examples actually good in Bangla, are the Bangla definition / filler / advice patterns correct and not over-blocking.
- [ ] **C + L. Topic prompts** (`backend/src/modules/topics` and related services): wording, scope, redirection to professionals, no diagnosis or treatment claims.
- [ ] **C + L. Assessment translations** (`backend/src/modules/assessments`, `backend/src/services/assessment*`): item wording against the validated source instrument and its licence; scoring bands; how results are worded to the user (never a diagnosis); behaviour on a high score or on the self-harm item.
- [ ] **C + L. Exercises and program content** (`backend/src/services/programContent.ts`, `backend/src/services/therapyData.ts`, `backend/src/modules/programs`): safety of each exercise (breathing, grounding, sleep, addiction-related content), contraindications, instructions in natural Bangla, claims of benefit.
- [ ] **C + L. Knowledge corpus** (`backend/src/services/knowledge/corpus.ts`): accuracy, sources, no medication or dosing content, no diagnostic language, cultural fit. Remove anything that cannot be sourced.
- [ ] **L. Voice**: listen to a sample of Bangla and Banglish speech from the chosen TTS voice; check pronunciation of conjuncts and mixed English words; review `backend/scripts/fixtures/bangla-voice-sentences.json` and the generated `docs/voice-quality-report.md` once a run exists.
- [ ] **C + L. Mobile UI strings** for crisis, consent, privacy and disclaimers (outside this backend folder; list owners here when known).

## C. Open questions for the reviewers

1. Should passive ideation ("I wish I could sleep and never wake up") always be HIGH (fixed reply), or ELEVATED with a model-written check-in?
2. Should a relapse alone be ELEVATED, or NONE with a supportive reply? Where is the line for "possible overdose"?
3. Which Bangla idioms of exaggeration ("morlam", "mara gelam") are safe to ignore, and in which contexts must they still be asked about?
4. What should the app say to someone in panic with physical symptoms?
5. What is an acceptable false-positive rate for the crisis reply, given that it interrupts the conversation?

## Review log

| Date | Reviewer (name, role) | Artifact | Result (approved / changes required) | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
