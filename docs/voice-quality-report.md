# Voice quality report (TTS -> STT round trip)

**Status: not run yet.** This file is a skeleton. It is overwritten by the script below once someone runs it with an API key.

## What it measures

For each sentence in `backend/scripts/fixtures/bangla-voice-sentences.json` (44 Bangla, Banglish, English and mixed emotional sentences with expected text), the script asks the app's own `ttsClient` to speak it, feeds the audio to the app's own `sttClient`, and compares the transcript with the expected text: word error rate (WER) and character error rate (CER), per language, plus the ten worst sentences.

It tells you how well the recogniser understands the synthetic voice and whether the voice pronounces Bangla (and Latin-letter Bangla) intelligibly. It does **not** measure real users with accents, noise or poor microphones.

## How to run

Requires `OPENAI_API_KEY` (in `backend/.env` or the environment). It makes about 88 paid API calls (one speech and one transcription per sentence). Without a key it prints a message and exits without changing anything. It is not part of CI.

    cd backend
    npm run voice:check                 # all sentences
    npx tsx scripts/stt-tts-check.ts --lang bn --limit 5     # a quick trial

The model, voice and base URL come from the same env vars the backend uses (`OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_STT_MODEL`, `OPENAI_BASE_URL`).

## Results

None yet. After a run this section is replaced with: a summary table (language, sentences, failed calls, mean WER, mean CER), mean latency, the worst ten sentences with expected vs heard text, and a per-sentence table.

## Before trusting any number

- A native Bangla speaker confirms every fixture sentence and its expected transcript (valid alternative spellings count as errors here).
- Listen to a sample of the generated audio, not only the scores.
- Compare with the previous report rather than a fixed target; re-run after changing the TTS model, voice or style instructions in `backend/src/services/ttsClient.ts`.
