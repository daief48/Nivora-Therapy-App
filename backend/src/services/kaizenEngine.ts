import { addDays, daysBetween, mondayOf } from '../utils/dates.js';

export const KAIZEN_CATEGORIES = [
  'BREATHING', 'REFLECTION', 'JOURNALING', 'GROUNDING', 'MEDITATION', 'SLEEP_ROUTINE', 'SHORT_WALK',
  'DIGITAL_BREAK', 'PLANNING', 'GRATITUDE', 'SOCIAL', 'RELAXATION', 'SELF_OBSERVATION',
] as const;
export type KaizenCategory = (typeof KAIZEN_CATEGORIES)[number];
export type Lang = 'en' | 'bn';

interface Template {
  unit: 'minutes' | 'breaths'; start: number; max: number; micro: number;
  en: { title: string; desc: string }; bn: { title: string; desc: string };
}

// {n} is the current target and {u} its unit. Titles stay small, concrete and kind.
export const TEMPLATES: Record<KaizenCategory, Template> = {
  BREATHING: { unit: 'minutes', start: 2, max: 10, micro: 3,
    en: { title: 'Breathe slowly for {n} {u}', desc: 'Breathe in for 4, out for 6. Let your shoulders drop.' },
    bn: { title: '{n} {u} ধীরে শ্বাস নিন', desc: '৪ গুনে শ্বাস নিন, ৬ গুনে ছাড়ুন। কাঁধ শিথিল রাখুন।' } },
  REFLECTION: { unit: 'minutes', start: 2, max: 10, micro: 1,
    en: { title: 'Pause and reflect for {n} {u}', desc: 'Ask yourself: what do I need most right now?' },
    bn: { title: '{n} {u} থেমে নিজের কথা ভাবুন', desc: 'নিজেকে জিজ্ঞেস করুন: এই মুহূর্তে আমার সবচেয়ে বেশি কী দরকার?' } },
  JOURNALING: { unit: 'minutes', start: 2, max: 10, micro: 1,
    en: { title: 'Write what is on your mind for {n} {u}', desc: 'No rules. A few honest lines are enough.' },
    bn: { title: '{n} {u} মনের কথা লিখুন', desc: 'কোনো নিয়ম নেই। কয়েকটি সৎ লাইনই যথেষ্ট।' } },
  GROUNDING: { unit: 'minutes', start: 2, max: 8, micro: 1,
    en: { title: 'Ground yourself for {n} {u}', desc: 'Name 3 things you see, 2 you hear, 1 you feel.' },
    bn: { title: '{n} {u} নিজেকে বর্তমানে ফিরিয়ে আনুন', desc: '৩টি দেখা, ২টি শোনা ও ১টি অনুভূতির জিনিসের নাম বলুন।' } },
  MEDITATION: { unit: 'minutes', start: 2, max: 12, micro: 1,
    en: { title: 'Sit quietly for {n} {u}', desc: 'Notice your breath. When your mind wanders, gently return.' },
    bn: { title: '{n} {u} শান্ত হয়ে বসুন', desc: 'শ্বাসের দিকে মন দিন। মন সরে গেলে আলতো করে ফিরিয়ে আনুন।' } },
  SLEEP_ROUTINE: { unit: 'minutes', start: 5, max: 20, micro: 2,
    en: { title: 'Wind down for {n} {u} before bed', desc: 'Dim the lights and put the phone away.' },
    bn: { title: 'ঘুমের আগে {n} {u} নিজেকে শান্ত করুন', desc: 'আলো কমান এবং ফোন সরিয়ে রাখুন।' } },
  SHORT_WALK: { unit: 'minutes', start: 3, max: 20, micro: 1,
    en: { title: 'Take a gentle walk for {n} {u}', desc: 'Slow steps, no destination, no phone.' },
    bn: { title: '{n} {u} হালকা হাঁটুন', desc: 'ধীরে হাঁটুন, ফোন ছাড়া।' } },
  DIGITAL_BREAK: { unit: 'minutes', start: 5, max: 30, micro: 2,
    en: { title: 'Take a screen break for {n} {u}', desc: 'Look out of a window or stretch.' },
    bn: { title: '{n} {u} স্ক্রিন থেকে বিরতি নিন', desc: 'জানালার বাইরে তাকান বা শরীর স্ট্রেচ করুন।' } },
  PLANNING: { unit: 'minutes', start: 2, max: 10, micro: 1,
    en: { title: 'Write your most important task in {n} {u}', desc: 'Just one task. Make it small enough to start.' },
    bn: { title: '{n} {u} আজকের সবচেয়ে গুরুত্বপূর্ণ কাজ লিখুন', desc: 'মাত্র একটি কাজ। শুরু করা যায় এমন ছোট করে লিখুন।' } },
  GRATITUDE: { unit: 'minutes', start: 2, max: 8, micro: 1,
    en: { title: 'Notice what went well for {n} {u}', desc: 'Think of one small thing you are thankful for today.' },
    bn: { title: '{n} {u} ভালো লাগা বিষয়গুলো ভাবুন', desc: 'আজকের একটি ছোট কৃতজ্ঞতার বিষয় মনে করুন।' } },
  SOCIAL: { unit: 'minutes', start: 3, max: 15, micro: 1,
    en: { title: 'Reach out to someone for {n} {u}', desc: 'A short message to someone you trust is enough.' },
    bn: { title: '{n} {u} কারও সঙ্গে যোগাযোগ করুন', desc: 'বিশ্বস্ত কাউকে ছোট একটি বার্তাই যথেষ্ট।' } },
  RELAXATION: { unit: 'minutes', start: 3, max: 15, micro: 1,
    en: { title: 'Relax your body for {n} {u}', desc: 'Tense and release each muscle group, from toes up.' },
    bn: { title: '{n} {u} শরীর শিথিল করুন', desc: 'পায়ের পাতা থেকে উপরের দিকে পেশি শক্ত করে ছেড়ে দিন।' } },
  SELF_OBSERVATION: { unit: 'minutes', start: 2, max: 8, micro: 1,
    en: { title: 'Notice how you feel for {n} {u}', desc: 'Just observe your body and mood without judging.' },
    bn: { title: '{n} {u} নিজের অনুভূতি লক্ষ্য করুন', desc: 'বিচার না করে শরীর ও মনের অবস্থা শুধু লক্ষ্য করুন।' } },
};

export const unitLabel = (unit: string, n: number, lang: Lang) =>
  lang === 'bn' ? (unit === 'breaths' ? 'বার শ্বাস' : 'মিনিট') : unit === 'breaths' ? (n === 1 ? 'breath' : 'breaths') : n === 1 ? 'minute' : 'minutes';

export interface HistoryItem {
  date: string; status: string; targetValue: number; micro: boolean; difficultyFeedback: string | null; nextPreference: string | null;
  /** The planned size before a short-night shrink (adaptedBy SLEEP_LOW). Planning continues from this, so a short night never lowers the goal. */
  baseTarget?: number | null;
}
export interface Plan { target: number; unit: 'minutes' | 'breaths'; micro: boolean; difficulty: number; reason: string; rampPhase?: RampPhase }

// ---- time ramp (all times are the user's own choices; the engine never picks a time by itself) ----

/** The user's ramp: start = comfortable starting amount, max = ceiling the target never exceeds. */
export interface RampConfig { start: number; max: number }
export type RampPhase = 'RISING' | 'HOLDING' | 'REDUCED' | 'MAINTENANCE';
/** How much a good week raises the target (10 -> 15 -> 20 ... toward the ceiling). */
export const RAMP_STEP = 5;

export interface WeekStats { planned: number; done: number; partial: number; skipped: number; overwhelmed: number; hard: number }

/** Stats of the history entries whose date is in [from, to] (inclusive, YYYY-MM-DD). */
export function weekStatsOf(history: HistoryItem[], from: string, to: string): WeekStats {
  const rows = history.filter((h) => h.date >= from && h.date <= to);
  const s: WeekStats = { planned: rows.length, done: 0, partial: 0, skipped: 0, overwhelmed: 0, hard: 0 };
  for (const h of rows) {
    if (h.status === 'DONE') s.done++;
    else if (h.status === 'PARTIAL') s.partial++;
    else if (h.status === 'SKIPPED') s.skipped++;
    if (h.difficultyFeedback === 'OVERWHELMED') s.overwhelmed++;
    else if (h.difficultyFeedback === 'HARD') s.hard++;
  }
  return s;
}

/**
 * The weekly ramp decision, applied once at the start of a new week (deterministic; unit-tested).
 * - the last week went well (>= 70% done, no OVERWHELMED, at most 1 skip) -> rise by RAMP_STEP toward the ceiling
 * - HARD/OVERWHELMED or repeated skips -> shrink (same 0.6 factor as an overwhelmed day), or a fresh start at the user's start amount if it fell below it
 * - anything mixed -> hold
 * - once the ceiling is reached, stay there (MAINTENANCE); the target never exceeds the ceiling
 */
export function rampWeekDecision(level: number, ramp: RampConfig, prev: WeekStats): { target: number; phase: RampPhase } {
  const ceiling = Math.max(1, ramp.max);
  if (level >= ceiling) return { target: ceiling, phase: 'MAINTENANCE' };
  const attempted = prev.done + prev.partial + prev.skipped;
  const doneRatio = attempted ? (prev.done + prev.partial) / attempted : 0;
  if (prev.overwhelmed > 0 || prev.skipped >= 2 || doneRatio < 0.4) {
    const shrunk = Math.round(level * 0.6);
    return { target: clamp(Math.max(shrunk, Math.min(ramp.start, ceiling)), 1, ceiling), phase: 'REDUCED' };
  }
  if (attempted > 0 && doneRatio >= 0.7 && prev.skipped <= 1) return { target: clamp(level + RAMP_STEP, 1, ceiling), phase: 'RISING' };
  return { target: clamp(level, 1, ceiling), phase: 'HOLDING' };
}

/** The plain-language plan ladder shown at setup: 10 -> 15 -> 20 -> ... -> the ceiling (never beyond it). */
export function planRampPreview(start: number, max: number, step = RAMP_STEP): number[] {
  const out = [clamp(start, 1, Math.max(1, max))];
  for (let v = start + step; v < max; v += step) out.push(v);
  if (max > out[out.length - 1]!) out.push(max);
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Smallest useful action for today.
 * `currentTarget` is the size the user is working up to; `history` is every earlier action of this goal, newest first.
 * Misses never punish: after a gap the plan shrinks to a tiny restart.
 * With `ramp` (the user's own start / ceiling), the FIRST step of a new week applies the weekly ramp decision
 * (rampWeekDecision) to the previous week; days inside a week keep the daily ±1 logic, always clamped to the ceiling.
 */
export function planNext(category: KaizenCategory, currentTarget: number, history: HistoryItem[], today: string, ramp?: RampConfig): Plan {
  const tpl = TEMPLATES[category];
  const done = (h: HistoryItem) => h.status === 'DONE' || h.status === 'PARTIAL';
  const resolved = history.filter((h) => h.date < today);
  const last = resolved[0];
  const lastDone = resolved.find(done);
  const microUnit: 'minutes' | 'breaths' = category === 'BREATHING' ? 'breaths' : tpl.unit;
  const microTarget = category === 'BREATHING' ? 3 : tpl.micro;
  const base = (h: HistoryItem) => h.baseTarget ?? h.targetValue;
  // The engine's own category maximum still applies on top of the user's ceiling.
  const ceiling = ramp ? Math.min(ramp.max, tpl.max) : tpl.max;
  const mk = (target: number, micro: boolean, reason: string, rampPhase?: RampPhase): Plan => {
    const unit = micro ? microUnit : tpl.unit;
    return { target: micro ? target : clamp(target, 1, ceiling), unit, micro, difficulty: clamp(Math.round((target / tpl.max) * 5) || 1, 1, 5), reason, ...(rampPhase ? { rampPhase } : {}) };
  };

  if (!last) return ramp ? mk(clamp(ramp.start, 1, ceiling), false, 'ramp_start', 'HOLDING') : mk(currentTarget, false, 'first');

  // Weekly ramp boundary: no action of this goal yet this week -> the week's base comes from the ramp decision on last week.
  if (ramp) {
    const weekStart = mondayOf(today);
    const thisWeek = resolved.filter((h) => h.date >= weekStart);
    if (!thisWeek.length) {
      const prevWeekStats = weekStatsOf(resolved, addDays(weekStart, -7), addDays(weekStart, -1));
      const prevRows = resolved.filter((h) => h.date >= addDays(weekStart, -7) && h.date < weekStart);
      const prevLevel = prevRows.length ? Math.max(...prevRows.map(base)) : currentTarget;
      const decision = rampWeekDecision(prevLevel, { start: clamp(ramp.start, 1, ceiling), max: ceiling }, prevWeekStats);
      return mk(decision.target, false, `ramp_${decision.phase.toLowerCase()}`, decision.phase);
    }
  }

  const recentSkips = resolved.slice(0, 2).filter((h) => h.status === 'SKIPPED').length;
  const gap = lastDone ? daysBetween(lastDone.date, today) : daysBetween(resolved[resolved.length - 1]!.date, today);
  if (recentSkips >= 2 || gap >= 3) return mk(microTarget, true, 'restart');
  if (last.micro && done(last)) return mk(clamp(Math.round(currentTarget * 0.7), ramp ? 1 : tpl.start, ceiling), false, 'after_restart');

  let target = last.micro ? currentTarget : base(last);
  let reason = 'same';
  if (last.status === 'SKIPPED') { target = clamp(Math.round(target * 0.6), 1, ceiling); reason = 'easier'; }
  else if (last.status === 'PARTIAL') { target = clamp(Math.round(target * 0.7), 1, ceiling); reason = 'easier'; }
  else if (last.difficultyFeedback === 'OVERWHELMED') { target = clamp(Math.floor(target * 0.6), 1, ceiling); reason = 'easier'; }
  else if (last.difficultyFeedback === 'EASY') { target = clamp(target + 1, 1, ceiling); reason = 'harder'; }
  // The user's own wish after reflecting always wins.
  if (last.nextPreference === 'EASIER') { target = clamp(target - 1, 1, ceiling); reason = 'easier'; }
  else if (last.nextPreference === 'HARDER') { target = clamp(target + 1, 1, ceiling); reason = 'harder'; }
  else if (last.nextPreference === 'SAME') { target = base(last); reason = 'same'; }
  const maintenance = ramp && (base(last) >= ceiling || currentTarget >= ceiling) ? 'MAINTENANCE' as RampPhase : undefined;
  return mk(target, false, reason, maintenance);
}

export function buildAction(category: KaizenCategory, plan: Plan, lang: Lang) {
  const tpl = TEMPLATES[category][lang];
  const u = unitLabel(plan.unit, plan.target, lang);
  return {
    title: tpl.title.replace('{n}', String(plan.target)).replace('{u}', u),
    description: plan.micro
      ? (lang === 'bn' ? 'কোনো চাপ নেই। আজ শুধু একটি ছোট শুরু। ' : 'No pressure. Just a tiny restart today. ') + tpl.desc
      : tpl.desc,
  };
}

export const STAGES = ['SEED', 'GROWING', 'GROWING_STRONG', 'FLOURISHING'] as const;
export function growthStage(completed: number): (typeof STAGES)[number] {
  return completed < 3 ? 'SEED' : completed < 10 ? 'GROWING' : completed < 25 ? 'GROWING_STRONG' : 'FLOURISHING';
}

const MESSAGES = {
  FULL: { en: 'You did it. This small step matters. 🌱', bn: 'আপনি করেছেন। এই ছোট পদক্ষেপটিও গুরুত্বপূর্ণ। 🌱', hi: 'यह हो गया। यह छोटा क़दम भी मायने रखता है। 🌱', ne: 'यो भयो। यो सानो कदम पनि महत्त्वपूर्ण छ। 🌱' },
  PARTIAL: { en: 'Every bit counts. Tomorrow we can make it a little easier.', bn: 'যতটুকু করেছেন সেটাই যথেষ্ট। কাল আমরা এটি আরও সহজ করব।', hi: 'जितना हुआ, वही काफ़ी है। कल हम इसे थोड़ा और आसान बना सकते हैं।', ne: 'जति भयो त्यति नै पर्याप्त छ। भोलि हामी यसलाई अलि सजिलो बनाउन सक्छौं।' },
  SKIPPED: { en: 'No pressure at all. Rest is part of the journey. Tomorrow we start smaller.', bn: 'কোনো চাপ নেই। বিশ্রামও যাত্রার অংশ। কাল আমরা আরও ছোট করে শুরু করব।', hi: 'कोई दबाव नहीं। आराम भी सफ़र का हिस्सा है। कल हम और छोटे से शुरू करेंगे।', ne: 'कुनै दबाब छैन। आराम पनि यात्राकै हिस्सा हो। भोलि हामी अझ सानोबाट सुरु गर्नेछौं।' },
  RETURN: { en: 'Welcome back. Glad you are here.', bn: 'আবার ফিরে এসেছেন, ভালো লাগল।', hi: 'फिर से मिलकर अच्छा लगा।', ne: 'फेरि भेट भएकोमा खुशी लाग्यो।' },
} as const;
export const kaizenMessage = (kind: keyof typeof MESSAGES, lang: Lang | 'hi' | 'ne') => MESSAGES[kind][lang];

/** The "make it smaller" step (same 0.6 factor planNext uses after a skip or an overwhelmed day). Also used when a short night shrinks today's target. */
export const shrinkTarget = (target: number, max: number, factor = 0.6): number => clamp(Math.round(target * factor), 1, max);
