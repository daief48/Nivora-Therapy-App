import type { ActionDeepLink } from '../api/actions';

/** Routes the action cards may open. Anything else is ignored. */
const KNOWN = new Set(['Exercise', 'JournalEdit', 'Routine', 'Sounds', 'SafetyPlan', 'Emergency', 'Tabs', 'ActionWalk', 'ActionGratitude', 'ActionReachOut']);
const EXERCISES = new Set(['thought', 'balanced', 'grounding', 'breathing', 'daily', 'sleep', 'goal', 'next']);

export interface ResolvedLink { route: string; params?: Record<string, unknown> }

/** Pure mapping from a backend deep link to a mobile route (null = unknown, do nothing). */
export function mapActionLink(link: ActionDeepLink | null | undefined): ResolvedLink | null {
  if (!link || typeof link.route !== 'string' || !KNOWN.has(link.route)) return null;
  const p = (link.params ?? {}) as Record<string, unknown>;
  switch (link.route) {
    case 'Exercise': {
      const kind = String(p.kind ?? '');
      if (kind === 'gratitude') return { route: 'ActionGratitude' }; // not an ExerciseKind: it has its own one-field screen
      return EXERCISES.has(kind) ? { route: 'Exercise', params: { kind } } : null;
    }
    case 'Tabs': {
      if (typeof p.screen !== 'string') return null;
      return { route: 'Tabs', params: { screen: p.screen, ...(typeof p.weekday === 'number' ? { params: { weekday: p.weekday } } : {}) } };
    }
    case 'ActionReachOut': return p.support ? { route: 'ActionReachOut', params: { support: true } } : { route: 'ActionReachOut' };
    case 'JournalEdit': return p.mode === 'voice' ? { route: 'JournalEdit', params: { mode: 'voice' } } : { route: 'JournalEdit' };
    default: return { route: link.route };
  }
}

/** Opens the target of an action card. Unknown routes do nothing. Callers decide when: it must never be used to leave an active call by itself. */
export function resolveActionLink(nav: { navigate: (...a: any[]) => void }, link: ActionDeepLink): void {
  const r = mapActionLink(link);
  if (!r) return;
  try {
    if (r.params) nav.navigate(r.route, r.params); else nav.navigate(r.route);
  } catch { /* a route that is not registered must never crash the screen */ }
}
