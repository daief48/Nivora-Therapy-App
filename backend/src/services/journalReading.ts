import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import { ACTION_COPY, pick, reasonText, STEP_TITLE } from './actionCopy.js';
import { stepForFeelings } from './actionMenu.js';
import type { EmotionWords } from './journalEmotions.js';
import { assessSafely } from './safetyService.js';

/**
 * Emotion Reading saved with its journal entry, including the "2-minute step": a tiny Kaizen action chosen by simple rules from the feeling
 * words (tired -> rest, anxious / angry -> breathing, grateful -> a gratitude note, lonely -> reach out, otherwise just notice how you feel).
 * Derived from journal text, so everything here needs JOURNAL_AI_SHARING (the callers have checked it) and is skipped for any text that
 * raised a safety level. The saved JSON is encrypted with the app cipher like the entry itself.
 */
export const STEP_MINUTES = 2;
export interface ReadingStep {
  actionId: string; category: string; minutes: number; unit: 'minutes'; title: string; why: string; reason: string; reasonKey: 'journal_step';
}
export interface SavedReading extends EmotionWords { step: ReadingStep | null }

/** null when the text raised any safety level (ELEVATED or higher): such entries get no step at all. */
export function buildStep(words: string[], text: string, locale?: string | null): ReadingStep | null {
  if (assessSafely(text).severity !== 'NONE') return null;
  const { actionId, category } = stepForFeelings(words, text);
  return {
    actionId, category, minutes: STEP_MINUTES, unit: 'minutes',
    title: pick(STEP_TITLE[category] ?? STEP_TITLE.SELF_OBSERVATION!, locale).replace('{n}', String(STEP_MINUTES)),
    why: ACTION_COPY[actionId] ? pick(ACTION_COPY[actionId]!.why, locale) : '',
    reason: reasonText('journal_step', locale), reasonKey: 'journal_step',
  };
}

export async function saveReading(db: Db, cipher: Cipher, userId: string, entryId: string, reading: SavedReading): Promise<boolean> {
  const done = await db.journalEntry.updateMany({ where: { id: entryId, userId, deletedAt: null }, data: { emotionEncrypted: cipher.encrypt(JSON.stringify(reading)) } });
  return done.count > 0;
}

export function readReading(cipher: Cipher, enc: string | null | undefined): SavedReading | null {
  if (!enc) return null;
  try { return JSON.parse(cipher.decrypt(enc)) as SavedReading; } catch { return null; }
}
