import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Resource } from './types';

export type Instrument = 'PHQ9' | 'GAD7' | 'AUDIT';
export interface L10n { en: string; bn: string }
export interface InstrumentDef {
  id: Instrument; title: L10n; intro: L10n; timeframe: L10n; maxScore: number; attribution: L10n;
  items: { text: L10n; options: { value: number; label: L10n }[] }[];
}
export interface AssessmentRow { id: string; instrument: Instrument; total: number; severity: string; createdAt: string }
export interface SubmitResult extends AssessmentRow { item9Flag: boolean; resources: Resource[] }

/** The app shows en for everything except Bangla; hi/ne fall back to en until a reviewed translation exists. */
export const pick = (l: L10n, lang: string) => (lang === 'bn' ? l.bn : l.en);
export const RETAKE_DAYS = 30;
export const isDue = (iso?: string | null, now = Date.now()) => !iso || now - new Date(iso).getTime() > RETAKE_DAYS * 86_400_000;

export const useInstruments = () => useQuery({ queryKey: ['assessments', 'instruments'], queryFn: () => api<InstrumentDef[]>('/assessments/instruments'), staleTime: Infinity });
export const useAssessments = () => useQuery({ queryKey: ['assessments', 'history'], queryFn: async () => (await api<AssessmentRow[]>('/assessments?limit=200')) ?? [] });

export function useSubmitAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { instrument: Instrument; answers: number[] }) => api<SubmitResult>('/assessments', { method: 'POST', body: v }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assessments', 'history'] }); },
  });
}
