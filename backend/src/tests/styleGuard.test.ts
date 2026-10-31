import { describe, expect, it } from 'vitest';
import { correctiveNote, detectViolations } from '../services/styleGuard.js';
import { THERAPY_EXAMPLES } from '../services/therapyExamples.js';

const codes = (t: string, priorUserTurns = 5) => detectViolations(t, { priorUserTurns });

describe('style guard detector', () => {
  it('passes reflective replies with one question in every language', () => {
    const good = [
      "That sounds really heavy, carrying it all alone. What is the hardest part right now?",
      'আপনি অনেকদিন ধরে একা সামলাচ্ছেন, এটা সত্যিই ক্লান্তিকর। কোন জিনিসটা সবচেয়ে বেশি কষ্ট দিচ্ছে?',
      'आप बहुत थक चुके हैं और कोई सुनने वाला नहीं है। इस वक्त सबसे भारी क्या लग रहा है?',
      'तपाईं धेरै थकित हुनुहुन्छ र कसैले सुनिदिएको छैन। अहिले सबैभन्दा गाह्रो के लाग्छ?',
    ];
    for (const g of good) expect(codes(g), g).toEqual([]);
    for (const g of THERAPY_EXAMPLES) expect(codes(g.good), g.good).toEqual([]);
  });

  it('does not mistake feeling-reflections for definitions', () => {
    expect(codes('That is a lot to carry. It sounds like you feel so alone.')).toEqual([]);
    expect(codes('Your anxiety is a heavy weight right now.')).toEqual([]);
  });

  it('flags definitions', () => {
    expect(codes('Anxiety is a feeling of worry about what might happen.')).toContain('DEFINITION');
    expect(codes('Burnout refers to long-term exhaustion.')).toContain('DEFINITION');
    expect(codes('দুশ্চিন্তা হলো একটি মানসিক অবস্থা।')).toContain('DEFINITION');
    expect(codes('चिंता एक भावना है जो डर से पैदा होती है।')).toContain('DEFINITION');
    expect(codes('चिन्ता एउटा भावना हो जसले डर जगाउँछ।')).toContain('DEFINITION');
  });

  it('flags lists and bullets', () => {
    expect(codes('Try this:\n- breathe\n- walk')).toContain('LIST');
    expect(codes('Some ideas:\n1. Sleep early\n2. Walk')).toContain('LIST');
    expect(codes('১. ঘুমান\n২. হাঁটুন')).toContain('LIST');
    expect(codes('1. सोएँ\n2. टहलें')).toContain('LIST');
  });

  it('flags more than one question, and long replies', () => {
    expect(codes('What happened? How did it feel?')).toContain('MULTI_QUESTION');
    expect(codes('আপনি কেমন আছেন? কী হয়েছে?')).toContain('MULTI_QUESTION');
    expect(codes('One. Two. Three. Four. Five. Six.')).toContain('TOO_LONG');
    expect(codes('One. Two. Three. Four. Five.')).not.toContain('TOO_LONG');
  });

  it('flags filler openers and lectures', () => {
    expect(codes("It's important to take care of yourself.")).toContain('FILLER');
    expect(codes('Remember that you are not alone.')).toContain('FILLER');
    expect(codes('গুরুত্বপূর্ণ হলো নিজের যত্ন নেওয়া।')).toContain('FILLER');
    expect(codes('याद रखें कि आप अकेले नहीं हैं।')).toContain('FILLER');
    expect(codes('सम्झनुहोस्, तपाईं एक्लै हुनुहुन्न।')).toContain('FILLER');
    expect(codes('Everything will be fine.')).toContain('FILLER');
  });

  it('flags advice only in the first turns', () => {
    const advice = 'You could try a short walk tonight.';
    expect(codes(advice, 0)).toContain('EARLY_ADVICE');
    expect(codes(advice, 1)).toContain('EARLY_ADVICE');
    expect(codes(advice, 4)).not.toContain('EARLY_ADVICE');
    expect(codes('একটু হাঁটার চেষ্টা করুন।', 0)).toContain('EARLY_ADVICE');
    expect(codes('थोड़ा टहलने की कोशिश करें।', 0)).toContain('EARLY_ADVICE');
    expect(codes('एकछिन हिँड्ने प्रयास गर्नुहोस्।', 0)).toContain('EARLY_ADVICE');
  });

  it('the BAD examples are all caught, and the corrective note names the problems', () => {
    for (const e of THERAPY_EXAMPLES) expect(codes(e.bad, 0).length, e.bad).toBeGreaterThan(0);
    expect(correctiveNote(['DEFINITION', 'LIST'])).toMatch(/defined a concept.*list/);
  });
});

describe('style guard: direct questions and quoted echoes', () => {
  it('does not count question marks inside quotation marks as extra questions', async () => {
    const { detectViolations } = await import('../services/styleGuard.js');
    expect(detectViolations('You are wondering, “What is anxiety actually?” That makes sense. What does it feel like for you?', { priorUserTurns: 3 })).not.toContain('MULTI_QUESTION');
    expect(detectViolations('Do you feel tense? Do you feel tired? Do you feel alone?', { priorUserTurns: 3 })).toContain('MULTI_QUESTION');
  });
  it('allows a short plain answer when the user asked directly, but not a definition nobody asked for', async () => {
    const { detectViolations, userAskedDirectly } = await import('../services/styleGuard.js');
    const def = 'Anxiety is a normal reaction of the body to stress.';
    expect(userAskedDirectly('What is anxiety actually? Is that what I have?')).toBe(true);
    expect(userAskedDirectly('কেন আমার এমন হয়?')).toBe(true);
    expect(userAskedDirectly('I feel so tired lately')).toBe(false);
    expect(detectViolations(def, { priorUserTurns: 3, userAsked: false })).toContain('DEFINITION');
    expect(detectViolations(def, { priorUserTurns: 3, userAsked: true })).not.toContain('DEFINITION');
  });
});

describe('style guard: REPEAT', () => {
  const recent = ['That sounds really heavy, carrying it alone. What is the hardest part?'];
  const v = (t: string, r: string[] = recent) => detectViolations(t, { priorUserTurns: 5, recentAssistant: r });

  it('flags the same opening words as a recent reply, in any script', () => {
    expect(v('That sounds exhausting. Take your time.')).toContain('REPEAT');
    expect(v('আপনি অনেক ক্লান্ত, এটা বোঝা যায়।', ['আপনি অনেক ক্লান্ত হয়ে আছেন। কী হয়েছে?'])).toContain('REPEAT');
    expect(v('आप बहुत थक गए हैं।', ['आप बहुत थक चुके हैं। क्या हुआ?'])).toContain('REPEAT');
    expect(v('Carrying it alone is hard.', ['Not fine at all.', 'Carrying it alone must hurt.'])).toContain('REPEAT');
  });

  it('flags the same closing sentence', () => {
    expect(v('Mm, I hear you. What is the hardest part?')).toContain('REPEAT');
    expect(v('Mm, I hear you. What feels hardest for you right now?', ['Okay. What feels hardest for you right now?'])).toContain('REPEAT');
  });

  it('does not flag different replies, and is off without recent replies', () => {
    expect(v('Mm, the quiet evenings must be the worst. Say more if you like.')).not.toContain('REPEAT');
    expect(v('That sounds exhausting.', [])).not.toContain('REPEAT');
    expect(detectViolations('That sounds heavy, carrying it alone.', { priorUserTurns: 5 })).not.toContain('REPEAT');
  });

  it('the corrective note names it, and a one-sentence reply is not too long', () => {
    expect(correctiveNote(['REPEAT'])).toMatch(/earlier replies/);
    expect(correctiveNote(['REPEAT'])).toMatch(/one sentence is fine/);
    expect(codes('Rough day.')).toEqual([]);
  });

  it('SHAPE_EXAMPLES pass the guard, have no question, and at most half of all GOOD examples end in a question', async () => {
    const { SHAPE_EXAMPLES } = await import('../services/therapyExamples.js');
    for (const e of SHAPE_EXAMPLES) { expect(codes(e.good), e.good).toEqual([]); expect(e.good).not.toMatch(/[?؟]/); }
    for (const l of ['en', 'bn', 'hi', 'ne']) expect(SHAPE_EXAMPLES.filter((e) => e.lang === l).map((e) => e.shape).sort()).toEqual(['ack', 'invite', 'reflect']);
    const all = [...THERAPY_EXAMPLES.map((e) => e.good), ...SHAPE_EXAMPLES.map((e) => e.good)];
    expect(all.filter((g) => /[?؟]\s*$/.test(g)).length / all.length).toBeLessThanOrEqual(0.5);
  });
});
