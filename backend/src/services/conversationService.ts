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
import { emotionBlock, pickReplyShape, readEmotion, shapeBlock } from './emotionRead.js';
import { examplesBlock } from './therapyExamples.js';
import { finalizeSession } from './sessionSummarizer.js';
import { isDistressText } from './sessionEngine.js';
import { sittingUsedUp, touchSitting } from './sittingTime.js';
import { correctiveNote, detectViolations, userAskedDirectly } from './styleGuard.js';
import { buildMenu, createMarkerFilter, extractAction, menuPromptBlock, recordOffer, toCard, validateChoice, type ActionCard, type Menu } from './actionMenu.js';
import type { Telemetry } from './aiTelemetry.js';
import { ensureScopeCard } from './scopeCard.js';
import { checkDrift, redirectBlock, redirectCopy, REDIRECT_COOLDOWN_TURNS, wantsToSwitch, type ScopeRedirect } from './topicDrift.js';
import { userHasRisk } from './riskState.js';
import { decideStage, lucBlock, sectionCapabilities, type Capabilities, type LucStage } from './lucRule.js';

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
  /** Opt-in anonymous events (action offered, model latency). */
  telemetry?: Telemetry;
  /** Voice journal is switched on (the action menu may then offer it). */
  voiceJournal?: boolean;
  /** Listen -> Understand -> Confirm -> Suggest flow (lucRule.ts). Off (undefined / false) keeps the older behaviour: a menu after 2+ turns. */
  luc?: boolean;
}
export interface MessageInput {
  userId: string; sessionId: string; text: string; journalEntryId?: string;
  signal?: AbortSignal; onDelta?: (t: string) => void; onReplace?: (t: string) => void;
}
export interface MessageResult {
  message: { id: string; role: 'assistant'; content: string; createdAt: Date };
  safety: { severity: Severity; crisis: boolean; resources: ResourceView[] };
  /** The ONE in-app action the assistant offered with this reply (validated against this turn's menu), or null. Never set on crisis / elevated replies. */
  action?: ActionCard | null;
  /** Set when the message looks outside the session's scope: exactly two choices (RETURN | SEPARATE). Never set on crisis / elevated replies or when the person already chose to switch. */
  scopeRedirect?: ScopeRedirect | null;
  /** First reply of a session only (LUC flow on): the short "what I can do here" menu. Never on crisis / elevated replies. */
  capabilities?: Capabilities | null;
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
    const loaded = await ownedSession(input.userId, input.sessionId);
    if (loaded.status !== 'ACTIVE') throw conflict('This session has ended');
    await requireConsents(d.db, input.userId);
    // Active-time accounting: a message is a sign of presence. `session` keeps the PREVIOUS lastActivityAt (the prompt uses it to notice a return)
    // but carries the updated used time.
    const touched = await touchSitting(d.db, loaded.id);
    const session = touched ? { ...loaded, usedSeconds: touched.usedSeconds } : loaded;
    // Presence after the reply: program sittings add the elapsed time; legacy sessions just stamp lastActivityAt.
    const bumpActivity = () => (session.programId ? touchSitting(d.db, session.id) : d.db.therapySession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } })).catch(() => undefined);

    // This session's recent messages only (authorised, minimal context). Loaded before the safety check: the rolling window and
    // language stickiness both need the user's previous turns. HIGH / IMMINENT text is never stored, so none of it can be here.
    const history = await d.db.sessionMessage.findMany({
      where: { sessionId: session.id }, orderBy: [{ createdAt: 'desc' }, { role: 'asc' }], take: d.contextMessages, // user + assistant rows of one turn share a timestamp: role breaks the tie (user first once reversed)
    });
    const prior = history.reverse().map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: d.cipher.decrypt(m.encryptedContent), at: m.createdAt }));
    const previousUser = prior.filter((m) => m.role === 'user').map((m) => m.content);
    const recentAssistant = prior.filter((m) => m.role === 'assistant').slice(-3).map((m) => m.content);

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
      await d.db.therapySession.update({ where: { id: session.id }, data: { riskFlag: 'HIGH' } }).catch(() => undefined);
      await bumpActivity();
      input.onReplace?.(content);
      return {
        message: { id: saved.id, role: 'assistant', content, createdAt: saved.createdAt },
        safety: { severity: assessment.severity, crisis: true, resources },
      };
    }

    // Sitting time box: after endsAt new messages are refused and the note is produced. Never for a user in distress (riskFlag, safety
    // level or distress wording): the crisis path above has already run, and a person who needs support is not cut off by a clock.
    // Program sittings run out by ACTIVE time used (usedSeconds), not by the clock; legacy time-boxed rows keep the wall-clock rule.
    const timeUp = session.programId ? sittingUsedUp(session) : session.plannedMinutes > 0 && Date.now() >= session.startedAt.getTime() + session.plannedMinutes * 60_000;
    if (timeUp
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
        await bumpActivity();
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
    // Topic lock (gentle). Safety overrides topic: any risk this turn, on the session, or in the person's recent state drops the scope entirely
    // (no scope block, no drift check, no redirect). Every failure below means "no redirect".
    let scopeRedirect: ScopeRedirect | null = null;
    let driftBlock = '';
    let offeredTurn: number | null = null;
    let skipScope = elevated || session.riskFlag !== 'NONE' || assessment.severity !== 'NONE';
    let scopeKind: string | null = null;
    if (!skipScope && session.scopeChoice !== 'SWITCHED') {
      try {
        const card = await ensureScopeCard(d, session);
        if (card) {
          scopeKind = card.kind;
          if (await userHasRisk(d.db, d.cipher, input.userId).catch(() => true)) skipScope = true;
          else if (wantsToSwitch(input.text)) {
            skipScope = true; // their explicit choice: the lock is lifted for the rest of this session
            await d.db.therapySession.update({ where: { id: session.id }, data: { scopeChoice: 'SWITCHED' } });
          } else {
            const userTurn = (await d.db.sessionMessage.count({ where: { sessionId: session.id, role: 'user' } })) + 1;
            const cooling = (session.scopeChoice === 'OFFERED' || session.scopeChoice === 'RETURNED') && userTurn - (session.scopeChoiceTurn ?? 0) < REDIRECT_COOLDOWN_TURNS;
            if (!cooling) {
              const r = await checkDrift({ card, text: input.text, previousUser, lastAssistant: recentAssistant.at(-1), userTurn, utilityGlm: d.utilityGlm, signal: input.signal });
              if (r.drift) {
                d.log?.('topic_drift', { via: r.via });
                scopeRedirect = redirectCopy(card, lang);
                driftBlock = redirectBlock(card);
                offeredTurn = userTurn; // persisted once the reply exists: an aborted stream must not start the cooldown
              }
            }
          }
        }
      } catch { scopeRedirect = null; driftBlock = ''; }
    }
    const resolved = await resolveSession(d, liveSession, input.text);
    let system = await buildSessionSystemPrompt(d, {
      userId: input.userId, sessionId: session.id, lang: session.language === 'auto' ? spokenLang(input.text, previousUser) : lang, spoken, userText: input.text, resolved, skipScope,
    });
    if (driftBlock) system += `

${driftBlock}`;
    if (assessment.severity === 'ELEVATED') system += `\n\n${ELEVATED_ADDENDUM}`;
    else {
      const emo = await emotion;
      const read = emotionBlock(emo);
      if (read) system += `\n\n${read}`;
      const shape = spoken ? undefined : pickReplyShape(emo, recentAssistant, { hasContext: previousUser.length >= 3, userText: input.text });
      if (shape) system += `\n\n${shapeBlock(shape)}`;
      const ex = examplesBlock(lang, input.text, shape);
      if (ex) system += `\n\n${ex}`;
    }
    // Action menu (rule-based, per turn, so it sits near the end after the static parts). Never on the safety path. A failure just means no menu.
    // Legacy: only after the person has been heard for a few turns. LUC flow: only in the SUGGEST stage (they confirmed we understood), up to 3 options.
    // Any risk (this turn, the session, the person's state) means BYPASS: no listen-confirm flow at all, the existing safety flow only.
    const stage: LucStage | null = d.luc
      ? decideStage({
        riskBypass: elevated || session.riskFlag !== 'NONE' || assessment.severity !== 'NONE' || isDistressText(input.text) || (await userHasRisk(d.db, d.cipher, input.userId).catch(() => true)),
        lastAssistant: recentAssistant.at(-1), userText: input.text, history: prior,
      })
      : null;
    let menu: Menu | null = null;
    const menuAllowed = stage ? stage === 'SUGGEST' || stage === 'OPTIONS' || stage === 'FREE' : previousUser.length >= 2;
    if (!elevated && assessment.severity === 'NONE' && menuAllowed && !scopeRedirect) {
      menu = await buildMenu({ db: d.db, cipher: d.cipher }, input.userId, {
        surface: spoken ? 'CALL' : 'CHAT', sessionId: session.id, text: [...previousUser.slice(-2), input.text].join('\n'), voiceEnabled: d.voiceJournal,
        ...(stage ? { max: stage === 'FREE' ? 1 : 3 } : {}),
      }).catch(() => null);
      const block = menu ? menuPromptBlock(menu.items, menu.riskMode) : '';
      if (block) system += `\n\n${block}`;
      else menu = null;
    }
    if (stage && stage !== 'BYPASS' && !scopeRedirect) {
      const luc = lucBlock(stage, !!menu);
      if (luc) system += `\n\n${luc}`;
    }
    system += `\n\n${replyReminder(spoken)}`; // last: small models weight the end of the prompt most

    let userContent = input.text;
    if (input.journalEntryId) {
      if (!(await activeConsents(d.db, input.userId)).has('JOURNAL_AI_SHARING')) {
        throw consentRequired('Sharing journal entries with the AI needs your explicit consent');
      }
      const entry = await d.db.journalEntry.findFirst({ where: { id: input.journalEntryId, userId: input.userId, deletedAt: null } });
      if (!entry) throw notFound('Journal entry not found');
      const shared = d.cipher.decrypt(entry.encryptedContent).slice(0, 3000);
      // The shared entry is free text the model would read, so it gets the same rule check as a message. A high-risk entry is left out of
      // the model input (the message itself still goes through) and recorded as a content-free event, which also locks the risk state.
      const sa = assessSafely(shared);
      if (sa.severity === 'HIGH' || sa.severity === 'IMMINENT') {
        await recordSafety(input.userId, session.id, sa.severity, sa.categories, 'SHARED_ENTRY_WITHHELD');
        await d.db.therapySession.update({ where: { id: session.id }, data: { riskFlag: 'HIGH' } }).catch(() => undefined);
      } else {
        if (sa.severity === 'ELEVATED') await recordSafety(input.userId, session.id, 'ELEVATED', sa.categories, 'SUPPORT_FOOTER_ADDED');
        userContent += `\n\n[The user chose to share this journal entry with you:]\n${shared}`;
      }
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
    const markers = createMarkerFilter(); // the [[ACTION:ID]] line is never shown or spoken
    const t0 = Date.now();
    try {
      result = input.onDelta
        ? await d.glm.stream(messages, (t) => {
            acc += t;
            if (!blocked && !outputOk(acc)) { blocked = true; guard.abort(); return; }
            if (!blocked) { const out = markers.push(t); if (out) input.onDelta!(out); }
          }, { signal, ...genOpts })
        : await d.glm.chat(messages, { signal, ...genOpts });
      if (input.onDelta && !blocked) { const tail = markers.end(); if (tail) input.onDelta(tail); }
    } catch (e) {
      if (!(blocked && e instanceof AppError && e.code === 'CANCELLED')) throw e;
    }
    d.telemetry?.model(input.userId, spoken ? 'call' : 'session', Date.now() - t0, false).catch(() => undefined);

    const parsed = extractAction(result?.content ?? '');
    let chosen = parsed.id;
    let content = parsed.text;
    let extraIn = 0, extraOut = 0; // tokens of the optional style-guard retry
    if (blocked || !content.trim() || !outputOk(content)) {
      content = UNSAFE_OUTPUT_FALLBACK[lang];
      chosen = null;
      input.onReplace?.(content);
    } else if (spoken) {
      // Keep calls short: whole sentences only, closing question kept. What is saved is exactly what is spoken.
      const short = shortenForSpeech(content);
      if (short !== content.trim()) { content = short; input.onReplace?.(content); }
    } else if (d.styleGuard !== false) {
      // Text chats: if the draft lectures, defines, lists or stacks questions, regenerate ONCE with a corrective note (same output safety
      // checks) and keep whichever has fewer violations. Never loops; only violation codes are logged.
      const first = detectViolations(content, { priorUserTurns: previousUser.length, userAsked: userAskedDirectly(input.text), recentAssistant });
      if (first.length) {
        d.log?.('style_guard_retry', { violations: first });
        try {
          const retry = await d.glm.chat([{ role: 'system', content: `${system}\n\n${correctiveNote(first)}` }, ...messages.slice(1)], { signal: input.signal });
          extraIn = retry.inputTokens; extraOut = retry.outputTokens;
          const retried = extractAction(retry.content);
          const second = detectViolations(retried.text, { priorUserTurns: previousUser.length, userAsked: userAskedDirectly(input.text), recentAssistant });
          if (outputOk(retried.text) && retried.text.trim() && second.length < first.length) {
            content = retried.text; chosen = retried.id; input.onReplace?.(content);
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
        data: { ...(session.programId ? {} : { lastActivityAt: new Date() }), ...(resolved.guided ? { phase: resolved.state.phase } : {}), ...(liveSession.riskFlag !== session.riskFlag ? { riskFlag: liveSession.riskFlag } : {}) },
      }),
    ]);
    if (offeredTurn !== null) await d.db.therapySession.update({ where: { id: session.id }, data: { scopeChoice: 'OFFERED', scopeChoiceTurn: offeredTurn } }).catch(() => undefined);
    if (session.programId) await touchSitting(d.db, session.id); // the time the reply took
    // The offered action: only an id that was on this turn's menu counts; anything else the model wrote is dropped.
    let action: ActionCard | null = null;
    const pickedItem = menu && assessment.severity === 'NONE' ? validateChoice(chosen, menu.items) : null;
    if (menu && pickedItem) {
      try {
        const surface = spoken ? 'CALL' : 'CHAT';
        const offerId = await recordOffer(d.db, input.userId, pickedItem.def, surface, { sessionId: session.id, messageId: assistant.id });
        action = toCard(pickedItem.def, menu.locale, surface, pickedItem.reasonKey, { offerId });
        d.telemetry?.track(input.userId, 'action_offered', { kind: pickedItem.def.kind, surface }).catch(() => undefined);
      } catch { action = null; }
    } else if (chosen) d.log?.('action_dropped', { reason: menu ? 'NOT_ON_MENU' : 'NO_MENU' });
    return {
      message: { id: assistant.id, role: 'assistant', content, createdAt: assistant.createdAt },
      safety: { severity: assessment.severity, crisis: false, resources },
      action,
      ...(scopeRedirect ? { scopeRedirect } : {}),
      ...(stage && stage !== 'BYPASS' && !scopeRedirect && previousUser.length === 0
        ? { capabilities: sectionCapabilities(scopeKind === 'KAIZEN' ? 'KAIZEN' : 'CHAT', scopeKind === 'KAIZEN' ? null : scopeKind, lang) } : {}),
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
    await d.db.usageRecord.create({ data: { userId, sessionId, inputTokens: r.inputTokens, outputTokens: r.outputTokens } });
    // A summary is model text too: an unsafe or empty one is never stored (the session simply has no summary).
    const text = r.content.trim();
    if (!text || !checkOutput(text).ok || !checkSpokenOutput(text).ok) return false;
    await d.db.sessionSummary.upsert({
      where: { sessionId }, create: { sessionId, encryptedSummary: d.cipher.encrypt(r.content) },
      update: { encryptedSummary: d.cipher.encrypt(r.content) },
    });
    return true;
  }

  return { send, summarize, ownedSession };
}
export type ConversationService = ReturnType<typeof createConversationService>;

