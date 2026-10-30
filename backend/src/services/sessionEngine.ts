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
}
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
  if (s.lengthMin > 0) {
    const f = elapsedMin / s.lengthMin;
    byTime = f >= 1 ? 5 : f >= 0.92 ? 4 : f >= 0.8 ? 3 : 0;
  }
  let t = Math.max(byTurns, byTime);
  // Time never skips the opening / agenda entirely: the user needs a beginning even in a short session.
  if (s.lengthMin > 0 && userTurns < 3 && t > 2) t = Math.max(byTurns, 2);
  if (wrapUp && userTurns >= 2) t = Math.max(t, 3);
  return t;
}

export function computeState(s: EngineSession, messageCount: number, now: Date, opts: StateOpts = {}): SessionState {
  const elapsedMin = Math.max(0, Math.floor((now.getTime() - s.startedAt.getTime()) / 60_000));
  const remainingMin = s.lengthMin > 0 ? Math.max(0, s.lengthMin - elapsedMin) : null;
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

function buildNextStep(s: EngineSession, phase: Phase, remainingMin: number | null, distressed: boolean, o: StateOpts): string {
  const time = remainingMin === null ? '' : ` About ${remainingMin} minute${remainingMin === 1 ? '' : 's'} of the planned ${s.lengthMin} remain; keep time awareness light and never mention a stopwatch.`;
  if (distressed) {
    return `Current step: SUPPORT. The user seems distressed. Forget the agenda, the clock and homework. Stay present, validate, ask one gentle question about how they are right now, and only offer a grounding step if they want it.${time ? ' Do not hurry them to finish.' : ''}`;
  }
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
  const gentle = o.pace === 'GENTLE' ? ' Keep the pace gentle and slow.' : '';
  const review = o.finalizedCount && o.finalizedCount > 0 && o.finalizedCount % REVIEW_EVERY === 0
    ? ` This is a good moment for a brief progress check: ask, in one short question, how they feel they are doing against the goals in their plan since you started.` : '';
  const risk = o.highStress ? ' Their recent check-ins show high stress or low mood, so after the greeting add one kind, direct check-in about how they are coping and whether they feel safe.' : '';
  const steps: Record<Phase, string> = {
    OPENING: `Current step: OPENING. Greet them warmly by name if known.${s.moodBefore ? ` They rated their mood ${s.moodBefore}/10; acknowledge it without fuss.` : ' Invite a quick mood rating from 1 to 10.'} If a LAST SESSION or open homework is listed in the context, your FIRST reply must include ONE natural callback to it in your own words (for example the topic they were facing, or how the small task went), phrased as a gentle question, never a quiz and never reciting notes; then invite the mood rating if it is not given yet. If nothing is listed, do not mention earlier sessions at all.${review}${risk}${time}`,
    AGENDA: `Current step: AGENDA. Help them choose today's focus: offer at most two options drawn from what they said, from their plan goals or from a leftover topic, and let them decide. Ask ONE question.${time}`,
    CORE: `Current step: CORE. Listen and reflect, validate, then explore with open questions. When it fits, try one small technique at a time. ${approach} Draw on RETRIEVED KNOWLEDGE if provided, in your own words.${gentle}${time}`,
    SUMMARY: `Current step: SUMMARY. Begin winding down. In 2-3 short sentences, name the main takeaways in their own words, then ask what stood out for them.${time}`,
    HOMEWORK: `Current step: HOMEWORK. Offer ONE tiny optional task (1-5 minutes) connected to what you discussed and let them shape or decline it. Never give more than one.${time}`,
    CLOSING: `Current step: CLOSING. Close warmly and briefly: appreciate the effort, remind them they can end the session whenever they like and that you are an AI companion, so real-world support matters too. Do not open new topics. If they bring up something heavy, return to support instead.${time}`,
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
    const recent = await d.db.treatmentPlan.findFirst({ where: { userId: s.userId, active: true, ...(s.isIntake ? { createdAt: { gte: s.startedAt } } : {}) } });
    if (recent) return false; // idempotent: this intake already produced a plan
    const msgs = await d.db.sessionMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 60 });
    if (msgs.filter((m) => m.role === 'user').length < (s.isIntake ? 2 : 3)) return false;
    const transcript = msgs.map((m) => `${m.role === 'assistant' ? 'companion' : 'user'}: ${d.cipher.decrypt(m.encryptedContent)}`).join('\n').slice(0, 12_000);
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
