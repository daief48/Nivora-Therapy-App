import { describe, expect, it } from 'vitest';
import { assessSafely } from '../services/safetyService.js';

// Review finding A1: a negator anywhere in the previous ~24 chars (commas included) used to downgrade HIGH to ELEVATED.
const CASES: [string, 'ELEVATED' | 'HIGH' | 'IMMINENT'][] = [
  ["I'm not okay, I want to kill myself", 'HIGH'],
  ["I'm not okay, I want to kill myself tonight", 'IMMINENT'],
  ['never mind, I want to kill myself tonight', 'IMMINENT'],
  ["It's not working, I want to end my life", 'HIGH'],
  ["I'm not sleeping, I want to die", 'HIGH'],
  ["I'm not sleeping I want to die", 'HIGH'],
  ['I would never kill myself but I want to die', 'HIGH'],
  ["I don't want to kill myself, but I do want to die", 'HIGH'],
  ['I have not slept. I want to kill myself', 'HIGH'],
  ['I am not suicidal tonight, I have pills', 'IMMINENT'],
  // genuinely negated statements stay a downgrade
  ["I don't want to kill myself", 'ELEVATED'],
  ['I would never kill myself', 'ELEVATED'],
  ["I'm not going to hurt myself", 'ELEVATED'],
  ["I'm not suicidal, just very tired", 'ELEVATED'],
  ['I do not want to die', 'ELEVATED'],
  // Bangla / Hindi / Nepali negate after the verb: never downgraded
  ['আমি মরতে চাই না', 'HIGH'],
  ['আমি আর বাঁচতে চাই না', 'HIGH'],
  ['আমি ঠিক নেই, আমি আত্মহত্যা করতে চাই', 'HIGH'],
  ['मैं ठीक नहीं हूँ, मुझे मर जाना है', 'HIGH'],
  ['मलाई ठिक छैन, म मर्न चाहन्छु', 'HIGH'],
];

describe('negation downgrade only when the negator directly governs the phrase', () => {
  for (const [text, expected] of CASES) it(text, () => expect(assessSafely(text).severity).toBe(expected));
});
