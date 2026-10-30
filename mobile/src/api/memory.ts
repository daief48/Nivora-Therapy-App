import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface MemoryEntry { id: string; text: string; source?: 'USER' | 'SESSION'; kind?: string; createdAt?: string }
export interface MemoryOverview {
  pinned: { id: string; text: string }[];
  recent: { id: string; text: string; createdAt?: string }[];
  themes: { id: string; label: string; count: number }[];
  counts: { session: number; user: number; notes: number };
}
export interface MemoryPrefs { continuityOptIn?: boolean; qualityReviewOptIn?: boolean; guidedAck?: boolean }

/** Memory is ON unless the stored preference says otherwise (never stored => ON, same as sign-up). */
export const memoryOn = (p?: MemoryPrefs | null) => p?.continuityOptIn !== false;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const useMemoryPrefs = () => useQuery({ queryKey: ['therapy', 'prefs'], queryFn: () => api<MemoryPrefs>('/therapy/preferences') });

export const useMemoryOverview = () => useQuery({
  queryKey: ['memories', 'overview'],
  queryFn: async (): Promise<MemoryOverview> => {
    const o = (await api<Partial<MemoryOverview>>('/therapy/memory-overview')) ?? {};
    return {
      pinned: arr(o.pinned), recent: arr(o.recent), themes: arr(o.themes),
      counts: { session: o.counts?.session ?? 0, user: o.counts?.user ?? 0, notes: o.counts?.notes ?? 0 },
    };
  },
});

export const useUserMemories = () => useQuery({
  queryKey: ['memories', 'user'],
  queryFn: async () => arr<MemoryEntry>(await api('/memories?source=USER')).filter((m) => !m.source || m.source === 'USER'),
});

/** Runs a memory change, then refreshes everything memory- and session-related. */
export function useMemoryMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['memories'] }); void qc.invalidateQueries({ queryKey: ['therapy'] }); },
  });
}

export const setContinuity = (prefs: MemoryPrefs | undefined, on: boolean) =>
  api<MemoryPrefs>('/therapy/preferences', {
    method: 'PUT',
    body: { continuityOptIn: on, qualityReviewOptIn: !!prefs?.qualityReviewOptIn, guidedAck: !!prefs?.guidedAck },
  });
export const addMemory = (text: string) => api('/memories', { method: 'POST', body: { text } });
export const editMemory = (v: { id: string; text: string }) => api(`/memories/${v.id}`, { method: 'PATCH', body: { text: v.text } });
export const deleteMemory = (id: string) => api(`/memories/${id}`, { method: 'DELETE' });
export const forgetLearned = () => api('/memories?source=SESSION', { method: 'DELETE' });
