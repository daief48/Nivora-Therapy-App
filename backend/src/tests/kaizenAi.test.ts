import { describe, expect, it, vi } from 'vitest';
import {
  alchemizeAction,
  generateSoulWeather,
  writePlantChronicle,
  generateOmikuji,
  socraticSoulMirror,
} from '../services/kaizenAiService.js';
import type { GlmClient } from '../services/glmClient.js';

function mockGlm(response: string): GlmClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: response,
      inputTokens: 10,
      outputTokens: 20,
    }),
    stream: vi.fn(),
  };
}

function failingGlm(): GlmClient {
  return {
    chat: vi.fn().mockRejectedValue(new Error('Provider timeout')),
    stream: vi.fn(),
  };
}

describe('Kaizen AI Service', () => {
  describe('FEATURE 1: The Energy Alchemist (alchemizeAction)', () => {
    it('successfully extracts atomic micro-ritual in bed from LLM response', async () => {
      const glm = mockGlm('Title: Pillow Exhale & Foot Relax\nDescription: Lie gently in bed and exhale into your pillow. Wiggle toes softly.\nSeconds: 25');
      const res = await alchemizeAction(glm, { category: 'BREATHING', energyLevel: 'LOW', locale: 'en' });

      expect(res.title).toBe('Pillow Exhale & Foot Relax');
      expect(res.description).toContain('Lie gently in bed');
      expect(res.durationSec).toBe(25);
    });

    it('falls back gracefully to curated static ritual on LLM failure', async () => {
      const glm = failingGlm();
      const res = await alchemizeAction(glm, { category: 'BREATHING', energyLevel: 'LOW', locale: 'bn' });

      expect(res.title).toContain('শ্বাস');
      expect(res.description).toBeTruthy();
      expect(res.durationSec).toBeGreaterThanOrEqual(15);
    });
  });

  describe('FEATURE 2: Soul Weather to Action (generateSoulWeather)', () => {
    it('parses valid JSON soul weather validation and sensory ritual', async () => {
      const glm = mockGlm(JSON.stringify({
        validation: 'A heavy morning fog lingers, but the quiet air holds space for you.',
        ritualTitle: 'Warm Cup Grounding',
        ritualStep: 'Cup your palms around a warm glass of water. Feel the soothing heat.',
      }));
      const res = await generateSoulWeather(glm, { emojis: ['🌧️', '💔'], locale: 'en' });

      expect(res.validation).toContain('heavy morning fog');
      expect(res.ritualTitle).toBe('Warm Cup Grounding');
      expect(res.ritualStep).toContain('warm glass');
    });

    it('uses empathetic fallback when JSON is malformed or throws', async () => {
      const glm = mockGlm('Not a json response');
      const res = await generateSoulWeather(glm, { emojis: ['🌧️'], locale: 'bn' });

      expect(res.validation).toBeTruthy();
      expect(res.ritualTitle).toBeTruthy();
      expect(res.ritualStep).toBeTruthy();
    });
  });

  describe('FEATURE 3: The Living Zen Chronicle (writePlantChronicle)', () => {
    it('extracts letter and 3-line haiku from plant perspective', async () => {
      const glm = mockGlm(`Letter: Dear friend, you visited me even when you were exhausted. Every gentle breath gives me life. I am growing with you in stillness.
Haiku:
Quiet green leaves rise,
Reaching for the morning sun,
Peace blooms in your heart.`);

      const res = await writePlantChronicle(glm, { stage: 'sprout', locale: 'en' });

      expect(res.letter).toContain('Dear friend');
      expect(res.haiku).toContain('Quiet green leaves rise');
    });

    it('returns poetic fallback if LLM times out', async () => {
      const glm = failingGlm();
      const res = await writePlantChronicle(glm, { stage: 'bud', locale: 'bn' });

      expect(res.letter).toContain('প্রিয় বন্ধু');
      expect(res.haiku).toContain('সবুজ পাতা');
    });
  });

  describe('FEATURE 4: Socratic Soul Mirror (socraticSoulMirror)', () => {
    it('returns collaborative, non-diagnostic Socratic inquiry', async () => {
      const glm = mockGlm('It makes sense that sleep feels far away right now. When you notice your mind racing, is that thought an inescapable rule or just tired thoughts drifting by? What would happen if you gave yourself permission to just rest without having to sleep?');
      const res = await socraticSoulMirror(glm, {
        lessonContext: 'Day 3: Sleep hygiene and racing thoughts',
        userDoubt: "I'll never fall asleep tonight",
        locale: 'en',
      });

      expect(res.reply).toContain('sleep feels far away');
    });

    it('falls back to warm peer-tutor question on failure', async () => {
      const glm = failingGlm();
      const res = await socraticSoulMirror(glm, { userDoubt: 'আমি কিছুই পারছি না', locale: 'bn' });

      expect(res.reply).toContain('আজকের পাঠের আলোকে ভাবুন তো');
    });
  });

  describe('FEATURE 5: Zen Omikuji (generateOmikuji)', () => {
    it('returns 1-sentence contemplative fortune for completed action', async () => {
      const glm = mockGlm('"A river shapes the stone not by force, but by quiet persistence."');
      const res = await generateOmikuji(glm, {
        completedActionTitle: 'Two deep breaths',
        completionStreak: 5,
        locale: 'en',
      });

      expect(res.omikuji).toBe('A river shapes the stone not by force, but by quiet persistence.');
      expect(res.blessingType).toBe('SERENITY');
    });

    it('picks from curated proverb pool on fallback', async () => {
      const glm = failingGlm();
      const res = await generateOmikuji(glm, { locale: 'bn' });

      expect(res.omikuji).toBeTruthy();
      expect(res.blessingType).toBe('PEACE');
    });
  });
});

