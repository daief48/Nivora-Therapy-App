import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { errorMessageKey, useSession } from '../api/hooks';
import { streamMessage } from '../api/stream';
import type { ChatMessage, Locale, Resource, SafetyInfo } from '../api/types';
import type { SessionOpts } from '../navigation/types';

export interface ConversationOptions {
  sessionId?: string; language: Locale; sessionType: 'TEXT' | 'VOICE';
  onAssistantDone?: (m: ChatMessage, safety: SafetyInfo) => void;
  /** Guided-session options sent when the session is created (length, intake, remember). Optional. */
  sessionOpts?: SessionOpts;
  /** Cumulative reply text while it streams (lets the voice call start speaking before the reply is complete). */
  onAssistantText?: (full: string) => void;
  /** The server swapped the reply for a safe one. */
  onAssistantReplace?: (full: string) => void;
}

let n = 0;
const localId = () => `local-${Date.now()}-${n++}`;
/** After a dropped connection the same message is retried (same session) a few times before an error is shown. */
const RETRY_DELAYS_MS = [1000, 2500, 5000];
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const id = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
});
const isDrop = (e: unknown) => (e instanceof ApiError ? e.isNetwork || e.code === 'AI_INTERRUPTED' : (e as Error)?.name !== 'AbortError');

/** Shared by the text chat and voice screens. Handles lazy session creation, streaming, cancel and retry. */
export function useConversation(opts: ConversationOptions) {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState(opts.sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof errorMessageKey> | null>(null);
  const [cancelledText, setCancelledText] = useState<string | null>(null);
  const [crisisResources, setCrisisResources] = useState<Resource[] | null>(null);
  const [ended, setEnded] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const sidRef = useRef(opts.sessionId);
  const abort = useRef<AbortController | null>(null);
  const seeded = useRef(false);
  const onDone = useRef(opts.onAssistantDone);
  onDone.current = opts.onAssistantDone;
  const cbs = useRef({ text: opts.onAssistantText, replace: opts.onAssistantReplace });
  cbs.current = { text: opts.onAssistantText, replace: opts.onAssistantReplace };
  const sessionOpts = useRef(opts.sessionOpts);
  sessionOpts.current = opts.sessionOpts;

  const existing = useSession(opts.sessionId);
  useEffect(() => {
    if (existing.data && !seeded.current) {
      seeded.current = true;
      setMessages(existing.data.messages);
      setEnded(existing.data.status === 'ENDED');
    }
  }, [existing.data]);

  /** Creates the session on first use (also needed by the realtime voice path, which talks to the server directly). */
  const ensureSession = useCallback(async (signal?: AbortSignal): Promise<string> => {
    if (sidRef.current) return sidRef.current;
    const so = sessionOpts.current;
    const s = await api<{ id: string }>('/sessions', { method: 'POST', body: { sessionType: opts.sessionType, language: opts.language, ...(so ? { ...so } : {}) }, signal });
    sidRef.current = s.id; setSessionId(s.id);
    return s.id;
  }, [opts.sessionType, opts.language]);

  /** Records a turn that the realtime relay already handled and stored server-side, so the screen shows it. */
  const appendTurn = useCallback((userText: string, assistantText: string, crisis = false) => {
    setMessages((m) => [
      ...m,
      ...(userText ? [{ id: localId(), role: 'user' as const, content: userText }] : []),
      ...(assistantText ? [{ id: localId(), role: 'assistant' as const, content: assistantText, crisis }] : []),
    ]);
    qc.invalidateQueries({ queryKey: ['sessions'] });
  }, [qc]);

  const send = useCallback(async (raw: string, journalEntryId?: string): Promise<void> => {
    const text = raw.trim();
    if (!text || busy) return;
    setErrorKey(null); setCancelledText(null);
    const userMsg: ChatMessage = { id: localId(), role: 'user', content: text };
    const aiId = localId();
    setMessages((m) => [...m.filter((x) => !x.failed), userMsg, { id: aiId, role: 'assistant', content: '' }]);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      let sid = sidRef.current;
      let result;
      // A dropped connection is retried with the SAME session (the server stores a turn only when it completes, so nothing is duplicated).
      for (let attempt = 0; ; attempt++) {
        let acc = '';
        try {
          sid ??= await ensureSession(ac.signal);
          result = await streamMessage(sid, text, {
            onDelta: (d) => { acc += d; setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: acc } : x))); cbs.current.text?.(acc); },
            onReplace: (full) => { acc = full; setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: full } : x))); cbs.current.replace?.(full); },
          }, ac.signal, journalEntryId);
          break;
        } catch (e) {
          if (ac.signal.aborted || !isDrop(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
          setReconnecting(true);
          setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: '' } : x)));
          await wait(RETRY_DELAYS_MS[attempt]!, ac.signal);
          if (ac.signal.aborted) throw e;
        }
      }
      setReconnecting(false);
      const final: ChatMessage = { id: result.message.id, role: 'assistant', content: result.message.content, createdAt: result.message.createdAt, crisis: result.safety.crisis };
      setMessages((m) => m.map((x) => (x.id === aiId ? final : x)));
      if (result.safety.severity !== 'NONE') setCrisisResources(result.safety.resources);
      qc.invalidateQueries({ queryKey: ['sessions'] });
      onDone.current?.(final, result.safety);
    } catch (e) {
      const cancelled = ac.signal.aborted || (e as Error)?.name === 'AbortError';
      setMessages((m) => (cancelled ? m.filter((x) => x.id !== aiId && x.id !== userMsg.id) : m.filter((x) => x.id !== aiId).map((x) => (x.id === userMsg.id ? { ...x, failed: true } : x))));
      if (cancelled) setCancelledText(text);
      else setErrorKey(errorMessageKey(e instanceof ApiError ? e : e));
    } finally {
      setBusy(false); setReconnecting(false); abort.current = null;
    }
  }, [busy, ensureSession, qc]);

  const cancel = useCallback(() => { abort.current?.abort(); }, []);
  const retry = useCallback(() => {
    const failed = messages.find((m) => m.failed);
    if (failed) void send(failed.content);
  }, [messages, send]);

  const finish = useCallback(async (summarize: boolean) => {
    if (!sessionId) return;
    await api(`/sessions/${sessionId}/end`, { method: 'POST', body: { summarize } });
    setEnded(true);
    qc.invalidateQueries({ queryKey: ['sessions'] });
  }, [sessionId, qc]);

  const remove = useCallback(async () => {
    if (sessionId) await api(`/sessions/${sessionId}`, { method: 'DELETE' });
    setMessages([]); sidRef.current = undefined; setSessionId(undefined); setEnded(false); setCrisisResources(null); seeded.current = true;
    qc.invalidateQueries({ queryKey: ['sessions'] });
  }, [sessionId, qc]);

  useEffect(() => () => abort.current?.abort(), []);

  return { sessionId, reconnecting, ensureSession, appendTurn, messages, busy, errorKey, cancelledText, crisisResources, ended, send, cancel, retry, finish, remove, loadingHistory: !!opts.sessionId && existing.isLoading, historyError: existing.isError ? existing.error : null, refetchHistory: existing.refetch };
}
