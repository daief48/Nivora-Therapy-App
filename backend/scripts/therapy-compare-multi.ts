// Multi-turn version of therapy-compare.ts: 5-turn conversations, replies judged in the middle of the conversation too.
import 'dotenv/config';
import { detectViolations } from '../src/services/styleGuard.js';
import { LEGACY_SYSTEM_PROMPT, languageDirective } from '../src/services/systemPrompt.js';
const API = 'http://localhost:4010/api/v1', KEY = process.env.OPENAI_API_KEY ?? '';
const j = (h: Record<string, string>, body?: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined });
const CONVOS: { lang: 'en' | 'bn'; turns: string[] }[] = [
  { lang: 'en', turns: ['I have been feeling really on edge lately.', 'I think it is work. There is so much pressure and I can never switch off.', 'Why does my body feel like this? My chest gets tight.', 'What is anxiety actually? Is that what I have?', 'I just want to feel normal again.'] },
  { lang: 'en', turns: ['I do not really know how to talk about this.', 'My dad was just diagnosed with something serious.', 'I keep thinking about what if I lose him.', 'Is it normal to feel this scared? Explain what is happening to me.', 'Okay. I am just tired of being strong for everyone.'] },
  { lang: 'bn', turns: ['আজকাল মনটা খুব খারাপ থাকে।', 'আসলে চাকরিটা নিয়ে খুব দুশ্চিন্তা, মনে হয় আমি কিছুই ঠিকমতো পারি না।', 'আমার কি ডিপ্রেশন হয়েছে? ডিপ্রেশন আসলে কী?', 'কেন আমার এমন হয়? কারণটা বুঝিয়ে বলো।', 'বাসায় কাউকে বলতেও পারি না।'] },
  { lang: 'bn', turns: ['পরীক্ষার আগে আমার খুব ভয় লাগে।', 'হাত কাঁপে, বুক ধড়ফড় করে।', 'এটাকে কী বলে? এটা কি কোনো রোগ?', 'আমি কী করব বলো তো।', 'সবাই আমার কাছে অনেক আশা করে।'] },
];
const oldChat = async (lang: 'en' | 'bn', turns: string[]) => {
  const msgs: any[] = [{ role: 'system', content: `${LEGACY_SYSTEM_PROMPT}\n\n${languageDirective(lang)}` }]; const out: string[] = [];
  for (const t of turns) { msgs.push({ role: 'user', content: t }); const r = await (await fetch('https://api.openai.com/v1/chat/completions', j({ Authorization: `Bearer ${KEY}` }, { model: 'gpt-4o-mini', max_tokens: 600, temperature: 0.7, messages: msgs }))).json() as any; const a = r.choices?.[0]?.message?.content ?? ''; msgs.push({ role: 'assistant', content: a }); out.push(a); }
  return out;
};
const reg = await (await fetch(`${API}/auth/register`, j({}, { email: `m${Date.now()}@example.com`, password: 'correct-horse-9', displayName: 'Rafi', locale: 'en', countryCode: 'BD', consents: { age18Plus: true, aiDisclosure: true, privacy: true } }))).json() as any;
const H = { Authorization: `Bearer ${reg.data.accessToken}` };
const newChat = async (lang: 'en' | 'bn', turns: string[]) => {
  const s = (await (await fetch(`${API}/sessions`, j(H, { sessionType: 'TEXT', language: lang }))).json() as any).data; const out: string[] = [];
  for (const t of turns) { const r = await (await fetch(`${API}/sessions/${s.id}/messages`, j(H, { text: t }))).json() as any; out.push(r.data?.message?.content ?? ''); }
  return out;
};
let oldBad = 0, newBad = 0, total = 0, oldDef = 0, newDef = 0, oldQ = 0, newQ = 0;
for (const c of CONVOS) {
  const [o, n] = await Promise.all([oldChat(c.lang, c.turns), newChat(c.lang, c.turns)]);
  o.forEach((x, i) => { const v = detectViolations(x, { priorUserTurns: i }); total++; if (v.length) oldBad++; if (v.includes('DEFINITION')) oldDef++; if (v.includes('MULTI_QUESTION')) oldQ++; });
  n.forEach((x, i) => { const v = detectViolations(x, { priorUserTurns: i }); if (v.length) newBad++; if (v.includes('DEFINITION')) newDef++; if (v.includes('MULTI_QUESTION')) newQ++; });
  console.log(`\n[${c.lang}] turn 4 (${c.turns[3]})\n  OLD: ${o[3]!.replace(/\n+/g, ' ').slice(0, 300)}\n  NEW: ${n[3]!.replace(/\n+/g, ' ').slice(0, 300)}`);
}
console.log(`\nReplies judged: ${total} per side (mid-conversation turns included, with direct 'what is X?' questions)`);
console.log(`Replies with ANY style problem  OLD ${oldBad}  NEW ${newBad}`);
console.log(`  definitions                    OLD ${oldDef}  NEW ${newDef}`);
console.log(`  several questions              OLD ${oldQ}  NEW ${newQ}`);
