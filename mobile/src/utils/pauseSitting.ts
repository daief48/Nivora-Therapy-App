import { StackActions } from '@react-navigation/native';
import { api } from '../api/client';
import { minutesLeft } from '../api/sessionPrograms';
import type { Nav } from '../navigation/types';

interface EndResult { status?: string; paused?: boolean; remainingSec?: number | null }
const WAIT_MS = 2500;

/**
 * Leaves a program sitting WITHOUT finishing it: asks the server to end it without force (best effort; a program sitting with time left stays open),
 * then opens the program page with a gentle "saved" line. Never opens the summary unless the server really closed the sitting (time used up).
 */
export async function pauseSitting(nav: Pick<Nav, 'dispatch' | 'goBack'>, o: { sessionId?: string; programId?: string; leftSec?: number | null }): Promise<void> {
  let res: EndResult | undefined;
  if (o.sessionId) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      res = await Promise.race([
        api<EndResult>(`/sessions/${o.sessionId}/end`, { method: 'POST', body: { summarize: false, force: false } }),
        new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), WAIT_MS); }),
      ]);
    } catch { /* leaving never depends on the request */ } finally { if (timer) clearTimeout(timer); }
  }
  if (res?.status === 'ENDED' && res.paused !== true && o.sessionId) { // the server closed it (time used up): that really is a finished sitting
    nav.dispatch(StackActions.replace('SessionSummary', { sessionId: o.sessionId, ...(o.programId ? { programId: o.programId } : {}) }));
    return;
  }
  if (!o.programId) { nav.goBack(); return; }
  const sec = res?.remainingSec ?? o.leftSec;
  nav.dispatch(StackActions.replace('ProgramDetail', { programId: o.programId, paused: true, ...(sec != null && sec > 0 ? { savedMin: minutesLeft(sec) } : {}) }));
}
