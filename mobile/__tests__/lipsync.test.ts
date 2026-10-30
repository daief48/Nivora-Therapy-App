import { createLipSync, energyToOpen, nextBlinkDelay, openAt, pauseAfter, planSpeech, smoothMouth, syllablesOf, visemeFor } from '../src/utils/lipsync';

describe('syllable heuristics', () => {
  it('counts English vowel groups and skips a silent final e', () => {
    expect(syllablesOf('hello')).toHaveLength(2);
    expect(syllablesOf('breathe')).toHaveLength(1);
    expect(syllablesOf('a')).toHaveLength(1);
  });
  it('counts Bangla syllables from consonants and vowel signs', () => {
    expect(syllablesOf('আমি')).toHaveLength(2); // আ + মি
    expect(syllablesOf('কষ্ট')).toHaveLength(2); // কষ্ + ট (conjunct joins)
    expect(syllablesOf('মন')).toHaveLength(2);
  });
  it('counts Devanagari syllables and uses vowel signs for openness', () => {
    expect(syllablesOf('नमस्ते')).toHaveLength(3);
    expect(syllablesOf('का')[0].open).toBe(1);
    expect(syllablesOf('कू')[0].round).toBe(true);
  });
});

describe('timing', () => {
  it('adds longer pauses for sentence ends than commas', () => {
    expect(pauseAfter('end.')).toBeGreaterThan(pauseAfter('comma,'));
    expect(pauseAfter('word')).toBe(0);
    expect(pauseAfter('শেষ।')).toBeGreaterThan(0);
  });
  it('a faster rate gives a shorter plan, and pauses leave the mouth closed', () => {
    const slow = planSpeech('I hear you, and I am here.', 1);
    expect(planSpeech('I hear you, and I am here.', 2).duration).toBeLessThan(slow.duration);
    const b = slow.beats;
    expect(openAt(slow, (b[0].t0 + b[0].t1) / 2).open).toBeGreaterThan(0.3);
    expect(openAt(slow, slow.duration + 1).open).toBe(0);
    expect(planSpeech('   ').beats).toHaveLength(0);
  });
});

describe('smoothing', () => {
  it('attacks faster than it releases and stays in 0..1', () => {
    const up = smoothMouth(0, 1, 0.05), down = 1 - smoothMouth(1, 0, 0.05);
    expect(up).toBeGreaterThan(down);
    expect(smoothMouth(0.5, 5, 10)).toBeLessThanOrEqual(1);
    expect(smoothMouth(0.5, 0.5, 0.05)).toBeCloseTo(0.5);
  });
  it('does not jump when a frame is very long or negative', () => {
    expect(smoothMouth(0.2, 1, -1)).toBe(0.2);
  });
  it('shapes energy with a noise floor', () => {
    expect(energyToOpen(0.02)).toBe(0);
    expect(energyToOpen(1)).toBe(1);
    expect(energyToOpen(0.5)).toBeGreaterThan(energyToOpen(0.2));
  });
  it('maps openness to the five mouth shapes', () => {
    expect(visemeFor(0.05, false)).toBe('closed');
    expect(visemeFor(0.25, false)).toBe('slight');
    expect(visemeFor(0.5, false)).toBe('open');
    expect(visemeFor(0.9, false)).toBe('wide');
    expect(visemeFor(0.5, true)).toBe('oo');
  });
  it('blinks every 2 to 6 seconds', () => {
    expect(nextBlinkDelay(0)).toBe(2);
    expect(nextBlinkDelay(1)).toBe(6);
  });
});

describe('controller', () => {
  it('uses text timing without audio, and fresh energy takes priority', () => {
    const ls = createLipSync();
    expect(ls.step(0).source).toBe('none');
    ls.speakText('Hello there my friend', 1);
    let max = 0;
    for (let t = 1; t < 2; t += 0.05) max = Math.max(max, ls.step(t).mouth);
    expect(max).toBeGreaterThan(0.3);
    ls.pushEnergy(0.9, 2);
    expect(ls.step(2.05).source).toBe('energy');
    expect(ls.step(2.6).source).toBe('text'); // energy went stale
  });
  it('closes after the text ends and on reset', () => {
    const ls = createLipSync();
    ls.speakText('Hi', 0);
    for (let t = 0; t < 3; t += 0.05) ls.step(t);
    expect(ls.step(3.2).mouth).toBeLessThan(0.05);
    ls.reset();
    expect(ls.step(4).source).toBe('none');
  });
});
