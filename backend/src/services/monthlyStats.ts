/**
 * Monthly pattern statistics, computed WITHOUT any model. The model (see insights/routes.ts) may only phrase the facts built here,
 * and every number it writes is checked against them. Correlations describe what moved together, never what caused what.
 */
export interface DayRow {
  date: string; mood: number | null; stress: number | null; energy: number | null; sleepScore: number | null; sleepHours: number | null;
  kaizenDone: 0 | 1 | null; steps: number | null; activeMin: number | null; // walking + exercise minutes
}

export const MIN_DAYS_LOGGED = 14; // below this the monthly view says {enough:false}
export const MIN_PAIRS = 10; // paired days needed before a correlation is reported
export const MIN_R = 0.3; // weaker relationships are not reported (n >= SMALL_N)
export const SMALL_N = 30; // with fewer paired days a chance pattern is likely: a stricter bar applies
export const MIN_R_SMALL = 0.5;
export const minRFor = (n: number) => (n < SMALL_N ? MIN_R_SMALL : MIN_R);

type Metric = 'mood' | 'stress' | 'energy' | 'sleepScore' | 'kaizenDone' | 'activeMin';
const PAIRS: [Metric, Metric][] = [
  ['stress', 'sleepScore'], ['mood', 'sleepScore'], ['energy', 'sleepScore'], ['mood', 'stress'],
  ['kaizenDone', 'mood'], ['kaizenDone', 'stress'], ['activeMin', 'mood'], ['activeMin', 'stress'], ['activeMin', 'sleepScore'],
];

export const round = (n: number, dp = 1) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null; // no variation, no relationship to describe
  return sxy / Math.sqrt(sxx * syy);
}

export interface Correlation { a: Metric; b: Metric; r: number; n: number; strength: 'moderate' | 'strong'; direction: 'together' | 'opposite' }
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export interface WeekdayStat { weekday: (typeof WEEKDAYS)[number]; mood: number | null; stress: number | null; sleepScore: number | null; days: number }

export interface MonthlyStats {
  enough: boolean;
  periodDays: number;
  daysLogged: number;
  averages: { mood: number | null; stress: number | null; energy: number | null; sleepScore: number | null; sleepHours: number | null; steps: number | null; activeMin: number | null };
  kaizenDone: number;
  series: DayRow[];
  correlations: Correlation[];
  weekdays: WeekdayStat[];
  bestMoodWeekday: WeekdayStat | null;
  lowestMoodWeekday: WeekdayStat | null;
}

export function computeMonthly(rows: DayRow[]): MonthlyStats {
  const logged = rows.filter((r) => r.mood != null || r.stress != null || r.energy != null || r.sleepScore != null);
  const col = (k: keyof DayRow) => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
  const avg = (k: keyof DayRow, dp = 1) => { const m = mean(col(k)); return m == null ? null : round(m, dp); };
  const averages = {
    mood: avg('mood'), stress: avg('stress'), energy: avg('energy'), sleepScore: avg('sleepScore', 0), sleepHours: avg('sleepHours'), steps: avg('steps', 0), activeMin: avg('activeMin', 0),
  };
  const base = { periodDays: rows.length, daysLogged: logged.length, averages, kaizenDone: rows.filter((r) => r.kaizenDone === 1).length, series: rows };
  if (logged.length < MIN_DAYS_LOGGED) {
    return { ...base, enough: false, correlations: [], weekdays: [], bestMoodWeekday: null, lowestMoodWeekday: null };
  }
  const correlations: Correlation[] = [];
  for (const [a, b] of PAIRS) {
    const xs: number[] = [], ys: number[] = [];
    for (const r of rows) { const x = r[a], y = r[b]; if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); } }
    if (xs.length < MIN_PAIRS) continue;
    const r = pearson(xs, ys);
    if (r == null || Math.abs(r) < minRFor(xs.length)) continue;
    correlations.push({ a, b, r: round(r, 2), n: xs.length, strength: Math.abs(r) >= 0.6 ? 'strong' : 'moderate', direction: r > 0 ? 'together' : 'opposite' });
  }
  correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const weekdays: WeekdayStat[] = WEEKDAYS.map((weekday, dow) => {
    const rs = rows.filter((r) => new Date(`${r.date}T00:00:00Z`).getUTCDay() === dow);
    const m = (k: 'mood' | 'stress' | 'sleepScore') => { const v = rs.map((r) => r[k]).filter((x): x is number => x != null); return v.length >= 2 ? round(mean(v)!, 1) : null; };
    return { weekday, mood: m('mood'), stress: m('stress'), sleepScore: m('sleepScore'), days: rs.filter((r) => r.mood != null || r.sleepScore != null).length };
  });
  const withMood = weekdays.filter((w) => w.mood != null);
  // A weekday pattern is only worth mentioning when the gap is visible (1 point or more).
  const hi = withMood.reduce<WeekdayStat | null>((b, w) => (!b || w.mood! > b.mood! ? w : b), null);
  const lo = withMood.reduce<WeekdayStat | null>((b, w) => (!b || w.mood! < b.mood! ? w : b), null);
  const gap = hi && lo ? hi.mood! - lo.mood! : 0;
  return { ...base, enough: true, correlations, weekdays, bestMoodWeekday: gap >= 1 ? hi : null, lowestMoodWeekday: gap >= 1 ? lo : null };
}

const LABEL: Record<Metric, string> = { mood: 'mood', stress: 'stress', energy: 'energy', sleepScore: 'sleep score', kaizenDone: 'days with a completed small step', activeMin: 'minutes of walking or exercise' };

/** The only facts the model sees. One plain English line each; numbers here are the only numbers the output may contain. */
export function factsFor(s: MonthlyStats): string[] {
  const f: string[] = [`Days with entries: ${s.daysLogged} of the last ${s.periodDays}.`];
  const a = s.averages;
  if (a.mood != null) f.push(`Average mood: ${a.mood} out of 10.`);
  if (a.stress != null) f.push(`Average stress: ${a.stress} out of 10.`);
  if (a.energy != null) f.push(`Average energy: ${a.energy} out of 10.`);
  if (a.sleepScore != null) f.push(`Average sleep score: ${a.sleepScore} out of 100.`);
  if (a.sleepHours != null) f.push(`Average sleep: ${a.sleepHours} hours.`);
  f.push(`Small steps completed: ${s.kaizenDone}.`);
  for (const c of s.correlations.slice(0, 3)) {
    f.push(c.direction === 'together'
      ? `${LABEL[c.a]} and ${LABEL[c.b]} tended to go up and down together (${c.strength}, based on ${c.n} days).`
      : `When ${LABEL[c.a]} was higher, ${LABEL[c.b]} tended to be lower (${c.strength}, based on ${c.n} days).`);
  }
  if (s.bestMoodWeekday && s.lowestMoodWeekday) f.push(`Mood was highest on ${s.bestMoodWeekday.weekday}s (${s.bestMoodWeekday.mood}) and lowest on ${s.lowestMoodWeekday.weekday}s (${s.lowestMoodWeekday.mood}).`);
  return f;
}

const DIGITS: Record<string, string> = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9', '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
/** All numbers in a text, with Bangla/Devanagari digits normalised and a trailing ".0" ignored (7.0 === 7). */
export function numbersIn(text: string): string[] {
  const t = text.replace(/[०-९০-৯]/g, (c) => DIGITS[c] ?? c);
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}
/** True when every number in the model's output also appears in the computed facts. */
export function numbersMatch(output: string, facts: string[]): boolean {
  const allowed = new Set(facts.flatMap(numbersIn));
  return numbersIn(output).every((n) => allowed.has(n));
}

export function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}
