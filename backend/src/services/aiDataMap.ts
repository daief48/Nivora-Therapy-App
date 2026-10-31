import type { ConsentType } from '../modules/consents/consentService.js';

/**
 * "What the AI sees": which consent covers which data, and which features send what to the model. Plain keys only: the app localizes them
 * (data keys: aiData.<KEY>, feature keys: aiFeature.<key>). Keep this in step with docs/ai-data-flow.md.
 */
export type DataKey =
  | 'VOICE_AUDIO' | 'CHAT_MESSAGES' | 'MEMORIES_AND_SUMMARIES' | 'SHARED_JOURNAL_ENTRY' | 'WELLNESS_SNAPSHOT'
  | 'JOURNAL_TEXT' | 'VOICE_TRANSCRIPT' | 'THOUGHT_RECORD_TEXT' | 'EMOTION_WORDS'
  | 'MOOD_STRESS_NUMBERS' | 'SLEEP_DIARY_NUMBERS' | 'KAIZEN_HISTORY' | 'HEALTH_ACTIVITY_AGGREGATES';

export interface ConsentCoverage { type: ConsentType; covers: DataKey[]; features: string[] }
export const CONSENT_COVERAGE: ConsentCoverage[] = [
  { type: 'JOURNAL_AI_SHARING', covers: ['JOURNAL_TEXT', 'VOICE_TRANSCRIPT', 'THOUGHT_RECORD_TEXT', 'EMOTION_WORDS'], features: ['emotion_words', 'journal_prompts', 'gentler_thought', 'transcript_cleanup', 'journal_kaizen_step'] },
  { type: 'WELLNESS_AI_SHARING', covers: ['MOOD_STRESS_NUMBERS', 'SLEEP_DIARY_NUMBERS', 'KAIZEN_HISTORY'], features: ['sleep_coach', 'daily_analysis', 'kaizen_review', 'weekly_report', 'monthly_summary'] },
  { type: 'HEALTH_IMPORT', covers: ['HEALTH_ACTIVITY_AGGREGATES'], features: ['monthly_summary'] },
];

export interface FeatureFlow { key: string; usesModel: boolean; consent: ConsentType | 'BASE' | null; data: DataKey[] }
export const FEATURE_FLOWS: FeatureFlow[] = [
  { key: 'session_chat', usesModel: true, consent: 'BASE', data: ['CHAT_MESSAGES', 'MEMORIES_AND_SUMMARIES', 'WELLNESS_SNAPSHOT'] },
  { key: 'voice_transcription', usesModel: true, consent: 'BASE', data: ['VOICE_AUDIO'] },
  { key: 'session_chat_shared_entry', usesModel: true, consent: 'JOURNAL_AI_SHARING', data: ['SHARED_JOURNAL_ENTRY'] },
  { key: 'emotion_words', usesModel: true, consent: 'JOURNAL_AI_SHARING', data: ['JOURNAL_TEXT', 'VOICE_TRANSCRIPT'] },
  { key: 'journal_prompts', usesModel: true, consent: 'JOURNAL_AI_SHARING', data: ['MOOD_STRESS_NUMBERS'] },
  { key: 'gentler_thought', usesModel: true, consent: 'JOURNAL_AI_SHARING', data: ['THOUGHT_RECORD_TEXT'] },
  { key: 'sleep_coach', usesModel: true, consent: 'WELLNESS_AI_SHARING', data: ['SLEEP_DIARY_NUMBERS'] },
  { key: 'daily_analysis', usesModel: true, consent: 'WELLNESS_AI_SHARING', data: ['MOOD_STRESS_NUMBERS', 'SLEEP_DIARY_NUMBERS', 'KAIZEN_HISTORY'] },
  { key: 'kaizen_review', usesModel: true, consent: 'WELLNESS_AI_SHARING', data: ['KAIZEN_HISTORY'] },
  { key: 'weekly_report', usesModel: true, consent: 'WELLNESS_AI_SHARING', data: ['MOOD_STRESS_NUMBERS', 'SLEEP_DIARY_NUMBERS', 'KAIZEN_HISTORY'] },
  { key: 'monthly_summary', usesModel: true, consent: 'WELLNESS_AI_SHARING', data: ['MOOD_STRESS_NUMBERS', 'SLEEP_DIARY_NUMBERS', 'KAIZEN_HISTORY', 'HEALTH_ACTIVITY_AGGREGATES'] },
  // Rule-based: computed on the server from the person's own data, no model involved.
  { key: 'action_menu', usesModel: false, consent: null, data: [] },
  { key: 'today_feed', usesModel: false, consent: null, data: [] },
  { key: 'nudges_and_session_invitation', usesModel: false, consent: null, data: [] },
  { key: 'insight_patterns', usesModel: false, consent: null, data: [] },
  { key: 'sleep_routine_steps', usesModel: false, consent: null, data: [] },
];

/** Things that are never sent to the model. */
export const NEVER_SENT = ['PASSWORD', 'TRUSTED_CONTACTS', 'SAFETY_PLAN', 'SLEEP_NOTES', 'KAIZEN_COMMENTS', 'ASSESSMENT_ANSWERS', 'RAW_HEALTH_DATA'] as const;
