import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export const TOPIC_KINDS = ['ADDICTION', 'DEPRESSION', 'ANXIETY', 'RELATIONSHIP', 'SLEEP', 'GRIEF', 'OTHER'] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];
/** The topic as embedded in session payloads. */
export interface TopicRef { id: string; kind: TopicKind; label: string | null }
export interface Topic extends TopicRef { createdAt: string; sessionCount: number; lastSessionAt: string | null }
export interface TopicSession {
  id: string; sessionType: 'TEXT' | 'VOICE'; status: string; startedAt: string; endedAt: string | null; durationMin: number | null;
  moodBefore: number | null; moodAfter: number | null; summary: string | null; messageCount: number;
}
export interface TopicSessions { topic: Topic; sessions: TopicSession[] }

export const useTopics = () => useQuery({ queryKey: ['topics'], queryFn: () => api<Topic[]>('/topics') });
export const useTopicSessions = (id?: string) => useQuery({
  queryKey: ['topics', 'sessions', id], enabled: !!id, queryFn: () => api<TopicSessions>(`/topics/${id}/sessions`),
});

export const createTopic = (b: { kind: TopicKind; label?: string }) => api<Topic>('/topics', { method: 'POST', body: b });
export const deleteTopic = (id: string, deleteSessions: boolean) => api(`/topics/${id}?deleteSessions=${deleteSessions}`, { method: 'DELETE' });

/** Mutation that refreshes topics and the session lists afterwards (counts change when sessions move or go). */
export function useTopicMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['topics'] }); void qc.invalidateQueries({ queryKey: ['therapy'] }); },
  });
}

/** Display name of a topic: the custom label for OTHER, else the localized preset name (pass the t() lookup). */
export const topicName = (topic: Pick<TopicRef, 'kind' | 'label'>, kindName: (k: TopicKind) => string) =>
  topic.kind === 'OTHER' && topic.label ? topic.label : kindName(topic.kind);
