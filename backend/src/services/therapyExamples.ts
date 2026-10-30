import type { Lang } from './safetyService.js';

/**
 * Few-shot GOOD vs BAD pairs that teach the reply style: reflect the feeling in the person's own words, at most one open question,
 * never a definition, lecture or list.
 *
 * REVIEW STATUS: the English pairs are written by the developers. The Bangla (bn), Hindi (hi) and Nepali (ne) pairs are DRAFTS
 * written by a non-native author and MUST be reviewed by a native-speaking psychologist / counsellor before launch (naturalness,
 * register, cultural fit, and that no GOOD reply sounds like advice or a diagnosis). Edit the strings here; nothing else depends on them.
 */
export type ExampleLang = 'en' | 'bn' | 'hi' | 'ne';
export type ExampleTheme = 'exam' | 'lonely' | 'grief' | 'work' | 'shame';
export interface TherapyExample { lang: ExampleLang; theme: ExampleTheme; user: string; good: string; bad: string }

export const THERAPY_EXAMPLES: TherapyExample[] = [
  // ---- English ----
  { lang: 'en', theme: 'exam', user: "I have my board exam in two weeks and I can't focus at all. Everyone expects me to do well.",
    good: "Two weeks out, with everyone's hopes on you, and your mind just won't settle. That sounds exhausting. What does it feel like when you sit down to study?",
    bad: 'Exam anxiety is a common condition. Here are some tips: 1. Make a schedule. 2. Take breaks. It is important to stay calm.' },
  { lang: 'en', theme: 'lonely', user: "I moved to Dhaka for work and I don't know anyone. Evenings are the worst.",
    good: "The evenings are the worst, when the room goes quiet and there's no one to talk to. That sounds really lonely. What do those evenings look like for you?",
    bad: 'Loneliness is a feeling of being disconnected. Try joining clubs and calling friends. Remember that many people feel this way.' },
  { lang: 'en', theme: 'grief', user: "My dad passed away last month. I keep acting like I'm fine.",
    good: "It's been a month since your dad passed, and on the outside you're holding it together. That's a lot to carry quietly. What is it like when you're alone with it?",
    bad: 'Grief is a natural response to loss. There are five stages of grief. It is important to give yourself time.' },
  { lang: 'en', theme: 'work', user: "My manager keeps piling on work and I'm so tired of it. I can't say no.",
    good: "You're worn out, and saying no feels like it isn't even allowed. That's a heavy spot to be in. What happens inside you when you imagine saying no?",
    bad: 'Burnout is a state of exhaustion. Here are 5 tips: set boundaries, make a list, take breaks. You should talk to your manager.' },
  { lang: 'en', theme: 'shame', user: 'I failed again and I feel like such a loser.',
    good: "Failing again has left you feeling like a loser, and that's a painful thing to say about yourself. What went through your mind when you found out?",
    bad: 'Shame is an emotion tied to self-worth. Remember that failure is part of growth and everything will be fine.' },

  // ---- Bangla (DRAFT, needs native psychologist review) ----
  { lang: 'bn', theme: 'exam', user: 'পরীক্ষা এসে গেছে, পড়তে বসলেই মাথা ফাঁকা হয়ে যায়। সবাই অনেক আশা করে আছে।',
    good: 'সবার আশা মাথায় নিয়ে পড়তে বসছেন, আর মাথা ফাঁকা হয়ে যাচ্ছে, এটা খুব চাপের। পড়তে বসলে ভেতরে ঠিক কী হয়?',
    bad: 'পরীক্ষার ভয় হলো একটি সাধারণ মানসিক অবস্থা। গুরুত্বপূর্ণ হলো রুটিন করা। ১. পর্যাপ্ত ঘুমান। ২. বিরতি নিন।' },
  { lang: 'bn', theme: 'lonely', user: 'ঢাকায় একা থাকি, সন্ধ্যা হলে খুব ফাঁকা লাগে।',
    good: 'সন্ধ্যা হলে চারপাশ চুপ হয়ে যায়, আর ভেতরটা ফাঁকা লাগে। একা থাকাটা সত্যিই ভারী লাগছে শুনে খারাপ লাগছে। সন্ধ্যাগুলো সাধারণত কেমন কাটে আপনার?',
    bad: 'একাকীত্ব হলো এক ধরনের মানসিক অবস্থা যেখানে মানুষ বিচ্ছিন্ন বোধ করে। বন্ধুদের সঙ্গে যোগাযোগ করুন এবং নতুন শখ গড়ে তুলুন।' },
  { lang: 'bn', theme: 'grief', user: 'গত মাসে আব্বু মারা গেছেন। আমি সবার সামনে ঠিক থাকার ভান করি।',
    good: 'আব্বুকে হারিয়েছেন এক মাস হলো, আর সবার সামনে শক্ত থাকছেন। ভেতরে একা এই কষ্ট বয়ে বেড়ানো অনেক ভারী। যখন একা থাকেন, তখন কেমন লাগে?',
    bad: 'শোক হলো প্রিয়জন হারানোর স্বাভাবিক প্রতিক্রিয়া। শোকের পাঁচটি ধাপ আছে। মনে রাখবেন, সময় সব ঠিক করে দেবে।' },
  { lang: 'bn', theme: 'work', user: 'অফিসে বস সারাক্ষণ কাজ চাপায়, না বলতে পারি না। আর পারছি না।',
    good: 'আর পারছেন না, অথচ না বলার জায়গাটাও পাচ্ছেন না। এটা খুব ক্লান্তিকর। না বলার কথা ভাবলে ভেতরে কী আসে?',
    bad: 'বার্নআউট হলো দীর্ঘমেয়াদি মানসিক ক্লান্তি। গুরুত্বপূর্ণ হলো সীমানা ঠিক করা। ১. কাজের তালিকা করুন ২. না বলা শিখুন।' },
  { lang: 'bn', theme: 'shame', user: 'আবার ফেল করলাম। নিজেকে একদম অকর্মা মনে হচ্ছে।',
    good: 'আবার ফল খারাপ হওয়ায় নিজেকে অকর্মা মনে হচ্ছে, নিজের সম্পর্কে এমন কথা ভাবা খুব কষ্টের। রেজাল্ট জানার পর মনে প্রথমে কী এসেছিল?',
    bad: 'লজ্জা হলো আত্মমূল্যের সঙ্গে জড়িত একটি আবেগ। মনে রাখবেন, ব্যর্থতা সাফল্যের প্রথম ধাপ।' },

  // ---- Hindi (DRAFT, needs native psychologist review) ----
  { lang: 'hi', theme: 'exam', user: 'बोर्ड परीक्षा पास आ गई है, पढ़ने बैठता हूँ तो दिमाग खाली हो जाता है। सबको मुझसे बहुत उम्मीद है।',
    good: 'सबकी उम्मीदें सिर पर हैं और पढ़ने बैठते ही दिमाग खाली हो जाता है, यह बहुत दबाव भरा है। पढ़ने बैठते समय अंदर क्या चलता है?',
    bad: 'परीक्षा का तनाव एक आम मानसिक स्थिति है। महत्वपूर्ण है कि आप टाइम-टेबल बनाएँ। 1. पूरी नींद लें। 2. ब्रेक लें।' },
  { lang: 'hi', theme: 'lonely', user: 'नई जगह नौकरी लगी है, यहाँ किसी को नहीं जानता। शाम को बहुत अकेलापन लगता है।',
    good: 'शाम होते ही सब सूना लगता है और बात करने वाला कोई नहीं, यह बहुत अकेला कर देने वाला है। ये शामें आपकी कैसी गुज़रती हैं?',
    bad: 'अकेलापन एक भावना है जिसमें व्यक्ति खुद को दूसरों से कटा हुआ महसूस करता है। नए दोस्त बनाइए और क्लब से जुड़िए।' },
  { lang: 'hi', theme: 'grief', user: 'पिछले महीने पापा चले गए। मैं सबके सामने ठीक होने का दिखावा करता हूँ।',
    good: 'पापा को गए एक महीना हुआ है, और आप सबके सामने मज़बूत बने रहते हैं। अकेले यह दर्द उठाना बहुत भारी होता है। जब आप अकेले होते हैं, तब कैसा लगता है?',
    bad: 'शोक किसी को खोने पर होने वाली स्वाभाविक प्रतिक्रिया है। शोक के पाँच चरण होते हैं। याद रखें, समय सब ठीक कर देता है।' },
  { lang: 'hi', theme: 'work', user: 'ऑफिस में बॉस हर समय काम लादता रहता है, मना नहीं कर पाता। थक गया हूँ।',
    good: 'आप थक चुके हैं, और मना करने की जगह भी नहीं मिल रही। यह बहुत थका देने वाली स्थिति है। मना करने की सोचते ही अंदर क्या होता है?',
    bad: 'बर्नआउट एक ऐसी स्थिति है जिसमें लगातार थकान रहती है। महत्वपूर्ण है कि आप सीमाएँ तय करें। 1. सूची बनाएँ 2. ना कहना सीखें।' },
  { lang: 'hi', theme: 'shame', user: 'फिर फेल हो गया। खुद को बिल्कुल बेकार महसूस कर रहा हूँ।',
    good: 'फिर से नतीजा खराब आया और खुद को बेकार महसूस कर रहे हैं, अपने बारे में ऐसा सोचना बहुत दुखता है। नतीजा पता चलने पर सबसे पहले मन में क्या आया?',
    bad: 'शर्म एक भावना है जो आत्म-सम्मान से जुड़ी होती है। याद रखें, असफलता सफलता की पहली सीढ़ी है।' },

  // ---- Nepali (DRAFT, needs native psychologist review) ----
  { lang: 'ne', theme: 'exam', user: 'एसईई नजिकै छ, पढ्न बस्दा टाउको खाली हुन्छ। सबैले मबाट धेरै आशा गरेका छन्।',
    good: 'सबैको आशा काँधमा छ, र पढ्न बस्दा टाउको खाली हुन्छ, यो धेरै दबाबको कुरा हो। पढ्न बस्दा भित्र के हुन्छ तपाईंलाई?',
    bad: 'परीक्षाको तनाव एउटा सामान्य मानसिक अवस्था हो। महत्त्वपूर्ण कुरा तालिका बनाउनु हो। १. पर्याप्त सुत्नुहोस्। २. विश्राम लिनुहोस्।' },
  { lang: 'ne', theme: 'lonely', user: 'काठमाडौंमा एक्लै बस्छु, साँझ पर्दा धेरै खाली खाली लाग्छ।',
    good: 'साँझ पर्दा वरिपरि सुनसान हुन्छ र भित्र खाली लाग्छ, एक्लै बस्नु धेरै गाह्रो हुँदो रहेछ। ती साँझहरू सामान्यतया कसरी बित्छन्?',
    bad: 'एक्लोपन एउटा भावना हो जसमा मानिस आफूलाई अरूबाट टाढा महसुस गर्छ। साथीहरूसँग सम्पर्क गर्नुहोस् र नयाँ शौक सुरु गर्नुहोस्।' },
  { lang: 'ne', theme: 'grief', user: 'गत महिना बुवा बित्नुभयो। म सबैको अगाडि ठीक छु जस्तो देखाउँछु।',
    good: 'बुवा बितेको एक महिना भयो, र तपाईं सबैको अगाडि बलियो देखिनुहुन्छ। भित्र एक्लै त्यो पीडा बोक्नु धेरै भारी हुन्छ। एक्लै हुँदा कस्तो लाग्छ?',
    bad: 'शोक कसैलाई गुमाउँदा हुने स्वाभाविक प्रतिक्रिया हो। शोकका पाँच चरण हुन्छन्। सम्झनुहोस्, समयले सबै ठीक पार्छ।' },
  { lang: 'ne', theme: 'work', user: 'अफिसमा मालिकले सधैं काम थपिरहन्छ, ना भन्न सक्दिनँ। थकित भएँ।',
    good: 'तपाईं थकित हुनुभएको छ, र ना भन्ने ठाउँ पनि पाइरहनुभएको छैन। यो निकै थकाउने अवस्था हो। ना भन्ने कुरा सोच्दा भित्र के आउँछ?',
    bad: 'बर्नआउट भनेको लामो समयको मानसिक थकान हो। महत्त्वपूर्ण कुरा सीमा तोक्नु हो। १. सूची बनाउनुहोस् २. ना भन्न सिक्नुहोस्।' },
  { lang: 'ne', theme: 'shame', user: 'फेरि फेल भएँ। आफूलाई एकदमै बेकार लागिरहेको छ।',
    good: 'फेरि नतिजा नराम्रो आयो र आफूलाई बेकार लागिरहेको छ, आफ्नै बारेमा यस्तो सोच्नु धेरै पीडादायी हुन्छ। नतिजा थाहा पाउँदा सबैभन्दा पहिले मनमा के आयो?',
    bad: 'लाज एउटा भावना हो जुन आत्मसम्मानसँग जोडिएको हुन्छ। सम्झनुहोस्, असफलता सफलताको पहिलो खुड्किलो हो।' },
];

const THEME_WORDS: Record<ExampleTheme, RegExp> = {
  exam: /exam|study|studies|test\b|পরীক্ষা|পড়|परीक्षा|पढ़|पढ्|एसईई|इम्तिहान|बोर्ड/i,
  lonely: /lonel|alone|no one|একা|একাকী|अकेल|अकेला|एक्ल/i,
  grief: /died|passed away|death|grief|miss (him|her)|মারা|শোক|মৃত্যু|चल बसे|चले गए|निधन|मृत्यु|बित्नु|बित्यो|गुमा/i,
  work: /boss|manager|office|work|job|deadline|অফিস|বস\b|কাজ|চাকরি|ऑफिस|बॉस|काम|नौकरी|अफिस|मालिक|जागिर/i,
  shame: /fail|loser|worthless|ashamed|ফেল|ব্যর্থ|অকর্মা|লজ্জা|फेल|असफल|बेकार|शर्म|लाज/i,
};
const ORDER: ExampleTheme[] = ['exam', 'lonely', 'grief', 'work', 'shame'];

export const EXAMPLES_CHAR_BUDGET = 1100;

/** Picks up to `n` examples for the language (mixed -> Bangla), preferring the theme found in the user's text, within a character budget. */
export function pickExamples(lang: Lang, userText: string, n = 2, budget = EXAMPLES_CHAR_BUDGET): TherapyExample[] {
  const l: ExampleLang = lang === 'mixed' ? 'bn' : lang;
  const pool = THERAPY_EXAMPLES.filter((e) => e.lang === l);
  const hit = ORDER.find((t) => THEME_WORDS[t].test(userText));
  const start = hit ? ORDER.indexOf(hit) : userText.length % ORDER.length; // no theme: vary deterministically
  const picked: TherapyExample[] = [];
  let used = 0;
  for (let i = 0; i < ORDER.length && picked.length < n; i++) {
    const ex = pool.find((e) => e.theme === ORDER[(start + i) % ORDER.length]);
    if (!ex) continue;
    const size = ex.user.length + ex.good.length + ex.bad.length;
    if (picked.length && used + size > budget) continue;
    picked.push(ex); used += size;
  }
  return picked;
}

export function examplesBlock(lang: Lang, userText: string): string {
  const ex = pickExamples(lang, userText);
  if (!ex.length) return '';
  const body = ex.map((e) => `Person: ${e.user}\nBAD (never do this): ${e.bad}\nGOOD: ${e.good}`).join('\n\n');
  return `EXAMPLES OF THE STYLE (never copy their words, only the manner: feeling named in the person's own words, then at most one open question):\n${body}`;
}
