import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CrisisPayload } from './practice';

export type ActionDeepLink = { route: string; params?: Record<string, unknown> };
export type ActionOutcome = 'ACCEPTED' | 'DISMISSED' | 'THUMBS_UP' | 'THUMBS_DOWN';
export type ActionSurface = 'CHAT' | 'CALL' | 'TODAY' | 'INSIGHTS' | 'SESSION_CLOSE' | 'WEEKLY' | 'MONTHLY';

/** One in-app action the person may try. `title`, `why`, `reason`, `cta` and `notNow` are ready, localized text from the server. */
export interface ActionCardData {
  offerId: string | null; id: string; kind: string; crisis: boolean; minutes: number;
  deepLink: ActionDeepLink; surface: ActionSurface | string;
  title: string; why: string; reason: string; cta: string; notNow: string;
  titleKey: string; whyKey: string; reasonKey: string;
}

export interface ActionOutcomeResult { offerId: string | null; actionId: string; outcome: ActionOutcome; feedback: unknown; kaizen: unknown | null }
export interface ActionMenu { riskMode: boolean; suggestionLevel: string; note: string; actions: ActionCardData[] }

/** Always post an outcome when the person acts on or dismisses a card (reading a menu records nothing). `idOrOfferId` is the offerId when the card has one, else the action id. */
export const postActionOutcome = (idOrOfferId: string, body: { outcome: ActionOutcome; surface?: string; saveToKaizen?: boolean }) =>
  api<ActionOutcomeResult>(`/actions/${encodeURIComponent(idOrOfferId)}/outcome`, { method: 'POST', body });

export const getActionMenu = (context: string, opts?: { tags?: string[]; limit?: number }) => {
  const q = new URLSearchParams({ context });
  if (opts?.tags?.length) q.set('tags', opts.tags.join(','));
  if (opts?.limit) q.set('limit', String(opts.limit));
  return api<ActionMenu>(`/actions/menu?${q.toString()}`);
};

export const useActionMenu = (context: string, opts?: { tags?: string[]; limit?: number; enabled?: boolean }) =>
  useQuery({ queryKey: ['actions', 'menu', context, opts?.tags?.join(',') ?? '', opts?.limit ?? 0], enabled: opts?.enabled ?? true, queryFn: () => getActionMenu(context, opts) });

export function useActionOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { idOrOfferId: string; outcome: ActionOutcome; surface?: string; saveToKaizen?: boolean }) =>
      postActionOutcome(v.idOrOfferId, { outcome: v.outcome, ...(v.surface ? { surface: v.surface } : {}), ...(v.saveToKaizen ? { saveToKaizen: true } : {}) }),
    onSuccess: (_r, v) => { if (v.saveToKaizen) void qc.invalidateQueries({ queryKey: ['kaizen'] }); },
  });
}

/** The id to post an outcome against: the offer when the card was offered in a surface, else the action id. */
export const outcomeIdOf = (card: Pick<ActionCardData, 'offerId' | 'id'>) => card.offerId ?? card.id;

// ---- walk / small pleasant activity ----
export interface WalkChoice { key: string; minutes: number; label: string }
export interface StepView { id: string; goalId?: string; date?: string; title: string; description?: string; targetValue?: number; unit?: string; status: string; source?: string }
export type WalkResult = CrisisPayload | { crisis: false; created: boolean; alreadyDone: boolean; action: StepView; flowers: number };
export const getWalkChoices = () => api<{ choices: WalkChoice[] }>('/actions/walk');
export const postWalk = (body: { choice?: string; text?: string; minutes?: number }) => api<WalkResult>('/actions/walk', { method: 'POST', body });
export const useWalkChoices = () => useQuery({ queryKey: ['actions', 'walk'], queryFn: getWalkChoices });

// ---- gratitude note ----
export type GratitudeResult = CrisisPayload | { crisis: false; entry: { id: string; entryType: 'GRATITUDE'; createdAt: string } };
export const postGratitude = (text: string) => api<GratitudeResult>('/actions/gratitude', { method: 'POST', body: { text } });

// ---- reach out (nothing is ever sent by the app) ----
export interface ReachContact { id: string; name: string; relation: string | null; phone: string; drafts: string[] }
export interface ReachOut { contacts: ReachContact[]; templates: string[]; sent: false; hasContacts: boolean }
export const getReachOut = () => api<ReachOut>('/actions/reach-out');
export const useReachOut = () => useQuery({ queryKey: ['actions', 'reach-out'], queryFn: getReachOut });

// ---- end of session ----
export interface SessionClose { prompt: string; riskMode: boolean; action: ActionCardData | null; saveToKaizenOnAccept?: boolean; support: ActionCardData[] }
export const postSessionClose = (sessionId: string) => api<SessionClose>('/actions/session-close', { method: 'POST', body: { sessionId } });
