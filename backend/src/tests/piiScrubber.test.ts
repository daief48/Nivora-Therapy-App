import { describe, expect, it } from 'vitest';
import { asciiDigits, scrub } from '../services/piiScrubber.js';

const clean = (t: string, names?: string[]) => scrub(t, { names }).text;

describe('piiScrubber', () => {
  it('masks emails and keeps the sentence', () => {
    const r = scrub('You can mail me at rahim.k+work@gmail.com, thanks.');
    expect(r.text).toBe('You can mail me at [email], thanks.');
    expect(r.redactions).toBe(1);
  });

  it('masks URLs, bare domains and handles', () => {
    expect(clean('see https://facebook.com/rahim.k?x=1 now')).toBe('see [link] now');
    expect(clean('go to www.example.org/page')).toBe('go to [link]');
    expect(clean('my site is rahim.com')).toBe('my site is [link]');
    expect(clean('dm me @rahim_k on insta')).toBe('dm me [handle] on insta');
  });

  it.each([
    ['call 01712-345678 please', 'call [number] please'],
    ['+880 1712 345678 is mine', '[number] is mine'],
    ['+91 98765 43210', '[number]'],
    ['+977-9841234567', '[number]'],
    ['(555) 123-4567', '[number]'],
    ['my nid is 1234567890123', 'my nid is [number]'],
    ['card 4111 1111 1111 1111 expires', 'card [number] expires'],
  ])('masks phone / id number %s', (input, expected) => {
    expect(clean(input)).toBe(expected);
  });

  it('masks Bangla, Devanagari and Arabic-Indic digit sequences', () => {
    expect(clean('আমার নম্বর ০১৭১২৩৪৫৬৭৮')).toBe('আমার নম্বর [number]');
    expect(clean('मेरा नंबर ९८७६५४३२१०')).toBe('मेरा नंबर [number]');
    expect(clean('رقمي ٠١٧١٢٣٤٥٦٧٨')).toBe('رقمي [number]');
    expect(clean('+৮৮০ ১৭১২ ৩৪৫৬৭৮')).toBe('[number]');
  });

  it('asciiDigits keeps length', () => {
    const s = 'a০১২৩b९c';
    expect(asciiDigits(s)).toBe('a0123b9c');
    expect(asciiDigits(s).length).toBe(s.length);
  });

  it('leaves short everyday numbers alone', () => {
    const t = 'I slept 5 hours, rated my mood 3 out of 10 and took 2 walks.';
    expect(scrub(t)).toEqual({ text: t, redactions: 0 });
  });

  it('masks dates of birth in several shapes', () => {
    expect(clean('I was born on 12/03/1995 in Dhaka')).toContain('[dob]');
    expect(clean('I was born on 12/03/1995 in Dhaka')).not.toContain('1995');
    expect(clean('born in 1990')).toBe('[dob]');
    expect(clean('my DOB: 1994-07-21')).not.toMatch(/1994/);
    expect(clean('my birthday is 5 June')).not.toMatch(/5 June/);
    expect(clean('on 3rd March 1998 things changed')).toBe('on [date] things changed');
    expect(clean('on 12-03-1995 things changed')).toBe('on [date] things changed');
    expect(clean('জন্ম ১২/০৩/১৯৯৫')).toBe('জন্ম [date]');
  });

  it('masks street-address-like fragments', () => {
    expect(clean('I live at 12 Green Road, Dhaka')).not.toMatch(/Green Road/);
    expect(clean('House 14, Road 7, Block C')).toBe('[address]');
    expect(clean('flat 5B near the market')).toBe('[address] near the market');
    expect(clean('বাসা ১২ রোড ৫')).toBe('[address] [address]');
    expect(clean('my zip code: 1207')).toBe('my [address]');
  });

  it('masks the user name and its parts everywhere, case-insensitively', () => {
    expect(clean('Ayesha Rahman said ayesha is tired', ['Ayesha Rahman'])).toBe('[name] said [name] is tired');
    expect(clean('Rahman went home', ['Ayesha Rahman'])).toBe('[name] went home');
  });

  it('does not mask a name inside a longer word, but does in inflected Bangla', () => {
    expect(clean('The ayeshahome is far', ['Ayesha'])).toBe('The ayeshahome is far');
    expect(clean('আয়েশাকে বলেছি', ['আয়েশা'])).toBe('[name]কে বলেছি');
  });

  it('masks self-introductions', () => {
    expect(clean('Hi, my name is Rahim and I feel low')).toBe('Hi, my name is [name] and I feel low');
    expect(clean('my name is rahim')).toBe('my name is [name]');
    expect(clean('Call me Tanvir sometime')).toBe('Call me [name] sometime');
    expect(clean('call me later')).toBe('call me later');
    expect(clean('আমার নাম রহিম, আমি ভালো নেই')).toBe('আমার নাম [name], আমি ভালো নেই');
    expect(clean('मेरा नाम राहुल है')).toBe('मेरा नाम [name] है');
  });

  it('counts redactions and handles empty input', () => {
    const r = scrub('mail a@b.com or call 01712345678 or visit www.x.com');
    expect(r.redactions).toBe(3);
    expect(scrub('')).toEqual({ text: '', redactions: 0 });
  });

  it('keeps ordinary emotional content intact', () => {
    const t = "I've been feeling anxious about work and my sister. It gets worse at night.";
    expect(scrub(t).text).toBe(t);
  });

  it('is idempotent', () => {
    const once = scrub('Ayesha: call 01712345678 or a@b.com', { names: ['Ayesha'] }).text;
    expect(scrub(once, { names: ['Ayesha'] }).text).toBe(once);
  });
});
