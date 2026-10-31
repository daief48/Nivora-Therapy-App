import { z } from 'zod';
import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import type { GlmClient } from './glmClient.js';
import { continuityEnabled, savePlan, type PlanContent } from './therapyData.js';

/**
 * Pure phase logic for guided sessions (beginning / middle / end). Nothing here touches the database except
 * maybeBuildPlanFromIntake. Safety always wins: a distressed user is never moved towards wrapping up.
 */
export const PHASES = ['OPENING', 'AGENDA', 'CORE', 'SUMMARY', 'HOMEWORK', 'CLOSING'] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseHint = 'hintOpening' | 'hintAgenda' | 'hintCore' | 'hintSummary' | 'hintHomework' | 'hintClosing';
export const HINT_KEYS: Record<Phase, PhaseHint> = {
  OPENING: 'hintOpening', AGENDA: 'hintAgenda', CORE: 'hintCore', SUMMARY: 'hintSummary', HOMEWORK: 'hintHomework', CLOSING: 'hintClosing',
};
export const LENGTH_OPTIONS = [0, 15, 30, 45] as const;
export const REVIEW_EVERY = 6; // finalized sessions between progress-vs-goals reviews

export interface EngineSession {
  phase: string; lengthMin: number; startedAt: Date; isIntake: boolean; riskFlag: string; moodBefore?: number | null;
  /** Program sittings only (null/undefined for legacy standalone sessions). */
  programId?: string | null; dayNumber?: number | null; plannedMinutes?: number | null;
  /** Active seconds used so far. When provided on a program sitting, phases follow this instead of the wall clock since startedAt. */
  usedSeconds?: number | null;
}
/** Time box in minutes: the sitting's plannedMinutes when set, else the legacy lengthMin (0 = open-ended). */
export const timeBoxOf = (s: Pick<EngineSession, 'lengthMin' | 'plannedMinutes'>): number => (s.plannedMinutes ?? 0) > 0 ? s.plannedMinutes! : s.lengthMin;
/** Intake sitting 1 or 2 of a program; null for legacy intakes and regular sittings. */
export const intakePartOf = (s: Pick<EngineSession, 'isIntake' | 'programId' | 'dayNumber'>): 1 | 2 | null =>
  s.isIntake && s.programId && s.dayNumber === 1 ? 1 : s.isIntake && s.programId && s.dayNumber === 2 ? 2 : null;
export interface StateOpts {
  /** The user's latest message (distress / wrap-up signals only; never stored). */
  lastUserText?: string;
  /** Number of the user's finalized (non-intake) sessions, for the periodic review. */
  finalizedCount?: number;
  /** Recent check-ins show high stress / low mood. */
  highStress?: boolean;
  /** Approach from the treatment plan, used to pick techniques. */
  approach?: PlanContent['approach'];
  /** Pace from the plan. */
  pace?: PlanContent['pace'];
  /** Program context for "Day N of M" wording and the final-sitting review. */
  program?: { dayNumber: number; plannedDays: number };
  /** Program sittings only: the user's local part of day and whole local days since their previous sitting (null = first sitting). */
  rhythm?: { partOfDay: PartOfDay; gapDays: number | null; hasCallback?: boolean };
}

// ---------- time awareness (pure) ----------
export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'late night';
const safeTz = (tz?: string | null): string => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC' }); return tz || 'UTC'; } catch { return 'UTC'; }
};
/** Local wall-clock parts of `d` in the user's timezone (invalid / empty timezone falls back to UTC). */
export function localParts(d: Date, tz?: string | null): { hour: number; weekday: string; dayKey: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), hour: 'numeric', hourCycle: 'h23', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { hour: Number(p.hour) % 24, weekday: p.weekday ?? '', dayKey: `${p.year}-${p.month}-${p.day}` };
}
export const partOfDayOf = (hour: number): PartOfDay => hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late night';
/** Whole LOCAL calendar days between two instants in the user's timezone (0 = same day). */
export function gapInDays(prev: Date, now: Date, tz?: string | null): number {
  const k = (d: Date) => Date.parse(localParts(d, tz).dayKey + 'T00:00:00Z');
  return Math.max(0, Math.round((k(now) - k(prev)) / 86_400_000));
}
/** Plain-English reading of the gap for the model (never a count of streaks). */
export function gapPhrase(gapDays: number | null): string {
  if (gapDays === null) return 'This is their first sitting in this program.';
  if (gapDays === 0) return 'They already sat with you earlier today.';
  if (gapDays === 1) return 'Their previous sitting was yesterday.';
  return `It has been ${gapDays} days since their previous sitting.`;
}
export interface SessionState {
  phase: Phase; elapsedMin: number; remainingMin: number | null; phaseHint: PhaseHint; nextStep: string; distressed: boolean;
}

const DISTRESS = [
  /\b(panic|panicking|hopeless|can'?t cope|can'?t breathe|breaking down|falling apart|overwhelmed|can'?t go on|no way out|worthless|crying)\b/i,
  /(খুব কষ্ট|ভেঙে পড়|সহ্য করতে পারছি না|আর পারছি না|হতাশ|দম বন্ধ)/,
  /(बहुत दुख|सहन नहीं|टूट रहा|टूट रही|हताश|घबराहट|और नहीं हो पाता)/,
  /(धेरै दुख|सहन सकिन|भत्किए|निराश|घबराहट)/,
];
const WRAP_UP = [
  /\b(i have to go|i need to go|gotta go|got to go|that'?s all|that is all|let'?s stop|let'?s wrap up|bye|goodbye|good night)\b/i,
  /(আজ এ পর্যন্তই|এখন যেতে হবে|আজকের মতো যথেষ্ট|বিদায়)/,
  /(अब जाना होगा|आज के लिए बस|चलता हूँ|चलती हूँ|अलविदा)/,
  /(अब जानुपर्छ|आजका लागि यति|बिदा)/,
];
export const isDistressText = (t?: string) => !!t && DISTRESS.some((r) => r.test(t));
export const isWrapUpText = (t?: string) => !!t && WRAP_UP.some((r) => r.test(t));

const idx = (p: string): number => Math.max(0, PHASES.indexOf(p as Phase));

/** Target phase from turns and time alone (before the one-step-at-a-time rule). */
function targetIndex(s: EngineSession, userTurns: number, elapsedMin: number, wrapUp: boolean): number {
  let byTurns: number;
  if (s.isIntake) byTurns = userTurns < 2 ? 0 : userTurns < 4 ? 1 : userTurns < 9 ? 2 : userTurns < 10 ? 3 : userTurns < 11 ? 4 : 5;
  else byTurns = userTurns < 2 ? 0 : userTurns < 3 ? 1 : 2; // open-ended sessions stay in CORE until the user wraps up
  let byTime = 0;
  const box = timeBoxOf(s);
  if (box > 0) {
    const f = elapsedMin / box;
    byTime = f >= 1 ? 5 : f >= 0.92 ? 4 : f >= 0.8 ? 3 : 0;
  }
  let t = Math.max(byTurns, byTime);
  // Time never skips the opening / agenda entirely: the user needs a beginning even in a short session.
  if (box > 0 && userTurns < 3 && t > 2) t = Math.max(byTurns, 2);
  if (wrapUp && userTurns >= 2) t = Math.max(t, 3);
  return t;
}

export function computeState(s: EngineSession, messageCount: number, now: Date, opts: StateOpts = {}): SessionState {
  const elapsedMin = s.programId && s.usedSeconds != null
    ? Math.max(0, Math.floor(s.usedSeconds / 60)) // paused time does not count
    : Math.max(0, Math.floor((now.getTime() - s.startedAt.getTime()) / 60_000));
  const box = timeBoxOf(s);
  const remainingMin = box > 0 ? Math.max(0, box - elapsedMin) : null;
  const userTurns = Math.floor(messageCount / 2);
  const distressed = s.riskFlag === 'ELEVATED' || s.riskFlag === 'HIGH' || isDistressText(opts.lastUserText);

  const current = idx(s.phase);
  let next = current;
  if (!distressed) {
    const target = targetIndex(s, userTurns, elapsedMin, isWrapUpText(opts.lastUserText));
    if (target > current) next = current + 1; // at most one phase per message so each step gets its own turn
  } else if (current > idx('CORE')) {
    next = idx('CORE'); // never rush a distressed user to the exit
  } else if (current < idx('CORE') && userTurns >= 2) {
    next = idx('CORE'); // skip agenda formalities, go straight to support
  }
  const phase = PHASES[next]!;
  return { phase, elapsedMin, remainingMin, phaseHint: HINT_KEYS[phase], nextStep: buildNextStep(s, phase, remainingMin, distressed, opts), distressed };
}

const APPROACH_TEXT: Record<PlanContent['approach'], string> = {
  CBT: 'CBT-informed: gently look at the link between a situation, the thought and the feeling, and offer a small reframing question.',
  MI: 'Motivational-interviewing-informed: explore ambivalence with open questions, reflect their own reasons for change, affirm strengths; no pushing.',
  ACT: 'ACT-informed: values and acceptance; help them notice the thought without fighting it, and name what matters to them.',
  MIXED: 'Choose gently among CBT (thought-feeling link), motivational interviewing (their own reasons) and ACT (values, acceptance) based on what they bring.',
};

const NO_LABELS = 'Never diagnose or name any disorder or condition; medication is information only, never advice (leave it to their doctor).';
const INTAKE_DAY1: Record<Phase, string> = {
  OPENING: 'Current step: INTAKE DAY 1 WELCOME. Welcome them warmly. Say plainly that you are an AI companion, not a person and not a therapist or licensed professional. Explain confidentiality and its limits in simple words: what they share is private and stored encrypted, you are not an emergency service, and if they are in serious danger you will encourage them to reach real-world help. Say they may skip any question. Ask what to call them if unknown. ONE question at a time.',
  AGENDA: 'Current step: INTAKE DAY 1 PRESENTING PROBLEM. Gently ask what brought them here, then, one question at a time, how long it has been going on, how often it happens and how it affects daily life (sleep, work or study, people close to them). Reflect each answer back briefly.',
  CORE: `Current step: INTAKE DAY 1 PRESENTING PROBLEM AND SAFETY. Keep exploring the problem with open questions, then kindly and directly ask how safe they feel and whether they ever have thoughts of harming themselves or not wanting to be here. If anything worrying is shared, support comes before the intake. ${NO_LABELS}`,
  SUMMARY: 'Current step: INTAKE DAY 1 REFLECTION. In 2-3 sentences reflect back what you understood about what is happening and how it affects them, and ask whether you got it right.',
  HOMEWORK: 'Current step: INTAKE DAY 1 FIRST STEP. Offer ONE tiny optional task (1-5 minutes), such as simply noticing when the difficulty shows up today, and let them decline.',
  CLOSING: 'Current step: INTAKE DAY 1 CLOSING. Thank them for sharing. Say that the next sitting is about their background and building a simple plan together. Say goodbye warmly and remind them you are an AI companion, so real-world support matters too.',
};
const INTAKE_DAY2: Record<Phase, string> = {
  OPENING: 'Current step: INTAKE DAY 2 WELCOME BACK. Welcome them back and make ONE natural callback to what they shared in the first sitting if it is listed in the context. Ask briefly how they are today (a 1-10 mood rating if not given). Remind them they can skip any question.',
  AGENDA: 'Current step: INTAKE DAY 2 PERSONAL HISTORY. Say this part is optional. Ask, one question at a time, about relevant background: when it began, what has helped or not helped before, and who or what supports them. Accept skipping without pressure.',
  CORE: `Current step: INTAKE DAY 2 FORMULATION AND PLAN. First offer a gentle, tentative picture in plain words: what may have started the difficulty, what may keep it going, and their strengths; ask whether it fits and invite corrections. Then co-create a plan, one question at a time: the problem they want to work on, a goal in their own words, and the method (a CBT-style thought check, behavioural activation, mindfulness or grounding, or supportive talk). You may suggest how many days the program could run, but they decide. ${NO_LABELS}`,
  SUMMARY: 'Current step: INTAKE DAY 2 PLAN SUMMARY. State the plan in 2-3 plain sentences (problem, goal, method) and ask whether they agree or want to change anything.',
  HOMEWORK: 'Current step: INTAKE DAY 2 FIRST STEP. Offer ONE tiny optional task (1-5 minutes) linked to their goal and let them shape or decline it.',
  CLOSING: 'Current step: INTAKE DAY 2 CLOSING. Thank them, say the starting plan will be saved where they can see and change it, and that regular sittings start next with a short check-in and one technique at a time. Say goodbye warmly; remind them you are an AI companion.',
};

function buildNextStep(s: EngineSession, phase: Phase, remainingMin: number | null, distressed: boolean, o: StateOpts): string {
  const time = remainingMin === null ? '' : ` About ${remainingMin} minute${remainingMin === 1 ? '' : 's'} of the planned ${timeBoxOf(s)} remain; keep time awareness light and never mention a stopwatch.`;
  if (distressed) {
    return `Current step: SUPPORT. The user seems distressed. Forget the agenda, the clock and homework. Stay present, validate, ask one gentle question about how they are right now, and only offer a grounding step if they want it.${time ? ' Do not hurry them to finish.' : ''}`;
  }
  const part = intakePartOf(s);
  if (part === 1) return INTAKE_DAY1[phase] + time;
  if (part === 2) return INTAKE_DAY2[phase] + time;
  if (s.isIntake) {
    const steps: Record<Phase, string> = {
      OPENING: 'Current step: INTAKE WELCOME. Welcome them warmly, say plainly that you are an AI companion (not a person or a licensed professional) and that this first conversation is to get to know them so future sessions fit them. Ask what to call them if unknown, then ask about their background or daily life, ONE question at a time.',
      AGENDA: 'Current step: INTAKE REASON. Gently ask what brought them here and what they hope to get from the sessions. Explore one goal at a time and reflect it back.',
      CORE: 'Current step: INTAKE EXPLORATION. Across the next turns, one question at a time, learn: what has and has not helped before; how they prefer you to talk (warm or more direct, gentle or steady pace, which language); and, kindly and without alarm, how safe they feel and whether they ever have thoughts of harming themselves. If anything worrying is shared, support comes before the intake.',
      SUMMARY: 'Current step: INTAKE REFLECTION. Reflect back in 2-3 sentences what you understood about them, their goals and preferences, and ask whether you got it right.',
      HOMEWORK: 'Current step: INTAKE FIRST STEP. Offer ONE tiny, optional first step (1-5 minutes) linked to their goal, or invite them to simply notice something this week.',
      CLOSING: 'Current step: INTAKE CLOSING. Thank them for sharing, say you will put together a simple starting plan from what they told you which they can see and change, and warmly say goodbye. The intake is now complete.',
    };
    return steps[phase];
  }
  const approach = APPROACH_TEXT[o.approach ?? 'MIXED'];
  const dayTxt = o.program ? ` This is Day ${o.program.dayNumber} of ${o.program.plannedDays} of their program.` : '';
  const finalDay = !!o.program && o.program.dayNumber >= o.program.plannedDays;
  const gentle = o.pace === 'GENTLE' ? ' Keep the pace gentle and slow.' : '';
  const review = o.finalizedCount && o.finalizedCount > 0 && o.finalizedCount % REVIEW_EVERY === 0
    ? ` This is a good moment for a brief progress check: ask, in one short question, how they feel they are doing against the goals in their plan since you started.` : '';
  const risk = o.highStress ? ' Their recent check-ins show high stress or low mood, so after the greeting add one kind, direct check-in about how they are coping and whether they feel safe.' : '';
  const r = o.rhythm;
  const late = r?.partOfDay === 'late night';
  const opening = r
    ? `Current step: OPENING (a warm, human arrival).${dayTxt} Greet them by name if known, in their language, the way a kind person would at this ${r.partOfDay} hour.${late ? ' It is late: keep everything gentle and short.' : ''} ${r.gapDays !== null && r.gapDays >= 3 ? 'Warmly say it is good to see them again, with no guilt, no "where were you" and no counting of days. ' : ''}${r.hasCallback ? 'You may make ONE natural callback to something they said before (see the optional candidates), as a soft question, never a quiz. ' : ''}${s.moodBefore ? `They rated their mood ${s.moodBefore}/10; acknowledge it without fuss.` : 'Ask gently how they are, and, only when it fits (never as your first words if they begin with something heavy), invite a mood rating from 1 to 10.'} If they start with something heavy, respond to that first and let the rating wait. If nothing is listed in the context, do not mention earlier sessions at all.${review}${risk}${time}`
    : '';
  const nextDue = !!o.program && !finalDay;
  const closing = o.program
    ? `Current step: CLOSING. Close warmly and briefly with a human, specific goodbye: appreciate one concrete thing they did or said today in their own words, remind them they can end the session whenever they like and that you are an AI companion, so real-world support matters too. ${nextDue ? 'Their next sitting is tomorrow; you may mention you will be here then, as an invitation, with no pressure.' : 'Do not promise or name another sitting.'} Do not open new topics. If they bring up something heavy, return to support instead.${time}`
    : '';
  const steps: Record<Phase, string> = {
    OPENING: opening || `Current step: OPENING (check-in, then a short review of last time).${dayTxt} Greet them warmly by name if known.${s.moodBefore ? ` They rated their mood ${s.moodBefore}/10; acknowledge it without fuss.` : ' Invite a quick mood rating from 1 to 10.'} If a LAST SESSION or open homework is listed in the context, your FIRST reply must include ONE natural callback to it in your own words (for example the topic they were facing, or how the small task went), phrased as a gentle question, never a quiz and never reciting notes; then invite the mood rating if it is not given yet. If nothing is listed, do not mention earlier sessions at all.${review}${risk}${time}`,
    AGENDA: `Current step: AGENDA. Help them choose today's focus: offer at most two options drawn from what they said, from their plan goals or from a leftover topic, and let them decide. Ask ONE question.${time}`,
    CORE: `Current step: CORE. Listen and reflect, validate, then explore with open questions. Choose at most ONE technique for today, based on their plan approach and topic, and do not stack several: a CBT thought check (situation, thought, feeling, a gentler balanced thought), behavioural activation (one small doable activity), mindfulness or grounding (a short breathing or 5-4-3-2-1 exercise), or simply supportive talk. Offer it in plain words and let them decline. ${approach} ${NO_LABELS} Draw on RETRIEVED KNOWLEDGE if provided, in your own words.${gentle}${time}`,
    SUMMARY: `Current step: SUMMARY. Begin winding down. In 2-3 short sentences, name the main takeaways in their own words, then ask what stood out and ask for brief feedback on today's sitting (what helped, what to change).${finalDay ? ' This is their FINAL sitting: also reflect warmly on the whole journey, comparing where they started with their goals now, and name what they can keep doing.' : ''}${time}`,
    HOMEWORK: `Current step: HOMEWORK. Offer ONE tiny optional task (1-5 minutes) connected to what you discussed and let them shape or decline it. Never give more than one.${time}`,
    CLOSING: closing || `Current step: CLOSING. Close warmly and briefly: appreciate the effort, remind them they can end the session whenever they like and that you are an AI companion, so real-world support matters too. Do not open new topics. If they bring up something heavy, return to support instead.${time}`,
  };
  return steps[phase];
}

// ---------- intake -> treatment plan ----------

const planSchema = z.object({
  goals: z.array(z.object({ id: z.union([z.string(), z.number()]).transform((v) => String(v).slice(0, 40)).optional(), title: z.string().min(1).max(160), note: z.string().max(300).optional() })).min(1).max(5),
  focusAreas: z.array(z.string().min(1).max(80)).max(6).default([]),
  approach: z.enum(['CBT', 'MI', 'ACT', 'MIXED']).default('MIXED'),
  pace: z.enum(['GENTLE', 'STEADY']).default('GENTLE'),
  tone: z.enum(['WARM', 'DIRECT']).default('WARM'),
  language: z.enum(['en', 'bn', 'hi', 'ne', 'mixed', 'auto']).optional(),
  background: z.string().max(600).optional(),
  whatHelps: z.string().max(400).optional(),
  whatDoesnt: z.string().max(400).optional(),
});

/** Extracts JSON from a model reply that may be wrapped in a code fence or prose. */
export function parseJsonLoose(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (m ? m[1]! : text).trim();
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

export interface PlanDeps { db: Db; glm: GlmClient; cipher: Cipher }

/**
 * After an intake session: asks the model for a PlanContent JSON, validates it and saves a new plan version.
 * Only when continuity is on and the session allows remembering. Never throws. Returns true when a plan was saved.
 * With {anySession:true} an ordinary (non-intake) session of at least 3 user messages can also start a plan, but only when the user
 * has no active plan yet.
 */
export async function maybeBuildPlanFromIntake(d: PlanDeps, sessionId: string, opts: { anySession?: boolean } = {}): Promise<boolean> {
  try {
    const s = await d.db.therapySession.findUnique({ where: { id: sessionId } });
    if (!s || !s.rememberThis || (!s.isIntake && !opts.anySession)) return false;
    if (!(await continuityEnabled(d.db, s.userId))) return false;
    if (s.riskFlag === 'HIGH') return false; // crisis sessions are never processed
    if (intakePartOf(s) === 1) return false; // the plan is co-created on Day 2; Day 1 alone never builds one
    const recent = await d.db.treatmentPlan.findFirst({ where: { userId: s.userId, active: true, ...(s.isIntake ? { createdAt: { gte: s.startedAt } } : {}) } });
    if (recent) return false; // idempotent: this intake already produced a plan
    const msgs = await d.db.sessionMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 60 });
    if (msgs.filter((m) => m.role === 'user').length < (s.isIntake ? 2 : 3)) return false;
    let earlier = '';
    if (intakePartOf(s) === 2) { // Day 2 plan draws on the Day 1 conversation of the same program too (only if remembered)
      const d1 = await d.db.therapySession.findFirst({ where: { programId: s.programId, userId: s.userId, dayNumber: 1, rememberThis: true, riskFlag: { not: 'HIGH' } } });
      if (d1) {
        const m1 = await d.db.sessionMessage.findMany({ where: { sessionId: d1.id }, orderBy: { createdAt: 'asc' }, take: 40 });
        earlier = m1.map((m) => `${m.role === 'assistant' ? 'companion' : 'user'}: ${d.cipher.decrypt(m.encryptedContent)}`).join('\n').slice(0, 5_000) + '\n--- next sitting ---\n';
      }
    }
    const transcript = (earlier + msgs.map((m) => `${m.role === 'assistant' ? 'companion' : 'user'}: ${d.cipher.decrypt(m.encryptedContent)}`).join('\n')).slice(0, 17_000);
    const r = await d.glm.chat([
      {
        role: 'system',
        content: 'From this ' + (s.isIntake ? 'intake ' : '') + 'conversation for a wellness companion app, write a simple starting plan as ONE JSON object and nothing else. Keys: goals (1-5 items {id, title, note?}, in the user\'s own words, small and concrete), focusAreas (short strings), approach (CBT|MI|ACT|MIXED), pace (GENTLE|STEADY), tone (WARM|DIRECT), language (en|bn|hi|ne|mixed), background (short, neutral), whatHelps, whatDoesnt. Use only what the user said. Do NOT diagnose, label disorders, or mention medication. Write text values in the user\'s language.',
      },
      { role: 'user', content: transcript },
    ], { maxTokens: 700 });
    await d.db.usageRecord.create({ data: { userId: s.userId, sessionId, inputTokens: r.inputTokens, outputTokens: r.outputTokens } }).catch(() => undefined);
    const parsed = planSchema.safeParse(parseJsonLoose(r.content));
    if (!parsed.success) return false;
    const p = parsed.data;
    const plan: PlanContent = {
      goals: p.goals.map((g, i) => ({ id: g.id || `g${i + 1}`, title: g.title, ...(g.note ? { note: g.note } : {}) })),
      focusAreas: p.focusAreas, approach: p.approach, pace: p.pace, tone: p.tone,
      language: p.language ?? (['en', 'bn', 'hi', 'ne'].includes(s.language) ? (s.language as PlanContent['language']) : 'mixed'),
      ...(p.background ? { background: p.background } : {}), ...(p.whatHelps ? { whatHelps: p.whatHelps } : {}), ...(p.whatDoesnt ? { whatDoesnt: p.whatDoesnt } : {}),
    };
    await savePlan(d.db, d.cipher, s.userId, plan);
    return true;
  } catch {
    return false;
  }
}
