import { reactionFor, toneFor } from '../src/utils/reaction';

describe('avatar reactions to what the user said', () => {
  it.each([
    ['I had a really stressful day and I feel exhausted', 'empathy'],
    ['আজ আমার মন খারাপ, অনেক চাপ', 'empathy'],
    ['ami onek klanto, mon kharap', 'empathy'],
    ['ভালো লাগছে না আজকে', 'empathy'],
    ['I am so happy, I passed my exam!', 'joy'],
    ['আজ আমি খুব খুশি, ধন্যবাদ', 'joy'],
    ['dhonnobad, aj valo achi', 'joy'],
    ['Why do I feel like this?', 'curious'],
    ['আমি কেন এমন অনুভব করি', 'curious'],
    ['I went to the market and bought some bread', 'nod'],
    ['আমি বাজারে গিয়েছিলাম', 'nod'],
  ])('%s → %s', (text, expected) => expect(reactionFor(text)).toBe(expected));

  it('serious distress gets a serious, caring face (never a smile)', () => {
    expect(reactionFor('I want to die')).toBe('concern');
    expect(reactionFor('আমি আর বাঁচতে চাই না')).toBe('concern');
    expect(reactionFor('ami morte chai')).toBe('concern');
  });

  it('does not grin at negated positives', () => {
    expect(reactionFor('I am not happy at all')).toBe('empathy');
    expect(reactionFor('I do not feel good')).not.toBe('joy');
  });

  it('chooses a speaking tone for the reply', () => {
    expect(toneFor('That is wonderful news, I am so glad!')).toBe('cheerful');
    expect(toneFor('I am sorry you are going through this, it sounds exhausting.')).toBe('warm');
    expect(toneFor('If you might hurt yourself, please contact emergency services.')).toBe('concerned');
  });
});
