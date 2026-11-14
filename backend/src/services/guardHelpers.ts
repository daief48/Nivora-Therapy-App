import { AppError } from '../utils/errors.js';
import type { GuardScope } from './crisisResponse.js';

export const SAFETY_CHECK_UNAVAILABLE = 'SAFETY_CHECK_UNAVAILABLE';

/** Required free text (a program title / goal, a session goal, a goal title) cannot be stored while the safety classifier is down: nothing is saved. */
export const safetyCheckUnavailable = () =>
  new AppError(503, SAFETY_CHECK_UNAVAILABLE, "We couldn't check that safely just now, so nothing was saved. Please try again in a little while.");

/** The body for text that IS the point of an endpoint (a cue, an anchor): a gentle 200, nothing stored. */
export const SAFETY_CHECK_NOT_SAVED = { saved: false as const, reason: SAFETY_CHECK_UNAVAILABLE };

type Track = (event: string, data?: Record<string, string | number | boolean>) => void;

/** guardInput options with a content-free telemetry hook (event name + coarse codes only; never text). Telemetry never breaks a request. */
export function guardOpts(d: { telemetry?: { track(userId: string, name: string, props?: Record<string, string | number | boolean>): Promise<void> } }, userId: string, scope?: GuardScope): { scope?: GuardScope; track: Track } {
  return { ...(scope ? { scope } : {}), track: (event, data) => { try { void d.telemetry?.track(userId, event, data).catch(() => undefined); } catch { /* best effort */ } } };
}
