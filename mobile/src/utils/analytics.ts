import { api } from '../api/client';
import { useSettings } from '../store/settings';

// Opt-in, privacy-friendly analytics. Only event names + small allowlisted props are sent; never text the user wrote.
export type AnalyticsProps = Record<string, string | number | boolean>;
interface Ev { name: string; props?: AnalyticsProps }

let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 15_000, MAX_BATCH = 20;

export async function flushAnalytics() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const events = queue.slice(0, 50);
  queue = queue.slice(events.length);
  if (!useSettings.getState().analyticsOptIn) { queue = []; return; }
  try { await api('/analytics/events', { method: 'POST', body: { events } }); } catch { /* best effort, dropped on failure */ }
}

export function track(name: string, props?: AnalyticsProps) {
  if (!useSettings.getState().analyticsOptIn) return;
  queue.push({ name, props });
  if (queue.length >= MAX_BATCH) void flushAnalytics();
  else timer ??= setTimeout(() => { void flushAnalytics(); }, FLUSH_MS);
}

/** Called when the user opts out: discard anything not yet sent. */
export function clearAnalyticsQueue() {
  queue = [];
  if (timer) { clearTimeout(timer); timer = null; }
}
