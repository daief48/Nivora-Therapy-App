import { describe, expect, it, vi } from 'vitest';
import { socraticSoulMirror, coachGoalSetup, coachPdcaCheckIn } from '../services/kaizenAiService.js';
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
  describe('Socratic Soul Mirror (socraticSoulMirror)', () => {
    it('returns collaborative, non-diagnostic Socratic inquiry', async () => {
      const glm = mockGlm('It makes sense that sleep feels far away right now. When you notice your mind racing, is that thought an inescapable rule or just tired thoughts drifting by? What would happen if you gave yourself permission to just rest without having to sleep?');
      const res = await socraticSoulMirror(glm, {
        lessonContext: 'Day 3: Sleep hygiene and racing thoughts',
        userDoubt: "I'll never fall asleep tonight",
        locale: 'en',
      });

      expect(res.reply).toContain('sleep feels far away');
    });

    it('falls back to a warm reply on failure', async () => {
      const glm = failingGlm();
      const res = await socraticSoulMirror(glm, { userDoubt: 'I doubt myself', locale: 'en' });

      expect(res.reply).toContain('understandable doubt');
    });
  });

  describe('AI Goal Coach setup (coachGoalSetup)', () => {
    it('parses a refined micro-goal from the model', async () => {
      const glm = mockGlm(JSON.stringify({
        refinedTitle: 'Calm Mornings',
        whyItMatters: 'Starting small keeps the day kind to your mind.',
        starterActionTitle: 'Two slow breaths by the window',
        starterActionDescription: 'Stand by the window and let two slow breaths out.',
        estimatedMinutes: 2,
        category: 'BREATHING',
      }));
      const res = await coachGoalSetup(glm, { rawGoal: 'I want to stop overthinking', availableTimeMin: 5, locale: 'en' });

      expect(res.refinedTitle).toBe('Calm Mornings');
      expect(res.estimatedMinutes).toBe(2);
      expect(res.category).toBe('BREATHING');
    });

    it('falls back to the curated starter goal when the model fails', async () => {
      const res = await coachGoalSetup(failingGlm(), { rawGoal: 'read more', locale: 'en' });

      expect(res.refinedTitle).toBe('Daily Calm & Steady Rest');
      expect(res.category).toBe('BREATHING');
    });
  });

  describe('AI Goal Coach PDCA check-in (coachPdcaCheckIn)', () => {
    it('parses the reflection and next step, defaulting skipped to SIMPLIFY', async () => {
      const glm = mockGlm(JSON.stringify({
        reflection: 'You showed up today, and that is the whole practice.',
        nextActionTitle: 'One gentle breath before breakfast',
        nextActionDescription: 'Pause for one slow exhale before your first sip.',
      }));
      const res = await coachPdcaCheckIn(glm, { goalTitle: 'Calm Mornings', actionTitle: 'Two breaths', status: 'SKIPPED', locale: 'en' });

      expect(res.reflection).toContain('showed up today');
      expect(res.adjustment).toBe('SIMPLIFY');
    });

    it('falls back to the no-blame check-in when the model fails', async () => {
      const res = await coachPdcaCheckIn(failingGlm(), { goalTitle: 'Calm Mornings', actionTitle: 'Two breaths', status: 'DONE', locale: 'en' });

      expect(res.adjustment).toBe('STEADY');
      expect(res.nextActionTitle).toBeTruthy();
    });
  });
});
