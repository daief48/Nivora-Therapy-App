// Round-trip voice quality check: text -> ttsClient (audio) -> sttClient (text) -> word error rate against the expected text.
// NOT run in CI and never run automatically: it calls the paid speech API. It needs OPENAI_API_KEY (backend/.env or the environment);
// without a key it prints why and exits 0 without touching docs/voice-quality-report.md.
// Usage (from backend/):  npx tsx scripts/stt-tts-check.ts [--limit N] [--lang bn|banglish|en|mixed]     (or: npm run voice:check)
// Output: docs/voice-quality-report.md (overwritten). Audio is kept in memory only, nothing is written besides the report.
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTtsClient, type SpeechLang } from '../src/services/ttsClient.js';
import { createSttClient, type SttLang } from '../src/services/sttClient.js';

type FixtureLang = 'bn' | 'banglish' | 'en' | 'mixed';
interface Sentence { id: string; lang: FixtureLang; text: string; expected: string }
interface Result { s: Sentence; heard: string; wer: number; cer: number; ms: number; error?: string }

const FIXTURE = fileURLToPath(new URL('./fixtures/bangla-voice-sentences.json', import.meta.url));
const REPORT = fileURLToPath(new URL('../../docs/voice-quality-report.md', import.meta.url));
const env = (k: string, d: string) => process.env[k] || d;

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const limit = Number(arg('limit') ?? Infinity), onlyLang = arg('lang') as FixtureLang | undefined;

const apiKey = env('OPENAI_API_KEY', '');
if (!apiKey) {
  console.log('OPENAI_API_KEY is not set: skipping the STT/TTS round-trip check (no API call was made, docs/voice-quality-report.md is unchanged).');
  console.log('Set it in backend/.env or the environment and run again. This check spends API credits (about 1 speech + 1 transcription call per sentence).');
  process.exit(0);
}

/** Folds text for comparison: NFKC, lowercase, zero-width and punctuation removed, Bangla digits to ASCII, whitespace collapsed. */
export function normalizeForWer(t: string): string {
  return t.normalize('NFKC').toLowerCase().replace(/[​-‍⁠﻿]/g, '')
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance over arbitrary token arrays. */
function editDistance<T>(a: T[], b: T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
export const wer = (ref: string, hyp: string) => { const r = normalizeForWer(ref).split(' ').filter(Boolean); return r.length ? editDistance(r, normalizeForWer(hyp).split(' ').filter(Boolean)) / r.length : 0; };
export const cer = (ref: string, hyp: string) => { const r = [...normalizeForWer(ref).replace(/ /g, '')]; return r.length ? editDistance(r, [...normalizeForWer(hyp).replace(/ /g, '')]) / r.length : 0; };

const ttsLang: Record<FixtureLang, SpeechLang> = { bn: 'bn', banglish: 'bn', en: 'en', mixed: 'mixed' };
const sttLang: Record<FixtureLang, SttLang> = { bn: 'bn', banglish: 'bn', en: 'en', mixed: 'mixed' };
const timeoutMs = Number(env('GLM_TIMEOUT_MS', '60000'));
const baseUrl = env('OPENAI_BASE_URL', 'https://api.openai.com/v1');
const tts = createTtsClient({ apiKey, baseUrl, model: env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'), voice: env('OPENAI_TTS_VOICE', 'marin'), timeoutMs });
const stt = createSttClient({ apiKey, baseUrl, model: env('OPENAI_STT_MODEL', 'gpt-transcribe'), timeoutMs });

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { sentences: Sentence[] };
const sentences = fixture.sentences.filter((s) => !onlyLang || s.lang === onlyLang).slice(0, limit);
console.log(`Round-tripping ${sentences.length} sentences (tts ${env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts')}, stt ${env('OPENAI_STT_MODEL', 'gpt-transcribe')}, voice ${env('OPENAI_TTS_VOICE', 'marin')}) ...`);

const results: Result[] = [];
for (const s of sentences) {
  const t0 = Date.now();
  try {
    const audio = await tts.synthesize(s.text, ttsLang[s.lang]);
    const heard = await stt.transcribe(audio, 'audio/mpeg', sttLang[s.lang]);
    results.push({ s, heard, wer: wer(s.expected, heard), cer: cer(s.expected, heard), ms: Date.now() - t0 });
  } catch (e) {
    results.push({ s, heard: '', wer: 1, cer: 1, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
  }
  const r = results[results.length - 1]!;
  console.log(`${r.s.id}  WER ${(r.wer * 100).toFixed(0)}%${r.error ? `  ERROR ${r.error}` : ''}`);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ok = results.filter((r) => !r.error);
const langs: FixtureLang[] = ['bn', 'banglish', 'mixed', 'en'];
const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const worst = [...ok].sort((a, b) => b.wer - a.wer).slice(0, 10);

const md = [
  '# Voice quality report (TTS -> STT round trip)',
  '',
  `Generated ${new Date().toISOString()} by \`backend/scripts/stt-tts-check.ts\`. Models: TTS \`${env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts')}\` (voice \`${env('OPENAI_TTS_VOICE', 'marin')}\`), STT \`${env('OPENAI_STT_MODEL', 'gpt-transcribe')}\`.`,
  '',
  '> Draft. The fixture sentences and expected transcripts are unreviewed; a native Bangla speaker must confirm them, and listen to a sample of the audio, before these numbers are quoted. A round trip measures only how well the recogniser understands the synthetic voice: it does NOT measure how a real person with an accent, noise or a bad microphone is understood.',
  '',
  '## Summary',
  '',
  '| Language | Sentences | Failed calls | Mean WER | Mean CER |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...langs.map((l) => { const all = results.filter((r) => r.s.lang === l), good = all.filter((r) => !r.error); return `| ${l} | ${all.length} | ${all.length - good.length} | ${pct(avg(good.map((r) => r.wer)))} | ${pct(avg(good.map((r) => r.cer)))} |`; }),
  `| all | ${results.length} | ${results.length - ok.length} | ${pct(avg(ok.map((r) => r.wer)))} | ${pct(avg(ok.map((r) => r.cer)))} |`,
  '',
  `Mean latency per round trip: ${Math.round(avg(ok.map((r) => r.ms)))} ms.`,
  '',
  '## Worst 10 by WER',
  '',
  '| id | WER | expected | heard |',
  '| --- | ---: | --- | --- |',
  ...worst.map((r) => `| ${r.s.id} | ${pct(r.wer)} | ${cell(r.s.expected)} | ${cell(r.heard)} |`),
  '',
  '## All sentences',
  '',
  '| id | lang | WER | CER | heard |',
  '| --- | --- | ---: | ---: | --- |',
  ...results.map((r) => `| ${r.s.id} | ${r.s.lang} | ${pct(r.wer)} | ${pct(r.cer)} | ${r.error ? `ERROR: ${cell(r.error)}` : cell(r.heard)} |`),
  '',
  '## Reading the numbers',
  '',
  '- WER is word-level edit distance over normalised text (lowercase, punctuation and zero-width characters removed, Bangla digits to ASCII).',
  '- Banglish rows speak Latin-letter Bangla and expect Bangla script back, so spelling differences (e.g. a different but valid Bangla spelling) count as errors: treat them as an upper bound.',
  '- A WER above roughly 15% on plain Bangla sentences deserves a listen before any code change; compare against the previous report, not against a fixed target.',
  '',
].join('\n');
writeFileSync(REPORT, md, 'utf8');
console.log(`\nWrote ${REPORT}`);
