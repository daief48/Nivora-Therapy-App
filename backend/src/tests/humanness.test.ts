import { describe, expect, it } from 'vitest';
import {
  endsWithQuestion, maxQuestionStreak, openingRepeatRate, PASS_SCORE, questionEndingRate, stockPhraseHits, summarize,
} from '../services/humanness.js';

/** Pure unit tests (no DB, no network): hand-written robotic vs human transcripts in four languages. */
interface Transcript { lang: string; users: string[]; robotic: string[]; human: string[] }

const T: Transcript[] = [
  {
    lang: 'en',
    users: ['work is crushing me', 'my boss keeps adding things', 'i never say no', 'ok', 'maybe'],
    robotic: [
      'I understand how you feel. It is important to take care of yourself. What is making work so stressful?',
      'I understand how you feel. That sounds really hard. How long has your boss been doing this?',
      'I understand how you feel. That sounds really hard. Why do you find it difficult to say no?',
      'I understand how you feel. Remember that your feelings are valid. What would you like to change?',
      'As an AI, I am here to help. It is important to set boundaries. Have you tried talking to your boss?',
    ],
    human: [
      'Sounds like a lot is landing on you at once.',
      'Every week a little more, and nobody asks if you have room. That wears a person down. When did it start feeling this heavy?',
      'Saying no costs something when the person asking holds your paycheque.',
      'Mm. Take your time.',
      'That is okay. We can just sit with it for a bit, or I can ask you something small if you like.',
    ],
  },
  {
    lang: 'bn',
    users: ['অফিসে খুব চাপ', 'বস শুধু কাজ দেয়', 'আমি না বলতে পারি না', 'হুম', 'জানি না'],
    robotic: [
      'আমি আপনার অনুভূতি বুঝতে পারছি। মনে রাখবেন, নিজের যত্ন নেওয়া গুরুত্বপূর্ণ। কী কারণে অফিসে এত চাপ?',
      'আমি আপনার অনুভূতি বুঝতে পারছি। এটা সত্যিই কঠিন। আপনার বস কতদিন ধরে এমন করছেন?',
      'আমি আপনার অনুভূতি বুঝতে পারছি। এটা সত্যিই কঠিন। আপনি কেন না বলতে পারেন না?',
      'আমি আপনার অনুভূতি বুঝতে পারছি। মনে রাখবেন, আপনার অনুভূতি বৈধ। আপনি কী পরিবর্তন করতে চান?',
      'একজন এআই হিসেবে আমি সাহায্য করতে এখানে আছি। এটা গুরুত্বপূর্ণ যে সীমা ঠিক করুন। আপনি কি বসের সাথে কথা বলেছেন?',
    ],
    human: [
      'অনেকটা চাপ একসাথে এসে পড়ছে, তাই না।',
      'প্রতি সপ্তাহে একটু একটু করে বাড়ে, আর কেউ জিজ্ঞেসও করে না আপনার জায়গা আছে কি না। এভাবে চললে ভেতরটা ক্লান্ত হয়ে যায়। কবে থেকে এমন লাগছে?',
      'যে মানুষের হাতে বেতন, তাকে না বলা সহজ নয়।',
      'হুম। সময় নিন, তাড়া নেই।',
      'ঠিক আছে। চাইলে একটু চুপ করে থাকি, আর চাইলে ছোট একটা কথা জিজ্ঞেস করব।',
    ],
  },
  {
    lang: 'hi',
    users: ['ऑफिस में बहुत दबाव है', 'बॉस काम डालता रहता है', 'मैं मना नहीं कर पाता', 'हम्म', 'पता नहीं'],
    robotic: [
      'मैं आपकी भावनाओं को समझ सकता हूँ। याद रखें, अपना ध्यान रखना महत्वपूर्ण है। ऑफिस में दबाव का कारण क्या है?',
      'मैं आपकी भावनाओं को समझ सकता हूँ। यह सच में मुश्किल है। आपका बॉस कब से ऐसा कर रहा है?',
      'मैं आपकी भावनाओं को समझ सकता हूँ। यह सच में मुश्किल है। आप मना क्यों नहीं कर पाते?',
      'मैं आपकी भावनाओं को समझ सकता हूँ। याद रखें, आपकी भावनाएं वैध हैं। आप क्या बदलना चाहते हैं?',
      'एक एआई के रूप में मैं आपकी मदद के लिए यहाँ हूँ। यह महत्वपूर्ण है कि सीमाएँ तय करें। क्या आपने बॉस से बात की है?',
    ],
    human: [
      'एक साथ बहुत कुछ आप पर आ पड़ा है।',
      'हर हफ्ते थोड़ा और बढ़ता जाता है, और कोई पूछता भी नहीं कि आपके पास जगह है या नहीं। ऐसे में इंसान थक जाता है। यह कब से ऐसा लगने लगा?',
      'जिसके हाथ में तनख्वाह हो, उसे मना करना आसान नहीं होता।',
      'हम्म। आराम से, कोई जल्दी नहीं।',
      'ठीक है। चाहो तो थोड़ी देर बस चुप बैठ लेते हैं, या मैं कोई छोटी सी बात पूछ लूँ।',
    ],
  },
  {
    lang: 'ne',
    users: ['अफिसमा धेरै दबाब छ', 'बोसले काम थपिरहन्छ', 'म अस्वीकार गर्न सक्दिनँ', 'हुँ', 'थाहा छैन'],
    robotic: [
      'म तपाईंको भावना बुझ्छु। याद राख्नुहोस्, आफ्नो ख्याल राख्नु यो महत्त्वपूर्ण छ। अफिसमा दबाबको कारण के हो?',
      'म तपाईंको भावना बुझ्छु। यो साँच्चै गाह्रो छ। तपाईंको बोसले कहिलेदेखि यस्तो गर्दै छ?',
      'म तपाईंको भावना बुझ्छु। यो साँच्चै गाह्रो छ। तपाईं किन अस्वीकार गर्न सक्नुहुन्न?',
      'म तपाईंको भावना बुझ्छु। याद राख्नुहोस्, तपाईंका भावनाहरू वैध छन्। तपाईं के बदल्न चाहनुहुन्छ?',
      'एआई को रूपमा म तपाईंलाई मद्दत गर्न यहाँ छु। यो महत्त्वपूर्ण छ कि सीमा तोक्नुहोस्। के तपाईंले बोससँग कुरा गर्नुभयो?',
    ],
    human: [
      'एकैपटक धेरै कुरा तपाईंमाथि आइपरेजस्तो छ।',
      'हरेक हप्ता अलि अलि बढ्दै जान्छ, अनि कसैले सोध्दैन तपाईंसँग ठाउँ छ कि छैन। यसरी चल्दा मान्छे थाक्छ। कहिलेदेखि यस्तो लाग्न थाल्यो?',
      'तलब दिने मान्छेलाई ना भन्न सजिलो हुँदैन।',
      'हुँ। आरामले, हतार छैन।',
      'ठिक छ। चाहनुहुन्छ भने केही बेर चुपचाप बसौँ, नत्र म एउटा सानो कुरा सोध्छु।',
    ],
  },
];

describe('humanness score separates robotic from human replies', () => {
  for (const t of T) {
    it(`${t.lang}: human passes, robotic fails`, () => {
      const r = summarize(t.robotic, t.users), h = summarize(t.human, t.users);
      expect(h.humannessScore, `human ${JSON.stringify(h)}`).toBeGreaterThanOrEqual(PASS_SCORE);
      expect(h.pass, `human ${JSON.stringify(h.failingChecks)}`).toBe(true);
      expect(r.humannessScore, `robotic ${JSON.stringify(r)}`).toBeLessThan(PASS_SCORE);
      expect(r.pass).toBe(false);
      expect(h.humannessScore - r.humannessScore).toBeGreaterThanOrEqual(30);
      expect(r.failingChecks).toEqual(expect.arrayContaining(['openingRepeat', 'stockPhrases']));
    });
  }
});

describe('individual metrics', () => {
  it('opening repeat compares the first two words with the previous three replies', () => {
    expect(openingRepeatRate(['That sounds hard.', 'That sounds awful.', 'Tell me more.', 'Go on.'])).toBeCloseTo(1 / 3);
    expect(openingRepeatRate(['That sounds hard.', 'Tell me more.', 'Go on.', 'Mm.', 'That sounds hard.'])).toBe(0); // the match is 4 replies back: outside the window of 3
    expect(openingRepeatRate(['Only one.'])).toBe(0);
  });
  it('question ending uses the last sentence, across scripts', () => {
    expect(endsWithQuestion('Okay. What happened?')).toBe(true);
    expect(endsWithQuestion('What happened? I am here.')).toBe(false);
    expect(endsWithQuestion('কী হয়েছে?')).toBe(true);
    expect(endsWithQuestion('क्या हुआ?')).toBe(true);
    expect(questionEndingRate(['a?', 'b.', 'c?', 'd.'])).toBe(0.5);
  });
  it('question streak', () => {
    expect(maxQuestionStreak(['a?', 'b?', 'c.', 'd?', 'e?', 'f?'])).toBe(3);
    expect(maxQuestionStreak([])).toBe(0);
  });
  it('stock phrases: always-bad vs repeat-only, custom list', () => {
    expect(stockPhraseHits(['I understand how you feel.', 'Fine.']).hits).toBe(1);
    expect(stockPhraseHits(['That sounds really hard.']).hits).toBe(0);
    expect(stockPhraseHits(['That sounds really hard.', 'Oh. That sounds really hard, truly.']).hits).toBe(1);
    expect(stockPhraseHits(['Let us circle back'], ['circle back']).hits).toBe(1);
  });
  it('flags over-long replies to a one-word answer', () => {
    const long = 'Word '.repeat(60) + '.';
    expect(summarize([long, long], ['ok', 'ok']).failingChecks).toContain('lengthRatio');
  });
  it('empty input does not throw', () => {
    const s = summarize([], []);
    expect(s.metrics.replyCount).toBe(0);
  });
});
