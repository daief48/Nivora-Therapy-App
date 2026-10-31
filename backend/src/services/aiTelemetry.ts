import { createHmac } from 'node:crypto';
import type { Db } from '../config/database.js';
import { anonId } from '../modules/analytics/routes.js';

/**
 * Opt-in, anonymous product events about the AI features: no text, no user id (a daily-rotating salted pseudonym, like POST /analytics/events).
 * Nothing is written unless UserProfile.analyticsOptIn is true. Never throws: telemetry must not break a feature.
 *
 * Event names written here (all props are short codes or numbers):
 *   action_offered / action_accepted / action_dismissed   { kind, surface }
 *   fallback_used                                          { feature }                 a template was used instead of (or because of) the model
 *   model_call                                             { feature, bucket }         one model call; bucket = latency bucket
 *   model_latency is folded into model_call.bucket (lt1s | 1to3s | 3to6s | gt6s)
 */
export type LatencyBucket = 'lt1s' | '1to3s' | '3to6s' | 'gt6s';
export const latencyBucket = (ms: number): LatencyBucket => (ms < 1000 ? 'lt1s' : ms < 3000 ? '1to3s' : ms < 6000 ? '3to6s' : 'gt6s');

/** Features that can make a model call (the vocabulary of `feature` in model_call / fallback_used). */
export const AI_FEATURES = ['session', 'call', 'sleep_coach', 'daily_analysis', 'kaizen_review', 'weekly_report', 'monthly', 'emotion_words', 'journal_prompts', 'gentler_thought'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export interface Telemetry {
  track(userId: string, name: string, props?: Record<string, string | number | boolean>): Promise<void>;
  /** One model call finished (ms = wall time) and whether the template was used. */
  model(userId: string, feature: AiFeature, ms: number, fallback: boolean): Promise<void>;
}

export function createTelemetry(d: { db: Db; secret: string }): Telemetry {
  const track: Telemetry['track'] = async (userId, name, props = {}) => {
    try {
      const prof = await d.db.userProfile.findUnique({ where: { userId }, select: { analyticsOptIn: true } });
      if (!prof?.analyticsOptIn) return;
      const day = new Date().toISOString().slice(0, 10);
      await d.db.analyticsEvent.create({ data: { name, day, anonId: anonId(d.secret, userId, day), propsJson: props } });
    } catch { /* telemetry is best effort */ }
  };
  return {
    track,
    async model(userId, feature, ms, fallback) {
      await track(userId, 'model_call', { feature, bucket: latencyBucket(ms) });
      if (fallback) await track(userId, 'fallback_used', { feature });
    },
  };
}

/** Same secret derivation as the analytics router, so both write comparable pseudonyms. */
export const telemetrySecret = (cfg: { ANALYTICS_SECRET?: string; JWT_ACCESS_SECRET: string }) =>
  cfg.ANALYTICS_SECRET || createHmac('sha256', cfg.JWT_ACCESS_SECRET).update('analytics-secret').digest('hex');
