import { checkOutput, checkSpokenOutput } from './safetyService.js';

/**
 * Gate for every model-written text in the wellness features: the standard output check plus the stricter medical/honesty guard
 * (no medication advice, no diagnosis, no claiming to be a person). Anything that fails is replaced by a fixed template with ai:false.
 */
export function outputOk(...texts: string[]): boolean {
  const t = texts.filter(Boolean).join('\n');
  return !!t.trim() && checkOutput(t).ok && checkSpokenOutput(t).ok;
}

/** First JSON object in a model reply, or null. */
export function parseJsonObject(raw: string): any | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
