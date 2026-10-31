import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useSettings } from '../store/settings';
import { clearAnalyticsQueue } from '../utils/analytics';

export const SUGGESTION_LEVELS = ['OFTEN', 'SOMETIMES', 'RARELY', 'NEVER'] as const;
export type SuggestionLevel = (typeof SUGGESTION_LEVELS)[number];
/** GET/PUT /me/ai-settings. The level is stored server-side under `suggestionLevel` (default SOMETIMES); analytics are off by default. */
export interface AiSettings { suggestionLevel: SuggestionLevel; analyticsOptIn: boolean; levels?: string[] }

export const useAiSettings = () => useQuery({ queryKey: ['ai-settings'], queryFn: () => api<AiSettings>('/me/ai-settings') });

/** Writes the analytics choice to BOTH the local setting and the server flag (the server drops events unless its own flag is true). */
export function useAnalyticsOptIn() {
  const q = useAiSettings();
  const save = useSaveAiSettings();
  const local = useSettings((s) => s.analyticsOptIn);
  const setSettings = useSettings((s) => s.set);
  const value = typeof q.data?.analyticsOptIn === 'boolean' ? q.data.analyticsOptIn : local;
  const set = (v: boolean) => {
    setSettings({ analyticsOptIn: v });
    if (!v) clearAnalyticsQueue();
    save.mutate({ analyticsOptIn: v }, { onError: () => { /* local choice kept; server flag retried on the next change */ } });
  };
  return { value, set, failed: save.isError };
}

export function useSaveAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<AiSettings, 'suggestionLevel' | 'analyticsOptIn'>>) => api<AiSettings>('/me/ai-settings', { method: 'PUT', body: patch }),
    onSuccess: (data) => {
      qc.setQueryData(['ai-settings'], data);
      // A different level changes what Today and the action menu show.
      void qc.invalidateQueries({ queryKey: ['today'] }); void qc.invalidateQueries({ queryKey: ['actions'] }); void qc.invalidateQueries({ queryKey: ['privacy-ai-data'] });
    },
  });
}

/** GET /privacy/ai-data. Keys are NOT localized text: the screen maps each one to its own plain-language line and tolerates unknown ones. */
export interface AiDataConsent { type: string; granted: boolean; grantedAt: string | null; covers: string[]; features: string[] }
export interface AiDataFeature { key: string; usesModel: boolean; consent: string | null; data: string[]; allowed: boolean }
export interface AiData {
  consents: AiDataConsent[]; features: AiDataFeature[]; neverSent: string[];
  suggestionLevel?: SuggestionLevel; analyticsOptIn?: boolean; links?: { privacy?: string };
}
export const useAiData = () => useQuery({ queryKey: ['privacy-ai-data'], queryFn: () => api<AiData>('/privacy/ai-data') });
