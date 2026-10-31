import type { Db } from '../config/database.js';
import { addDays, lastDays, localClock } from '../utils/dates.js';
import { numbersMatch, sentenceCount } from './monthlyStats.js';
import { outputOk } from './aiOutput.js';
import { copyLang, fill, type CopyLang } from './wellnessCopy.js';

/**
 * "Your week": ONE combined report for Kaizen, sleep and mood. All statistics are computed here without a model; the model (one call, see
 * reports/routes.ts) may only phrase the facts built here, and every number it writes must appear in those facts. Anything else falls back to
 * the template. Self-reported numbers only: never a diagnosis, never a comparison with other people, no improvement claims.
 */
export interface WeekFacts {
  weekStart: string; kaizenDone: number; kaizenTotal: number; restarts: number; hardDays: number;
  sleepNights: number; avgSleepScore: number | null; avgSleepHours: number | null; shortNights: number;
  moodDays: number; avgMood: number | null; avgStress: number | null;
  /** Days of the last 7 that have any entry at all. */
  daysWithData: number;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export async function computeWeekFacts(db: Db, userId: string, tz: string | null | undefined, now = new Date()): Promise<WeekFacts> {
  const today = localClock(tz, now).date;
  const from = addDays(today, -6);
  const [actions, sleeps, checkins] = await Promise.all([
    db.kaizenAction.findMany({ where: { userId, date: { gte: from } } }),
    db.sleepEntry.findMany({ where: { userId, date: { gte: from } } }),
    db.checkIn.findMany({ where: { userId, createdAt: { gte: new Date(now.getTime() - 8 * 86_400_000) } }, select: { mood: true, stress: true, createdAt: true } }),
  ]);
  const inWeek = checkins.filter((c) => localClock(tz, c.createdAt).date >= from);
  const days = new Set<string>([...sleeps.map((s) => s.date), ...inWeek.map((c) => localClock(tz, c.createdAt).date), ...actions.filter((a) => a.status !== 'PLANNED').map((a) => a.date)]);
  const mood = mean(inWeek.map((c) => c.mood)), stress = mean(inWeek.map((c) => c.stress));
  const score = mean(sleeps.map((s) => s.score)), hours = mean(sleeps.map((s) => s.durationMin / 60));
  return {
    weekStart: from, kaizenDone: actions.filter((a) => a.status === 'DONE' || a.status === 'PARTIAL').length, kaizenTotal: actions.length,
    restarts: actions.filter((a) => a.micro).length, hardDays: actions.filter((a) => a.difficultyFeedback === 'HARD' || a.difficultyFeedback === 'OVERWHELMED').length,
    sleepNights: sleeps.length, avgSleepScore: score == null ? null : Math.round(score), avgSleepHours: hours == null ? null : r1(hours), shortNights: sleeps.filter((s) => s.durationMin < 360).length,
    moodDays: new Set(inWeek.map((c) => localClock(tz, c.createdAt).date)).size, avgMood: mood == null ? null : r1(mood), avgStress: stress == null ? null : r1(stress),
    daysWithData: lastDays(today, 7).filter((d) => days.has(d)).length,
  };
}

/** The only facts the model sees; the numbers here are the only numbers its text may contain. */
export function weekFactLines(f: WeekFacts): string[] {
  const l = ['Period: the last 7 days.', `Days with any entry: ${f.daysWithData} of 7.`, `Small steps completed: ${f.kaizenDone} of ${f.kaizenTotal}.`];
  if (f.restarts) l.push(`Gentle restarts (a smaller step after a pause): ${f.restarts}.`);
  if (f.sleepNights) {
    l.push(`Nights of sleep logged: ${f.sleepNights}.`);
    if (f.avgSleepScore != null) l.push(`Average sleep score: ${f.avgSleepScore} out of 100.`);
    if (f.avgSleepHours != null) l.push(`Average sleep: ${f.avgSleepHours} hours.`);
    if (f.shortNights) l.push(`Shorter nights (under 6 hours): ${f.shortNights}.`);
  }
  if (f.moodDays) {
    l.push(`Days with a mood check-in: ${f.moodDays}.`);
    if (f.avgMood != null) l.push(`Average mood: ${f.avgMood} out of 10.`);
    if (f.avgStress != null) l.push(`Average stress: ${f.avgStress} out of 10.`);
  }
  return l;
}

export const WEEK_COPY: Record<CopyLang, { headline: string; kaizen: string; sleep: string; mood: string; days: string; close: string; empty: string }> = {
  en: { headline: 'Here is your week, in your own numbers.', days: 'You had entries on {n} of the last 7 days.', kaizen: 'You completed {n} small steps.', sleep: 'You logged {n} nights, with an average sleep score of {s}.', mood: 'Your average mood was {m} out of 10.', close: 'Keep it gentle, one small step at a time.', empty: 'There is not much to look back on yet, and that is okay. A few check-ins will fill in this page.' },
  bn: { headline: 'আপনার সপ্তাহ, আপনার নিজের সংখ্যায়।', days: 'গত ৭ দিনের মধ্যে {n} দিন আপনার লেখা ছিল।', kaizen: 'আপনি {n}টি ছোট পদক্ষেপ সম্পন্ন করেছেন।', sleep: 'আপনি {n} রাতের ঘুম লিখেছেন, গড় ঘুমের স্কোর {s}।', mood: 'আপনার গড় মনের অবস্থা ১০-এর মধ্যে {m}।', close: 'ধীরে চলুন, একটি করে ছোট পদক্ষেপ।', empty: 'ফিরে দেখার মতো এখনও খুব কিছু নেই, আর সেটাও ঠিক আছে। কয়েকটি check-in এই পাতা ভরিয়ে দেবে।' },
  hi: { headline: 'आपका हफ़्ता, आपके अपने आँकड़ों में।', days: 'पिछले 7 दिनों में से {n} दिन आपकी प्रविष्टियाँ थीं।', kaizen: 'आपने {n} छोटे क़दम पूरे किए।', sleep: 'आपने {n} रातों की नींद दर्ज की, औसत नींद स्कोर {s} रहा।', mood: 'आपका औसत मूड 10 में से {m} रहा।', close: 'धीरे चलिए, एक-एक छोटा क़दम।', empty: 'अभी पीछे मुड़कर देखने को ज़्यादा कुछ नहीं है, और यह ठीक है। कुछ चेक-इन से यह पन्ना भर जाएगा।' },
  ne: { headline: 'तपाईंको हप्ता, तपाईंकै अङ्कमा।', days: 'पछिल्ला 7 दिनमध्ये {n} दिन तपाईंका प्रविष्टि थिए।', kaizen: 'तपाईंले {n} वटा साना कदम पूरा गर्नुभयो।', sleep: 'तपाईंले {n} रातको निद्रा लेख्नुभयो, औसत निद्रा स्कोर {s} रह्यो।', mood: 'तपाईंको औसत मुड 10 मध्ये {m} रह्यो।', close: 'बिस्तारै चल्नुहोस्, एक-एक सानो कदम।', empty: 'फर्केर हेर्न अहिले धेरै केही छैन, र त्यो ठीक छ। केही चेक-इनले यो पाना भर्नेछ।' },
};

/** Template used when the model is not called (no data, risk signals) or its output fails a check. ai:false. */
export function templateWeek(f: WeekFacts, locale?: string | null): { headline: string; text: string } {
  const c = WEEK_COPY[copyLang(locale)];
  if (f.daysWithData < 2) return { headline: c.headline, text: c.empty };
  const parts = [fill(c.days, { n: f.daysWithData }), fill(c.kaizen, { n: f.kaizenDone }), f.sleepNights && f.avgSleepScore != null ? fill(c.sleep, { n: f.sleepNights, s: f.avgSleepScore }) : '', f.avgMood != null ? fill(c.mood, { m: f.avgMood }) : '', c.close];
  return { headline: c.headline, text: parts.filter(Boolean).join(' ') };
}

/** Accepts the model's JSON only when it respects the shape (headline 1-3 sentences, body 4-6), passes the output checks and every number is a known fact. */
export function validateWeekReport(raw: unknown, facts: string[]): { headline: string; text: string } | null {
  const j = raw as { headline?: unknown; text?: unknown } | null;
  const headline = typeof j?.headline === 'string' ? j.headline.trim() : '', text = typeof j?.text === 'string' ? j.text.trim() : '';
  if (!headline || !text) return null;
  const hs = sentenceCount(headline), ts = sentenceCount(text);
  if (hs < 1 || hs > 3 || ts < 4 || ts > 6) return null;
  if (!outputOk(headline, text) || !numbersMatch(`${headline} ${text}`, facts)) return null;
  return { headline, text };
}

export const WEEK_SYSTEM = (lang: string) => `You phrase a person's week for a calm self-care app, from the facts given. Use ONLY the facts. Reply ONLY with JSON: {"headline":"1-3 short sentences","text":"4-6 short, warm sentences"}. Copy any number exactly as written in the facts and add no other numbers, dates or percentages. Cover small steps, sleep and mood where the facts have them. Say things "tended to go together", never that one thing caused another. Never diagnose, never mention medication or supplements, never shame or mention what was missed, never claim improvement or decline, never compare the person with others, do not suggest tasks. Reply in ${lang}.`;
