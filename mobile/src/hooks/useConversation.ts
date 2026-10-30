import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { errorMessageKey, useSession } from '../api/hooks';
import { streamMessage } from '../api/stream';
import type { ChatMessage, Locale, Resource, SafetyInfo } from '../api/types';

export interface ConversationOptions {
  sessionId?: string; language: Locale; sessionType: 'TEXT' | 'VOICE';
  onAssistantDone?: (m: ChatMessage, safety: SafetyInfo) => void;
}

let n = 0;
const localId = () => `local-${Date.now()}-${n++}`;

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
  const abort = useRef<AbortController | null>(null);
  const seeded = useRef(false);
  const onDone = useRef(opts.onAssistantDone);
  onDone.current = opts.onAssistantDone;

  const existing = useSession(opts.sessionId);
  useEffect(() => {
    if (existing.data && !seeded.current) {
      seeded.current = true;
      setMessages(existing.data.messages);
      setEnded(existing.data.status === 'ENDED');
    }
  }, [existing.data]);

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
      let sid = sessionId;
      if (!sid) {
        const s = await api<{ id: string }>('/sessions', { method: 'POST', body: { sessionType: opts.sessionType, language: opts.language }, signal: ac.signal });
        sid = s.id; setSessionId(sid);
      }
      const result = await streamMessage(sid, text, {
        onDelta: (d) => setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: x.content + d } : x))),
        onReplace: (full) => setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: full } : x))),
      }, ac.signal, journalEntryId);
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
      setBusy(false); abort.current = null;
    }
  }, [busy, sessionId, opts.sessionType, opts.language, qc]);

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
    setMessages([]); setSessionId(undefined); setEnded(false); setCrisisResources(null); seeded.current = true;
    qc.invalidateQueries({ queryKey: ['sessions'] });
  }, [sessionId, qc]);

  useEffect(() => () => abort.current?.abort(), []);

  return { sessionId, messages, busy, errorKey, cancelledText, crisisResources, ended, send, cancel, retry, finish, remove, loadingHistory: !!opts.sessionId && existing.isLoading, historyError: existing.isError ? existing.error : null, refetchHistory: existing.refetch };
}
