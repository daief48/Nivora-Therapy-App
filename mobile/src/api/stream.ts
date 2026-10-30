import { fetch as streamingFetch } from 'expo/fetch';
import { API_BASE } from '../config';
import { ApiError, getTokens, refreshSession } from './client';
import type { SendResult } from './types';

export interface StreamHandlers { onDelta: (t: string) => void; onReplace: (t: string) => void }

/** POST a message and read the server-sent event stream. Aborting `signal` cancels the upstream GLM request. */
export async function streamMessage(sessionId: string, text: string, h: StreamHandlers, signal: AbortSignal, journalEntryId?: string): Promise<SendResult> {
  const doFetch = () => streamingFetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${getTokens()?.accessToken ?? ''}` },
    body: JSON.stringify({ text, ...(journalEntryId ? { journalEntryId } : {}) }),
  });
  let res;
  try {
    res = await doFetch();
    if (res.status === 401 && (await refreshSession())) res = await doFetch();
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server');
  }
  if (!res.ok) {
    let b: any = null; try { b = await res.json(); } catch { /* */ }
    throw new ApiError(res.status, b?.error?.code ?? 'HTTP_ERROR', b?.error?.message ?? 'Request failed');
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', result: SendResult | null = null;
  const handleBlock = (block: string) => {
    let event = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    const j = JSON.parse(data);
    if (event === 'delta') h.onDelta(j.text);
    else if (event === 'replace') h.onReplace(j.text);
    else if (event === 'done') result = j as SendResult;
    else if (event === 'error') throw new ApiError(502, j.code ?? 'AI_ERROR', j.message ?? 'The AI response failed');
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) { handleBlock(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (!result) throw new ApiError(502, 'AI_INTERRUPTED', 'The response was interrupted');
  return result;
}
