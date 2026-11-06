import { describe, expect, it, vi } from 'vitest';
import { socraticSoulMirror } from '../services/kaizenAiService.js';
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
});
