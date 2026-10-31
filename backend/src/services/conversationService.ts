import type { Db } from '../config/database.js';
import { requireConsents, activeConsents } from '../modules/consents/consentService.js';
import type { Cipher } from '../utils/crypto.js';
import { AppError, conflict, consentRequired, notFound } from '../utils/errors.js';
import type { ChatMessage, GlmClient } from './glmClient.js';
import {
  assessRules, assessSafely, checkOutput, checkSpokenOutput, crisisMessage, elevatedFooter, getResources, pickLang, spokenLang, UNSAFE_OUTPUT_FALLBACK,
  type ResourceView, type SafetyAssessment, type Severity,
} from './safetyService.js';
import { classifyRisk, needsRiskFallback } from './riskFallback.js';
import { shortenForSpeech, SPOKEN_MAX_TOKENS } from './spokenReply.js';
import type { Retriever } from './knowledge/retriever.js';
import { buildSessionSystemPrompt, resolveSession } from './sessionContext.js';
import { ELEVATED_ADDENDUM, replyReminder } from './systemPrompt.js';
import { emotionBlock, readEmotion } from './emotionRead.js';
import { examplesBlock } from './therapyExamples.js';
import { finalizeSession } from './sessionSummarizer.js';
import { isDistressText } from './sessionEngine.js';
import { correctiveNote, detectViolations, userAskedDirectly } from './styleGuard.js';

/** Memory commands ("remember this", "forget that") are owned by another module; loaded lazily so this file works with or without it. */
type MemoryCommandFn = (
  deps: { db: Db; cipher: Cipher; glm: GlmClient },
  input: { userId: string; sessionId: string; text: string; lang: string },
) => Promise<{ handled: boolean; reply?: string }>;
let memoryCommandFn: Promise<MemoryCommandFn | null> | undefined;
function loadMemoryCommand(): Promise<MemoryCommandFn | null> {
  const spec = './memoryCommands.js';
  memoryCommandFn ??= import(/* @vite-ignore */ spec).then((m) => (typeof m?.handleMemoryCommand === 'function' ? m.handleMemoryCommand as MemoryCommandFn : null)).catch(() => null);
  return memoryCommandFn;
}

/** Fragments said within this window are assessed together with the new message (a crisis can be split across short turns). */
export const FRAGMENT_WINDOW_MS = 120_000;
const isCrisis = (a: SafetyAssessment) => a.severity === 'HIGH' || a.severity === 'IMMINENT';

export interface ConversationDeps {
  db: Db; glm: GlmClient; cipher: Cipher; systemPrompt: string;
  contextMessages: number; maxChars: number; retriever?: Retriever;
  /** Cheap model for private helper calls (emotion read). Unset = no emotion read. `glm` is the session-quality client. */
  utilityGlm?: GlmClient;
  /** Emotion read before the reply: for text chat and (opt-in) voice calls. */
  emotionRead?: { text: boolean; voice: boolean };
  /** Style check + one corrective regeneration for text chats. Default on. */
  styleGuard?: boolean;
  /** Content-free diagnostics (event name + codes only). */
  log?: (event: string, data: Record<string, unknown>) => void;
}
export interface MessageInput {
  userId: string; sessionId: string; text: string; journalEntryId?: string;
  signal?: AbortSignal; onDelta?: (t: string) => void; onReplace?: (t: string) => void;
}
export interface MessageResult {
  message: { id: string; role: 'assistant'; content: string; createdAt: Date };
  safety: { severity: Severity; crisis: boolean; resources: ResourceView[] };
}

export function createConversationService(d: ConversationDeps) {
  async function ownedSession(userId: string, sessionId: string) {
    const s = await d.db.therapySession.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw notFound('Session not found'); // same response for "not yours" and "doesn't exist"
    return s;
  }

  async function userCountry(userId: string) {
    return (await d.db.userProfile.findUnique({ where: { userId }, select: { countryCode: true } }))?.countryCode ?? null;
  }

  async function recordSafety(userId: string, sessionId: string, severity: Severity, categories: string[], action: string) {
    // Stores coarse metadata only, never message text.
    await d.db.safetyEvent.create({ data: { userId, sessionId, severity, category: categories.join(',') || null, actionTaken: action } });
  }

  async function send(input: MessageInput): Promise<MessageResult> {
    if (input.text.length > d.maxChars) throw new AppError(413, 'MESSAGE_TOO_LONG', 'Message is too long');
    const session = await ownedSession(input.userId, input.sessionId);
    if (session.status !== 'ACTIVE') throw conflict('This session has ended');
    await requireConsents(d.db, input.userId);

    // This session's recent messages only (authorised, minimal context). Loaded before the safety check: the rolling window and
    // language stickiness both need the user's previous turns. HIGH / IMMINENT text is never stored, so none of it can be here.
    const history = await d.db.sessionMessage.findMany({
      where: { sessionId: session.id }, orderBy: { createdAt: 'desc' }, take: d.contextMessages,
    });
    const prior = history.reverse().map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: d.cipher.decrypt(m.encryptedContent), at: m.createdAt }));
    const previousUser = prior.filter((m) => m.role === 'user').map((m) => m.content);

    let assessment = assessSafely(input.text);
    // Rolling window: the last 2 user messages from the last ~2 minutes, joined with the new one ("I don't want" + "to be here").
    if (!isCrisis(assessment)) {
      const now = Date.now();
      const fragments = prior.filter((m) => m.role === 'user' && now - m.at.getTime() <= FRAGMENT_WINDOW_MS).slice(-2).map((m) => m.content);
      if (fragments.length) {
        const combined = assessSafely([...fragments, input.text].join(' '));
        if (isCrisis(combined)) assessment = combined;
      }
    }
    // Languages the rules do not cover (not Bangla / Devanagari, not clearly English): a cheap model-based check, only when the rules found nothing.
    // Other scripts (Arabic, Cyrillic, CJK, ...) are always checked; Latin-script text that is not clearly English only in "auto" sessions.
    // A HIGH / IMMINENT result is treated exactly like a rule hit. The fixed crisis reply is shown in the session language, or in English for
    // 'auto' sessions, because no reviewed localised crisis text exists for such languages. Fail-safe is ELEVATED, never NONE.
    // "Rules found nothing" also holds when only the draft lexicon raised the level to ELEVATED, so the model check still runs then.
    if ((assessment.severity === 'NONE' || (assessment.severity === 'ELEVATED' && assessRules(input.text).severity === 'NONE')) && needsRiskFallback(input.text, session.language === 'auto')) {
      const r = await classifyRisk(d.glm, input.text, { signal: input.signal });
      if (isCrisis(r) || (assessment.severity === 'NONE' && r.severity !== 'NONE')) assessment = r;
    }
    const lang = pickLang(session.language, input.text, previousUser);
    const spoken = session.sessionType === 'VOICE';
    const countryCode = await userCountry(input.userId);

    // HIGH / IMMINENT: fixed, reviewed response; the model is not called and the user's text is not retained.
    if (isCrisis(assessment)) {
      const resources = await getResources(d.db, countryCode);
      const content = crisisMessage(assessment.severity, lang, resources);
      const saved = await d.db.sessionMessage.create({
        data: { sessionId: session.id, role: 'assistant', encryptedContent: d.cipher.encrypt(content) },
      });
      await recordSafety(input.userId, session.id, assessment.severity, assessment.categories, 'CRISIS_RESPONSE_SHOWN');
      await d.db.therapySession.update({ where: { id: session.id }, data: { riskFlag: 'HIGH', lastActivityAt: new Date() } }).catch(() => undefined);
      input.onReplace?.(content);
      return {
        message: { id: saved.id, role: 'assistant', content, createdAt: saved.createdAt },
        safety: { severity: assessment.severity, crisis: true, resources },
      };
    }

    // Sitting time box: after endsAt new messages are refused and the note is produced. Never for a user in distress (riskFlag, safety
    // level or distress wording): the crisis path above has already run, and a person who needs support is not cut off by a clock.
    if (session.plannedMinutes > 0 && Date.now() >= session.startedAt.getTime() + session.plannedMinutes * 60_000
      && session.riskFlag === 'NONE' && assessment.severity === 'NONE' && !isDistressText(input.text)) {
      await finalizeSession({ db: d.db, glm: d.glm, cipher: d.cipher }, session.id, 'IDLE');
      throw new AppError(409, 'SITTING_TIME_UP', "Time for today's sitting is up");
    }

    // Memory commands ("remember this" / "forget that") are handled without the model. The command text itself is never stored.
    if (assessment.severity === 'NONE') {
      let cmd: { handled: boolean; reply?: string } = { handled: false };
      try {
        const fn = await loadMemoryCommand();
        if (fn) cmd = await fn({ db: d.db, cipher: d.cipher, glm: d.glm }, { userId: input.userId, sessionId: session.id, text: input.text, lang });
      } catch { cmd = { handled: false }; }
      if (cmd.handled && cmd.reply) {
        const reply = cmd.reply;
        const saved = await d.db.sessionMessage.create({ data: { sessionId: session.id, role: 'assistant', encryptedContent: d.cipher.encrypt(reply) } });
        await d.db.therapySession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } }).catch(() => undefined);
        input.onReplace?.(reply);
        return { message: { id: saved.id, role: 'assistant', content: reply, createdAt: saved.createdAt }, safety: { severity: assessment.severity, crisis: false, resources: [] } };
      }
    }

    const context: ChatMessage[] = prior.map((m) => ({ role: m.role, content: m.content }));

    // Layered prompt: persona + safety + session phase + plan/notes/themes/homework (only with opt-in and rememberThis) + knowledge.
    // A retrieval or context failure must never break chat.
    const elevated = assessment.severity === 'ELEVATED';
    const liveSession = { ...session, riskFlag: elevated && session.riskFlag === 'NONE' ? 'ELEVATED' : session.riskFlag };
    // Private emotion read (cheap model, short timeout, fail-safe null) runs alongside prompt building. Skipped on the safety path (ELEVATED).
    const wantRead = !!d.utilityGlm && !elevated && (spoken ? d.emotionRead?.voice === true : d.emotionRead?.text !== false);
    const emotion = wantRead ? readEmotion(d.utilityGlm!, input.text, { signal: input.signal, previousUser: previousUser[previousUser.length - 1] }) : Promise.resolve(null);
    const resolved = await resolveSession(d, liveSession, input.text);
    let system = await buildSessionSystemPrompt(d, {
      userId: input.userId, sessionId: session.id, lang: session.language === 'auto' ? spokenLang(input.text, previousUser) : lang, spoken, userText: input.text, resolved,
    });
    if (assessment.severity === 'ELEVATED') system += `\n\n${ELEVATED_ADDENDUM}`;
    else {
      const read = emotionBlock(await emotion);
      if (read) system += `\n\n${read}`;
      const ex = examplesBlock(lang, input.text);
      if (ex) system += `\n\n${ex}`;
    }
    system += `\n\n${replyReminder(spoken)}`; // last: small models weight the end of the prompt most

    let userContent = input.text;
    if (input.journalEntryId) {
      if (!(await activeConsents(d.db, input.userId)).has('JOURNAL_AI_SHARING')) {
        throw consentRequired('Sharing journal entries with the AI needs your explicit consent');
      }
      const entry = await d.db.journalEntry.findFirst({ where: { id: input.journalEntryId, userId: input.userId, deletedAt: null } });
      if (!entry) throw notFound('Journal entry not found');
      userContent += `\n\n[The user chose to share this journal entry with you:]\n${d.cipher.decrypt(entry.encryptedContent).slice(0, 3000)}`;
    }
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...context, { role: 'user', content: userContent }];

    // Incremental output safety for streams: abort and replace as soon as unsafe text appears.
    // Spoken sessions use the stricter honesty / medication guard: nothing can be reviewed on screen before it is heard.
    const outputOk = (t: string) => (spoken ? checkSpokenOutput(t) : checkOutput(t)).ok;
    const genOpts = spoken ? { maxTokens: SPOKEN_MAX_TOKENS } : {};
    const guard = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, guard.signal]) : guard.signal;
    let acc = '', blocked = false;
    let result;
    try {
      result = input.onDelta
        ? await d.glm.stream(messages, (t) => {
            acc += t;
            if (!blocked && !outputOk(acc)) { blocked = true; guard.abort(); return; }
            if (!blocked) input.onDelta!(t);
          }, { signal, ...genOpts })
        : await d.glm.chat(messages, { signal, ...genOpts });
    } catch (e) {
      if (!(blocked && e instanceof AppError && e.code === 'CANCELLED')) throw e;
    }

    let content = result?.content ?? '';
    let extraIn = 0, extraOut = 0; // tokens of the optional style-guard retry
    if (blocked || !outputOk(content)) {
      content = UNSAFE_OUTPUT_FALLBACK[lang];
      input.onReplace?.(content);
    } else if (spoken) {
      // Keep calls short: whole sentences only, closing question kept. What is saved is exactly what is spoken.
      const short = shortenForSpeech(content);
      if (short !== content.trim()) { content = short; input.onReplace?.(content); }
    } else if (d.styleGuard !== false) {
      // Text chats: if the draft lectures, defines, lists or stacks questions, regenerate ONCE with a corrective note (same output safety
      // checks) and keep whichever has fewer violations. Never loops; only violation codes are logged.
      const first = detectViolations(content, { priorUserTurns: previousUser.length, userAsked: userAskedDirectly(input.text) });
      if (first.length) {
        d.log?.('style_guard_retry', { violations: first });
        try {
          const retry = await d.glm.chat([{ role: 'system', content: `${system}\n\n${correctiveNote(first)}` }, ...messages.slice(1)], { signal: input.signal });
          extraIn = retry.inputTokens; extraOut = retry.outputTokens;
          const second = detectViolations(retry.content, { priorUserTurns: previousUser.length, userAsked: userAskedDirectly(input.text) });
          if (outputOk(retry.content) && second.length < first.length) {
            content = retry.content; input.onReplace?.(content);
            d.log?.('style_guard_replaced', { violations: second });
          }
        } catch { /* keep the first reply */ }
      }
    }
    let resources: ResourceView[] = [];
    if (assessment.severity === 'ELEVATED') {
      resources = await getResources(d.db, countryCode);
      content += `\n\n${elevatedFooter(lang, resources)}`;
      await recordSafety(input.userId, session.id, 'ELEVATED', assessment.categories, 'SUPPORT_FOOTER_ADDED');
    }

    const [, assistant] = await d.db.$transaction([
      d.db.sessionMessage.create({ data: { sessionId: session.id, role: 'user', encryptedContent: d.cipher.encrypt(input.text) } }),
      d.db.sessionMessage.create({ data: { sessionId: session.id, role: 'assistant', encryptedContent: d.cipher.encrypt(content) } }),
      d.db.usageRecord.create({
        data: { userId: input.userId, sessionId: session.id, inputTokens: (result?.inputTokens ?? 0) + extraIn, outputTokens: (result?.outputTokens ?? 0) + extraOut },
      }),
      d.db.therapySession.update({
        where: { id: session.id },
        data: { lastActivityAt: new Date(), ...(resolved.guided ? { phase: resolved.state.phase } : {}), ...(liveSession.riskFlag !== session.riskFlag ? { riskFlag: liveSession.riskFlag } : {}) },
      }),
    ]);
    return {
      message: { id: assistant.id, role: 'assistant', content, createdAt: assistant.createdAt },
      safety: { severity: assessment.severity, crisis: false, resources },
    };
  }

  async function summarize(userId: string, sessionId: string): Promise<boolean> {
    const session = await ownedSession(userId, sessionId);
    const flagged = await d.db.safetyEvent.count({ where: { sessionId, severity: { in: ['HIGH', 'IMMINENT'] } } });
    if (flagged > 0) return false; // no AI-generated summaries of crisis sessions
    const msgs = await d.db.sessionMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 60 });
    if (msgs.length < 2) return false;
    const transcript = msgs.map((m) => `${m.role}: ${d.cipher.decrypt(m.encryptedContent)}`).join('\n');
    const lang = session.language === 'auto' ? 'the same language the user mostly used in the conversation' : session.language === 'bn' ? 'Bangla' : session.language === 'en' ? 'English' : session.language === 'hi' ? 'Hindi (हिन्दी)' : session.language === 'ne' ? 'Nepali (नेपाली)' : 'the same mix of Bangla and English';
    const r = await d.glm.chat([
      { role: 'system', content: `Summarise this self-help conversation in 3-5 short bullet points in ${lang}: main topics, feelings the user expressed in their own words, and any next steps they chose. Do not diagnose or add advice not discussed.` },
      { role: 'user', content: transcript },
    ], { maxTokens: 400 });
    await d.db.sessionSummary.upsert({
      where: { sessionId }, create: { sessionId, encryptedSummary: d.cipher.encrypt(r.content) },
      update: { encryptedSummary: d.cipher.encrypt(r.content) },
    });
    await d.db.usageRecord.create({ data: { userId, sessionId, inputTokens: r.inputTokens, outputTokens: r.outputTokens } });
    return true;
  }

  return { send, summarize, ownedSession };
}
export type ConversationService = ReturnType<typeof createConversationService>;

