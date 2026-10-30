import type { Deps } from '../modules/deps.js';
import { finalizeSession } from './sessionSummarizer.js';

const SWEEP_MS = 5 * 60_000;
const IDLE_MS = 20 * 60_000;
let sweeping = false;

/** Finalizes idle ACTIVE sessions (>=2 messages) and ENDED sessions that never got a note. Safe against overlapping runs. Returns the number handled. */
export async function runIdleSweep(d: Pick<Deps, 'db' | 'glm' | 'cipher'>, now = new Date()): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  try {
    const cutoff = new Date(now.getTime() - IDLE_MS);
    const idle = await d.db.therapySession.findMany({
      where: { finalizedAt: null, status: 'ACTIVE', lastActivityAt: { lt: cutoff }, messages: { some: {} } }, select: { id: true }, take: 50,
    });
    const ended = await d.db.therapySession.findMany({ where: { finalizedAt: null, status: 'ENDED' }, select: { id: true }, take: 50 });
    for (const s of idle) await finalizeSession(d, s.id, 'IDLE'); // <2 messages: closes the session without a note
    for (const s of ended) await finalizeSession(d, s.id, 'USER_END');
    return idle.length + ended.length;
  } finally { sweeping = false; }
}

/** Starts background timers (idle-session finalizer). Cheap, unref'd. Returns a stop function. */
export function startBackgroundJobs(d: Deps): () => void {
  const t = setInterval(() => { runIdleSweep(d).catch((e) => d.logger.warn({ err: e }, 'idle sweep failed')); }, SWEEP_MS);
  t.unref();
  return () => clearInterval(t);
}
