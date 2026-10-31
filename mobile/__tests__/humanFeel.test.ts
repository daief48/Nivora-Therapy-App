import {
  applyMood, blinkGap, fillerPolicy, fillerText, firstWordsPauseMs, listeningIdle, moodFor, parseAffect, parseFiller, secondBubbleDelayMs, splitReply, TYPING_DELAY_MS,
} from '../src/utils/humanFeel';
import { staticFrame, expression } from '../src/components/AvatarArt';

const long = 'That sounds like a lot to carry on your own. It makes sense that you feel tired after a week like that. Let us take it one small step at a time, and you can tell me what feels heaviest right now.';

describe('splitReply (display-only split of a finished reply)', () => {
  it('splits a long multi-sentence reply near the middle at a sentence boundary and loses nothing', () => {
    const r = splitReply(long)!;
    expect(r).not.toBeNull();
    expect(r[0].endsWith('.')).toBe(true);
    expect(`${r[0]} ${r[1]}`).toBe(long);
    expect(Math.abs(r[0].length - r[1].length)).toBeLessThan(long.length * 0.5);
  });
  it('leaves short replies, single sentences and tiny tails alone', () => {
    expect(splitReply('I am here. Take your time.')).toBeNull();
    expect(splitReply('x'.repeat(200))).toBeNull();
    expect(splitReply(`${'a'.repeat(160)}. ok.`)).toBeNull();
  });
  it('does not cut at abbreviations followed by lowercase words', () => {
    const t = `${'We can try a few things, e.g. a short walk and some water '.repeat(3)}and then rest.`;
    expect(splitReply(t)).toBeNull();
  });
  it('handles the Bangla danda', () => {
    const bn = 'আমি বুঝতে পারছি যে আজকের দিনটা তোমার জন্য খুব কঠিন ছিল এবং তুমি অনেক ক্লান্ত। ধীরে ধীরে নিঃশ্বাস নাও, আমি এখানে আছি তোমার সঙ্গে। তুমি চাইলে আমাকে বলতে পারো কোন বিষয়টা সবচেয়ে বেশি ভারী লাগছে এই মুহূর্তে।';
    const r = splitReply(bn);
    expect(r).not.toBeNull();
    expect(r![0].endsWith('।')).toBe(true);
  });
});

describe('pacing numbers', () => {
  it('first-words pause is 400..900 ms and grows with reply length', () => {
    expect(firstWordsPauseMs(0)).toBe(400);
    expect(firstWordsPauseMs(100)).toBeGreaterThan(400);
    expect(firstWordsPauseMs(5000)).toBe(900);
    expect(TYPING_DELAY_MS).toBeGreaterThan(0);
    expect(secondBubbleDelayMs(10)).toBeGreaterThanOrEqual(600);
    expect(secondBubbleDelayMs(10_000)).toBeLessThanOrEqual(1000);
  });
});

describe('affect parsing and mood', () => {
  it('parses defensively and ignores unknown fields', () => {
    expect(parseAffect({ type: 'affect', emotion: 'Sad', intensity: 4, extra: 1 })).toEqual({ emotion: 'sad', intensity: 4 });
    expect(parseAffect({ emotion: 'sad', intensity: 99 })!.intensity).toBe(5);
    expect(parseAffect({ emotion: 'sad', intensity: '3' })!.intensity).toBe(3);
    expect(parseAffect({ emotion: '', intensity: 3 })).toBeNull();
    expect(parseAffect({ emotion: 'sad' })).toBeNull();
    expect(parseAffect(null)).toBeNull();
  });
  it('heavy emotion at 4+ gives soft concerned brows, a slower blink and a non-smiling face', () => {
    const m = moodFor(parseAffect({ emotion: 'grief', intensity: 5 }))!;
    expect(m.distressed).toBe(true);
    expect(m.blinkScale).toBeGreaterThan(1.3);
    expect(m.pose.brow!).toBeLessThan(0);
    expect(m.tone).toBe('concerned');
    const face = applyMood(expression('speaking', 0, 'cheerful'), m);
    expect(face.smile).toBeLessThanOrEqual(0.1);
    expect(face.sparkle).toBe(0);
  });
  it('never cheerful while distressed, even with weight 0', () => {
    const m = moodFor({ emotion: 'anxious', intensity: 4 });
    expect(applyMood({ ...staticFrame('idle'), smile: 1, joy: 1, sparkle: 1, blush: 1 }, m, 0).smile).toBeLessThanOrEqual(0.1);
  });
  it('light emotions give a relaxed smile; unknown emotions change nothing', () => {
    const m = moodFor({ emotion: 'calm', intensity: 2 })!;
    expect(m.pose.smile!).toBeGreaterThan(0.3);
    expect(m.distressed).toBe(false);
    expect(moodFor({ emotion: 'zzz', intensity: 3 })).toBeNull();
    expect(moodFor(null)).toBeNull();
  });
  it('blink gaps are random, slower for heavy moods', () => {
    expect(blinkGap(0.5, 1.6)).toBeGreaterThan(blinkGap(0.5, 1));
    expect(blinkGap(0, 1)).toBeLessThan(blinkGap(1, 1));
  });
});

describe('active listening idle', () => {
  it('nods slowly and only briefly, with small gaze shifts', () => {
    let nods = 0, max = 0;
    for (let t = 0; t < 30; t += 0.05) { const f = listeningIdle(t); if (f.nod > 0.01) nods++; max = Math.max(max, Math.abs(f.nod), Math.abs(f.lookX) / 2, Math.abs(f.lookY)); }
    expect(nods).toBeGreaterThan(0);
    expect(nods).toBeLessThan(600 * 0.3);
    expect(max).toBeLessThan(2);
  });
});

describe('fillers', () => {
  it('parses kinds', () => { expect(parseFiller({ kind: 'mm' })).toBe('mm'); expect(parseFiller({ kind: 'x' })).toBeNull(); expect(parseFiller(undefined)).toBeNull(); });
  it('sound is suppressed at last intensity >= 4; the visual nod stays; "listening" is never a sound', () => {
    expect(fillerPolicy('mm', null)).toEqual({ nod: true, sound: true });
    expect(fillerPolicy('mm', { emotion: 'sad', intensity: 3 }).sound).toBe(true);
    expect(fillerPolicy('mm', { emotion: 'sad', intensity: 4 })).toEqual({ nod: true, sound: false });
    expect(fillerPolicy('achha', { emotion: 'joy', intensity: 5 }).sound).toBe(false);
    expect(fillerPolicy('listening', null)).toEqual({ nod: true, sound: false });
  });
  it('has text for all four languages and falls back to English', () => {
    for (const l of ['en', 'bn', 'hi', 'ne']) { expect(fillerText(l, 'mm').length).toBeGreaterThan(0); expect(fillerText(l, 'achha').length).toBeGreaterThan(0); }
    expect(fillerText('auto', 'mm')).toBe(fillerText('en', 'mm'));
  });
});
