import { useGuide } from '../guide/guideEngine';
import type { CrisisPayload } from './practice';

/**
 * Text saves (journal, sleep note, mood note, kaizen note/comment) answer HTTP 200 `{crisis:true, safety:{...}}` and store NOTHING when the text
 * shows high risk. This recognises that shape (tolerantly: resources/message may be missing) without throwing on anything else.
 */
export function isCrisisShape(r: unknown): r is CrisisPayload {
  return !!r && typeof r === 'object' && (r as { crisis?: unknown }).crisis === true;
}

/** Returns a normalised CrisisPayload when `r` is the crisis shape (and raises the sticky app-wide guide risk signal), else null. */
export function noteCrisis(r: unknown): CrisisPayload | null {
  if (!isCrisisShape(r)) return null;
  const s = (r as { safety?: Partial<CrisisPayload['safety']> | null }).safety ?? {};
  useGuide.getState().setRiskSource('textsave', true);
  return { crisis: true, safety: { severity: s.severity ?? 'HIGH', crisis: true, resources: Array.isArray(s.resources) ? s.resources : [], message: typeof s.message === 'string' ? s.message : '' } };
}

/** 409 ALREADY_COMPLETED: a step already done stays done. Not an error for the person. */
export const isAlreadyCompleted = (e: unknown) => (e as { code?: string; status?: number } | null)?.code === 'ALREADY_COMPLETED';
