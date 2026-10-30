import type { Db } from '../config/database.js';
import { requireConsents, activeConsents } from '../modules/consents/consentService.js';
import type { Cipher } from '../utils/crypto.js';
import { AppError, conflict, consentRequired, notFound } from '../utils/errors.js';
import type { ChatMessage, GlmClient } from './glmClient.js';
import {
  assessSafely, checkOutput, crisisMessage, elevatedFooter, getResources, pickLang, UNSAFE_OUTPUT_FALLBACK,
  type ResourceView, type Severity,
} from './safetyService.js';
import { buildWellnessContext } from './contextService.js';
import { formatKnowledge, type Retriever } from './knowledge/retriever.js';
import { ELEVATED_ADDENDUM, languageDirective, SPOKEN_ADDENDUM } from './systemPrompt.js';

export interface ConversationDeps {
  db: Db; glm: GlmClient; cipher: Cipher; systemPrompt: string;
  contextMessages: number; maxChars: number; retriever?: Retriever;
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

    const assessment = assessSafely(input.text);
    const lang = pickLang(session.language, input.text);
    const countryCode = await userCountry(input.userId);

    // HIGH / IMMINENT: fixed, reviewed response; the model is not called and the user's text is not retained.
    if (assessment.severity === 'HIGH' || assessment.severity === 'IMMINENT') {
      const resources = await getResources(d.db, countryCode);
      const content = crisisMessage(assessment.severity, lang, resources);
      const saved = await d.db.sessionMessage.create({
        data: { sessionId: session.id, role: 'assistant', encryptedContent: d.cipher.encrypt(content) },
      });
      await recordSafety(input.userId, session.id, assessment.severity, assessment.categories, 'CRISIS_RESPONSE_SHOWN');
      input.onReplace?.(content);
      return {
        message: { id: saved.id, role: 'assistant', content, createdAt: saved.createdAt },
        safety: { severity: assessment.severity, crisis: true, resources },
      };
    }

    // Authorised, minimal context: this session's recent messages only.
    const history = await d.db.sessionMessage.findMany({
      where: { sessionId: session.id }, orderBy: { createdAt: 'desc' }, take: d.contextMessages,
    });
    const context: ChatMessage[] = history.reverse().map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user', content: d.cipher.decrypt(m.encryptedContent),
    }));

    let system = `${d.systemPrompt}\n\n${languageDirective(lang)}`;
    const wellness = await buildWellnessContext(d.db, d.cipher, input.userId, session.id).catch(() => '');
    if (wellness) system += `\n\n${wellness}`;
    // Only reached after the HIGH/IMMINENT early return; a retrieval failure must never break chat.
    if (d.retriever) {
      const k = formatKnowledge(await d.retriever.retrieve(input.text, lang).catch(() => []));
      if (k) system += `\n\n${k}`;
    }
    if (session.sessionType === 'VOICE') system +=`\n\n${SPOKEN_ADDENDUM}`;
    if (assessment.severity === 'ELEVATED') system += `\n\n${ELEVATED_ADDENDUM}`;

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
    const guard = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, guard.signal]) : guard.signal;
    let acc = '', blocked = false;
    let result;
    try {
      result = input.onDelta
        ? await d.glm.stream(messages, (t) => {
            acc += t;
            if (!blocked && !checkOutput(acc).ok) { blocked = true; guard.abort(); return; }
            if (!blocked) input.onDelta!(t);
          }, { signal })
        : await d.glm.chat(messages, { signal });
    } catch (e) {
      if (!(blocked && e instanceof AppError && e.code === 'CANCELLED')) throw e;
    }

    let content = result?.content ?? '';
    if (blocked || !checkOutput(content).ok) {
      content = UNSAFE_OUTPUT_FALLBACK[lang];
      input.onReplace?.(content);
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
        data: { userId: input.userId, sessionId: session.id, inputTokens: result?.inputTokens ?? 0, outputTokens: result?.outputTokens ?? 0 },
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
    const lang = session.language === 'bn' ? 'Bangla' : session.language === 'en' ? 'English' : session.language === 'hi' ? 'Hindi (हिन्दी)' : session.language === 'ne' ? 'Nepali (नेपाली)' : 'the same mix of Bangla and English';
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

