/** Weekly report: rule-based, built only from the user's own self-reported data. Never a diagnosis, never a comparison with others. */
export const CHECKIN_TAGS = ['work', 'study', 'family', 'relationship', 'friends', 'health', 'sleep', 'money', 'loneliness', 'other', 'good-news', 'rest', 'exercise', 'nature'] as const;
export type Lang = 'en' | 'bn';

export const parseTags = (s: string | null | undefined): string[] => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

export const MIN_TAG_N = 3;

type Row = { mood: number; stress: number; energy: number; tags: string };

/** Per-tag averages when the tag was present vs overall. Tags with fewer than MIN_TAG_N check-ins are left out. */
export function tagStats(rows: Row[]) {
  const overall = { mood: avg(rows.map((r) => r.mood)), stress: avg(rows.map((r) => r.stress)), energy: avg(rows.map((r) => r.energy)) };
  const out = CHECKIN_TAGS.map((tag) => {
    const with_ = rows.filter((r) => parseTags(r.tags).includes(tag));
    return { tag, n: with_.length, mood: avg(with_.map((r) => r.mood)), stress: avg(with_.map((r) => r.stress)), energy: avg(with_.map((r) => r.energy)) };
  }).filter((x) => x.n >= MIN_TAG_N).sort((a, b) => b.n - a.n);
  return { overall, totalCheckIns: rows.length, minSamples: MIN_TAG_N, tags: out };
}

export const DISCLAIMER = {
  en: 'This is self-reported wellness data, not a diagnosis. It reflects only what you entered and is not a substitute for professional care.',
  bn: 'এটি আপনার নিজের দেওয়া ওয়েলনেস তথ্য, কোনো রোগ নির্ণয় নয়। এটি শুধু আপনার লেখা তথ্য দেখায় এবং পেশাদার সেবার বিকল্প নয়।',
};

type Day = { date: string; checkIns: number; mood: number | null; stress: number | null; energy: number | null; sleepScore: number | null; sleepHours: number | null; kaizen: string | null };

export function buildReport(o: { lang: Lang; days: number; cur: Day[]; prev: Day[]; checkins: Row[]; bedtimeSpreadMin: number | null }) {
  const { lang, cur, prev } = o;
  const bn = lang === 'bn';
  const col = (rows: Day[], k: 'mood' | 'stress' | 'energy' | 'sleepScore' | 'sleepHours') => avg(rows.map((x) => x[k]).filter((v): v is number => v != null));
  const metric = (k: 'mood' | 'stress' | 'energy') => ({ avg: col(cur, k), previous: col(prev, k), change: diff(col(cur, k), col(prev, k)) });
  const mood = metric('mood'), stress = metric('stress'), energy = metric('energy');
  const nights = cur.filter((x) => x.sleepScore != null).length;
  const sleep = { nights, avgScore: col(cur, 'sleepScore'), avgHours: col(cur, 'sleepHours'), change: diff(col(cur, 'sleepScore'), col(prev, 'sleepScore')), bedtimeSpreadMin: o.bedtimeSpreadMin };
  const done = cur.filter((x) => x.kaizen === 'DONE' || x.kaizen === 'PARTIAL').length;
  const kaizen = { doneDays: done, totalDays: cur.length, previousDoneDays: prev.filter((x) => x.kaizen === 'DONE' || x.kaizen === 'PARTIAL').length };
  const stats = tagStats(o.checkins);
  const topTags = stats.tags.slice(0, 3);
  const checkInCount = cur.reduce((s, x) => s + x.checkIns, 0);

  const obs: string[] = [];
  if (checkInCount < 2 && nights < 2) {
    obs.push(bn ? 'এই সময়ে তথ্য কম, তাই প্যাটার্ন বলা কঠিন। কয়েকদিন check-in করলে আরও পরিষ্কার ছবি পাবেন।' : 'There is little data in this period, so patterns are hard to see. A few more check-ins will give a clearer picture.');
  } else {
    if (mood.change != null && mood.change >= 0.5) obs.push(bn ? `আপনার মেজাজের গড় আগের সময়ের চেয়ে একটু বেড়েছে (${mood.change > 0 ? '+' : ''}${mood.change}).` : `Your mood average rose a little compared with the previous period (+${mood.change}).`);
    else if (mood.change != null && mood.change <= -0.5) obs.push(bn ? 'এই সময়ে মেজাজ আগের চেয়ে কিছুটা কম ছিল। কঠিন সময় আসে-যায়, নিজের প্রতি নরম থাকুন।' : 'Mood was a bit lower than the previous period. Hard stretches come and go; be gentle with yourself.');
    if (stress.change != null && stress.change <= -0.5) obs.push(bn ? 'স্ট্রেসের গড় আগের চেয়ে কমেছে, এটা লক্ষ করার মতো।' : 'Your stress average came down compared with before, which is worth noticing.');
    else if (stress.change != null && stress.change >= 0.5) obs.push(bn ? 'স্ট্রেস আগের চেয়ে কিছুটা বেশি ছিল। ছোট একটা বিরতি বা শ্বাসের অনুশীলন সাহায্য করতে পারে।' : 'Stress was a little higher than before. A short pause or breathing practice might help.');
    if (sleep.avgScore != null && sleep.avgScore >= 75) obs.push(bn ? 'এই সময়ে আপনার ঘুমের স্কোর ভালোই ছিল।' : 'Your sleep scores were fairly good in this period.');
    else if (sleep.avgScore != null && sleep.avgScore < 55) obs.push(bn ? 'ঘুমের স্কোর কিছুটা কম ছিল। রাতের wind-down রুটিন একটি ছোট শুরু হতে পারে।' : 'Sleep scores were on the lower side. A small wind-down routine could be a gentle start.');
    if (sleep.bedtimeSpreadMin != null && sleep.bedtimeSpreadMin > 90) obs.push(bn ? 'শোয়ার সময় দিনভেদে বেশ আলাদা ছিল; একটু কাছাকাছি সময় ঘুমকে সাহায্য করতে পারে।' : 'Bedtimes varied quite a bit from night to night; more similar times may support sleep.');
    if (done >= 3) obs.push(bn ? `আপনি ${done} দিন ছোট Kaizen পদক্ষেপ করেছেন। ধারাবাহিকতাই আসল।` : `You took a small Kaizen step on ${done} days. Steady beats perfect.`);
    const best = stats.tags.filter((x) => x.mood != null && stats.overall.mood != null && x.mood - stats.overall.mood >= 0.5).sort((a, b) => b.mood! - a.mood!)[0];
    if (best) obs.push(bn ? `"${best.tag}" উল্লেখ করা দিনগুলোতে আপনার মেজাজ সাধারণের চেয়ে একটু ভালো ছিল (${best.n}টি check-in)।` : `On check-ins where you noted "${best.tag}", your mood was a little higher than usual (${best.n} check-ins).`);
  }

  return {
    range: { from: cur[0]?.date ?? null, to: cur[cur.length - 1]?.date ?? null, days: o.days },
    checkIns: checkInCount, mood, stress, energy, sleep, kaizen,
    topTags: topTags.map((x) => ({ tag: x.tag, n: x.n })),
    observations: obs.slice(0, 5),
    lang,
    disclaimer: DISCLAIMER[lang],
  };
}
