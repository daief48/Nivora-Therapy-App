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

import { replyToneFor } from '../src/utils/reaction';
describe('reply tone classifier', () => {
  it.each([
    ['If you might hurt yourself, please call the helpline now.', 'concerned'],
    ['আপনার নিরাপত্তা সবচেয়ে গুরুত্বপূর্ণ, জরুরি সাহায্য নিন।', 'concerned'],
    ['आपकी सुरक्षा सबसे जरूरी है, कृपया हेल्पलाइन पर कॉल करें।', 'concerned'],
    ['तपाईंको सुरक्षाको लागि हेल्पलाइनमा सम्पर्क गर्नुहोस्।', 'concerned'],
    ['Well done, I am proud of you. Keep going!', 'encouraging'],
    ['তুমি পারবে, আমি গর্বিত।', 'encouraging'],
    ['आप कर सकते हैं, शाबाश!', 'encouraging'],
    ['तिमी सक्छौ, धेरै राम्रो!', 'encouraging'],
    ['I am sorry, that sounds hard. I am here for you.', 'warm'],
    ['আমি বুঝতে পারছি, আমি আছি তোমার পাশে।', 'warm'],
    ['मैं यहाँ हूँ, आपके साथ।', 'warm'],
    ['Let us try a two minute breathing exercise.', 'neutral'],
  ])('%s -> %s', (text, expected) => expect(replyToneFor(text)).toBe(expected));

  it('crisis wording beats cheerful words, never a smile', () => {
    expect(replyToneFor('Well done for telling me. Please contact emergency services.')).toBe('concerned');
  });
});
