import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { crisisMessage, getResources, pickLang } from '../../services/safetyService.js';
import type { Deps } from '../deps.js';
import { createRelay, upstreamSessionConfig, type RelayDeps, type UpstreamPort } from './relayCore.js';

// WebSocket relay at /api/v1/realtime. The browser/app never sees the OpenAI key: this server opens the upstream connection.
// Auth: the access token is the first message (`hello`), never part of the URL, so it cannot end up in access logs.
export const REALTIME_PATH = '/api/v1/realtime';

const MAX_PAYLOAD = 128 * 1024;        // one frame (about 2.5 s of base64 PCM16 24 kHz is ~160 KB, so clients send smaller chunks)
const HELLO_DEADLINE_MS = 10_000;      // must authenticate quickly
const IDLE_MS = 60_000;                // no client frame at all
const MAX_CALL_MS = 60 * 60_000;       // hard stop for one connection
const UPSTREAM_OPEN_MS = 8_000;
const MAX_PER_USER = 2;

export function attachRealtime(server: Server, d: Deps): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const open = new Map<string, number>(); // userId -> open connections
  const log = d.logger.child({ mod: 'realtime' });

  /** Reuses the exact access-token checks of middleware/authenticate.ts. */
  const authenticate = (token: string) => new Promise<{ userId: string } | null>((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    d.authenticate(req, {} as any, (err?: unknown) => resolve(err || !req.user ? null : { userId: req.user.id as string }));
  });

  function openUpstream(language: string, onEvent: (ev: unknown) => void, onClose: () => void): Promise<UpstreamPort | null> {
    const key = d.config.OPENAI_API_KEY;
    if (!key) return Promise.resolve(null); // not configured: the client falls back to the turn-based path
    const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-mini-realtime-preview';
    const base = d.config.OPENAI_BASE_URL.replace(/\/$/, '').replace(/^http/, 'ws');
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (v: UpstreamPort | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      const sock = new WebSocket(`${base}/realtime?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': 'realtime=v1' }, handshakeTimeout: UPSTREAM_OPEN_MS,
      });
      timer = setTimeout(() => { try { sock.terminate(); } catch { /* */ } done(null); }, UPSTREAM_OPEN_MS);
      sock.on('open', () => {
        sock.send(JSON.stringify(upstreamSessionConfig({ transcribeModel: d.config.OPENAI_STT_MODEL, language, voice: d.config.OPENAI_TTS_VOICE })));
        done({
          send: (ev) => { if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(ev)); },
          close: () => { try { sock.close(); } catch { /* */ } },
        });
      });
      sock.on('message', (raw) => { let ev: unknown; try { ev = JSON.parse(raw.toString()); } catch { return; } onEvent(ev); });
      sock.on('error', (e) => { log.warn({ err: (e as Error).message }, 'upstream error'); done(null); });
      sock.on('close', () => { if (settled) onClose(); else done(null); });
    });
  }

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let path = '';
    try { path = new URL(req.url ?? '', 'http://x').pathname; } catch { /* malformed */ }
    if (path !== REALTIME_PATH) return; // other upgrade handlers (none today) may take it
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });
  server.on('close', () => wss.close());

  function onConnection(ws: WebSocket) {
    const id = randomUUID().slice(0, 8);
    const clog = log.child({ conn: id });
    let admittedUser: string | null = null;
    let lang = 'en';
    let relay: ReturnType<typeof createRelay>;

    const sendJson = (m: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    const deps: RelayDeps = {
      send: sendJson,
      authenticate,
      async openSession(userId, sessionId) {
        try {
          const s = await d.conversation.ownedSession(userId, sessionId);
          if (s.status !== 'ACTIVE') return null;
          lang = s.language; return { language: s.language };
        } catch { return null; }
      },
      admit(userId) {
        const n = open.get(userId) ?? 0;
        if (n >= MAX_PER_USER) return false;
        open.set(userId, n + 1); admittedUser = userId; return true;
      },
      connectUpstream: (s) => openUpstream(s.language, (ev) => relay.onUpstream(ev), () => relay.onUpstreamClose()),
      async converse(i) {
        const r = await d.conversation.send({ userId: i.userId, sessionId: i.sessionId, text: i.text, signal: i.signal, onDelta: i.onDelta });
        return r.message.content;
      },
      async crisis(i) {
        // conversationService.send re-checks, never calls the model for HIGH/IMMINENT, persists only the fixed reply and a content-free
        // safety event. If it cannot (e.g. consent withdrawn), the fixed text is still spoken.
        try { return (await d.conversation.send({ userId: i.userId, sessionId: i.sessionId, text: i.text })).message.content; }
        catch {
          const resources = await getResources(d.db, null).catch(() => []);
          return crisisMessage(i.severity, pickLang(lang, i.text), resources);
        }
      },
      log: (event, fields) => clog.info(fields ?? {}, event), // never contains transcripts or replies
    };
    relay = createRelay(deps);

    let idle: ReturnType<typeof setTimeout>;
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { sendJson({ type: 'error', code: 'IDLE_TIMEOUT', message: 'Connection idle' }); ws.close(1000); }, IDLE_MS); };
    const hello = setTimeout(() => { if (relay.state === 'awaiting_auth') { sendJson({ type: 'error', code: 'UNAUTHORIZED', message: 'No credentials' }); ws.close(1008); } }, HELLO_DEADLINE_MS);
    const maxCall = setTimeout(() => ws.close(1000), MAX_CALL_MS);
    bump();
    clog.info('connected');

    ws.on('message', (raw, isBinary) => {
      bump();
      if (isBinary) { sendJson({ type: 'error', code: 'BAD_MESSAGE', message: 'Text frames only' }); return; }
      void relay.onClient(raw.toString()).then(() => { if (relay.state === 'closed' && ws.readyState === WebSocket.OPEN) ws.close(1000); });
    });
    const cleanup = () => {
      clearTimeout(idle); clearTimeout(hello); clearTimeout(maxCall);
      relay.close('socket_closed');
      if (admittedUser) { const n = (open.get(admittedUser) ?? 1) - 1; if (n <= 0) open.delete(admittedUser); else open.set(admittedUser, n); admittedUser = null; }
      clog.info('disconnected');
    };
    ws.on('close', cleanup);
    ws.on('error', (e) => clog.warn({ err: (e as Error).message }, 'socket error'));
  }
}
