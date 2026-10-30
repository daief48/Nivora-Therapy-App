import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
  get isNetwork() { return this.code === 'NETWORK'; }
}

export interface Tokens { accessToken: string; refreshToken: string }
const KEY = 'auth-tokens-v1';
let tokens: Tokens | null = null;
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

// Tokens live in the platform keystore (Keychain / Android Keystore via SecureStore), never in AsyncStorage.
export async function loadTokens(): Promise<Tokens | null> {
  try { const raw = await SecureStore.getItemAsync(KEY); tokens = raw ? JSON.parse(raw) : null; } catch { tokens = null; }
  return tokens;
}
export async function saveTokens(t: Tokens | null) {
  tokens = t;
  try { if (t) await SecureStore.setItemAsync(KEY, JSON.stringify(t)); else await SecureStore.deleteItemAsync(KEY); } catch { /* keystore unavailable */ }
}
export const getTokens = () => tokens;

async function rawFetch(path: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  try { return await fetch(`${API_BASE}${path}`, init); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server');
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* not json */ }
  return new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details);
}

let refreshing: Promise<boolean> | null = null;
/** Single-flight refresh so parallel 401s do not burn the (rotating) refresh token twice. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const cur = tokens;
    if (!cur) return false;
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: cur.refreshToken }) });
      if (!res.ok) {
        if (res.status === 401) { await saveTokens(null); onSignedOut?.(); }
        return false;
      }
      const { data } = await res.json();
      await saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch { return false; }
    finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

/** POST JSON and receive binary audio. Same auth + token-refresh behaviour as api(). */
export async function apiAudio(path: string, body: unknown, signal?: AbortSignal): Promise<ArrayBuffer> {
  const send = () => rawFetch(path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
  let res = await send();
  if (res.status === 401 && tokens && (await refreshSession())) res = await send();
  if (!res.ok) throw await parseError(res);
  return res.arrayBuffer();
}

/** Sends a recording to the backend and returns the words (Bangla/English). The audio is not stored server-side. */
export async function apiTranscribe(audio: ArrayBuffer, mime: string, language: 'en' | 'bn' | 'hi' | 'ne' | 'mixed', signal?: AbortSignal): Promise<string> {
  const send = () => rawFetch(`/speech/transcribe?language=${language}`, {
    method: 'POST', signal,
    headers: { 'Content-Type': mime, ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}) },
    body: audio as any,
  });
  let res = await send();
  if (res.status === 401 && tokens && (await refreshSession())) res = await send();
  if (!res.ok) throw await parseError(res);
  return ((await res.json()).data?.text as string) ?? '';
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = opts;
  const send = () => rawFetch(path, {
    method, signal,
    headers: { 'Content-Type': 'application/json', ...(auth && tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let res = await send();
  if (res.status === 401 && auth && tokens) {
    if (await refreshSession()) res = await send();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()).data as T;
}
