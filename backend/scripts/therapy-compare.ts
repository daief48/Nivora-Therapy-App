// Before/after comparison of the reply style: LEGACY prompt + utility model (old) vs the full current pipeline over HTTP (new).
// Needs the API running on :4010 and OPENAI_API_KEY in backend/.env. Run: npx tsx scripts/therapy-compare.ts
// Measures, with the same deterministic detectors the style guard uses (see services/styleGuard.ts): definitions, lists, several questions,
// filler openers, advice in the first turns and length. It does not judge warmth; read a few samples as well.
import 'dotenv/config';
import { detectViolations, type StyleViolation } from '../src/services/styleGuard.js';
import { LEGACY_SYSTEM_PROMPT, languageDirective } from '../src/services/systemPrompt.js';

const API = process.env.COMPARE_API ?? 'http://localhost:4010/api/v1';
const KEY = process.env.OPENAI_API_KEY ?? '';
const OLD_MODEL = process.env.COMPARE_OLD_MODEL ?? 'gpt-4o-mini';

interface Case { lang: 'en' | 'bn' | 'hi' | 'ne'; text: string }
const CASES: Case[] = [
  { lang: 'en', text: "I don't know why but I feel so anxious all the time lately." },
  { lang: 'en', text: 'My exams start next week and I keep freezing when I try to study.' },
  { lang: 'en', text: 'I feel really lonely since I moved to a new city.' },
  { lang: 'en', text: 'My boss keeps piling work on me and I never say no. I am exhausted.' },
  { lang: 'en', text: "I lost my grandmother last month and I still can't cry." },
  { lang: 'en', text: 'I always feel like I am not good enough compared to everyone else.' },
  { lang: 'en', text: 'My partner and I argued again and I feel so tired of it.' },
  { lang: 'bn', text: 'অফিসে বস প্রতিদিন কাজ চাপায়, আর আমি না বলতে পারি না। খুব ক্লান্ত লাগে।' },
  { lang: 'bn', text: 'পরীক্ষা সামনে, কিন্তু পড়তে বসলেই মাথা ফাঁকা হয়ে যায়।' },
  { lang: 'bn', text: 'নতুন শহরে এসে খুব একা লাগে, কারও সাথে কথা বলতে পারি না।' },
  { lang: 'bn', text: 'আমার দাদু মারা গেছেন, কিন্তু আমি কাঁদতে পারছি না।' },
  { lang: 'bn', text: 'আমি সবসময় মনে করি আমি অন্যদের মতো যথেষ্ট ভালো না।' },
  { lang: 'bn', text: 'বাসায় বিয়ের জন্য খুব চাপ দিচ্ছে, আমার একদমই ইচ্ছে নেই।' },
  { lang: 'bn', text: 'রাতে ঘুম আসে না, শুধু দুশ্চিন্তা ঘোরে মাথায়।' },
  { lang: 'hi', text: 'मुझे आजकल हर समय बहुत घबराहट रहती है, पता नहीं क्यों।' },
  { lang: 'hi', text: 'ऑफिस में बॉस बहुत काम डालता है और मैं मना नहीं कर पाता। बहुत थक गया हूँ।' },
  { lang: 'hi', text: 'नए शहर में आकर बहुत अकेला महसूस करता हूँ।' },
  { lang: 'ne', text: 'मलाई आजकल धेरै चिन्ता लागिरहन्छ, किन हो थाहा छैन।' },
  { lang: 'ne', text: 'परीक्षा नजिकै छ तर पढ्न बस्दा केही सम्झिँदैन।' },
  { lang: 'ne', text: 'मलाई नयाँ ठाउँमा आएर निकै एक्लो लाग्छ।' },
];

const j = (h: Record<string, string>, body?: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined });

async function oldReply(c: Case): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', j({ Authorization: `Bearer ${KEY}` }, {
    model: OLD_MODEL, max_tokens: 600, temperature: 0.7,
    messages: [{ role: 'system', content: `${LEGACY_SYSTEM_PROMPT}\n\n${languageDirective(c.lang)}` }, { role: 'user', content: c.text }],
  }));
  return (await r.json() as any).choices?.[0]?.message?.content ?? '';
}

async function newReply(c: Case, H: Record<string, string>): Promise<string> {
  const s = (await (await fetch(`${API}/sessions`, j(H, { sessionType: 'TEXT', language: c.lang }))).json() as any).data;
  const r = await (await fetch(`${API}/sessions/${s.id}/messages`, j(H, { text: c.text }))).json() as any;
  return r.data?.message?.content ?? '';
}

const email = `cmp${Date.now()}@example.com`;
const reg = await (await fetch(`${API}/auth/register`, j({}, { email, password: 'correct-horse-9', displayName: 'Rafi', locale: 'en', countryCode: 'BD', consents: { age18Plus: true, aiDisclosure: true, privacy: true } }))).json() as any;
const H = { Authorization: `Bearer ${reg.data.accessToken}` };

const tally = (rows: { text: string }[]) => {
  const counts: Record<StyleViolation | 'ANY', number> = { DEFINITION: 0, LIST: 0, MULTI_QUESTION: 0, TOO_LONG: 0, FILLER: 0, EARLY_ADVICE: 0, REPEAT: 0, ANY: 0 };
  for (const r of rows) { const v = detectViolations(r.text, { priorUserTurns: 0 }); v.forEach((x) => counts[x]++); if (v.length) counts.ANY++; }
  const chars = Math.round(rows.reduce((s, r) => s + r.text.length, 0) / rows.length);
  return { counts, chars };
};

const oldRows: { c: Case; text: string }[] = [], newRows: { c: Case; text: string }[] = [];
for (const c of CASES) {
  const [o, n] = await Promise.all([oldReply(c), newReply(c, H)]);
  oldRows.push({ c, text: o }); newRows.push({ c, text: n });
}
const a = tally(oldRows), b = tally(newRows);
console.log(`\nCases: ${CASES.length}  | OLD = legacy prompt + ${OLD_MODEL}   NEW = full pipeline (emotion read + new prompt + session model + style guard)\n`);
console.log('violation'.padEnd(16), 'OLD'.padStart(5), 'NEW'.padStart(5));
for (const k of ['ANY', 'DEFINITION', 'LIST', 'MULTI_QUESTION', 'TOO_LONG', 'FILLER'] as const) console.log(k.padEnd(16), String(a.counts[k]).padStart(5), String(b.counts[k]).padStart(5));
console.log('avg reply length'.padEnd(16), String(a.chars).padStart(5), String(b.chars).padStart(5), 'chars');
console.log('\n--- samples (OLD vs NEW) ---');
for (const i of [0, 7, 14, 17]) console.log(`\n[${CASES[i]!.lang}] ${CASES[i]!.text}\n  OLD: ${oldRows[i]!.text.replace(/\n+/g, ' ').slice(0, 260)}\n  NEW: ${newRows[i]!.text.replace(/\n+/g, ' ').slice(0, 260)}`);
