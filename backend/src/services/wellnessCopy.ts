/**
 * Fixed, reviewed-by-rule copy for the non-AI parts of the wellness features (nudges, Today cards, monthly fallback, gentler-thought fallback).
 * Locales: en, bn, hi, ne. Anything else falls back to English. The hi/ne strings need a native-speaker review before launch.
 * Placeholders use {name}; fill with `fill()`. Tone rules: warm, no shame, no diagnosis, no comparison with other people.
 */
export type CopyLang = 'en' | 'bn' | 'hi' | 'ne';
export const copyLang = (locale?: string | null): CopyLang => (locale === 'bn' || locale === 'hi' || locale === 'ne' ? locale : 'en');
export const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

type L<T> = Record<CopyLang, T>;
interface TitleBody { title: string; body: string }

export const NUDGE_TYPES = ['WIND_DOWN', 'MOOD_CHECKIN', 'WEEKLY_REVIEW', 'MORNING_PLAN'] as const;
export type NudgeType = (typeof NUDGE_TYPES)[number];

export const NUDGE_COPY: Record<NudgeType, L<TitleBody>> = {
  WIND_DOWN: {
    en: { title: 'Time to wind down', body: 'Your usual bedtime is near ({bedtime}). A few slow breaths and dim lights can help.' },
    bn: { title: 'এবার ধীরে ধীরে শান্ত হওয়ার সময়', body: 'আপনার সাধারণ ঘুমের সময় ({bedtime}) কাছে। কয়েকটি ধীর শ্বাস আর কম আলো সাহায্য করতে পারে।' },
    hi: { title: 'अब धीरे-धीरे शांत होने का समय', body: 'आपके सोने का सामान्य समय ({bedtime}) पास है। कुछ धीमी साँसें और हल्की रोशनी मदद कर सकती हैं।' },
    ne: { title: 'अब बिस्तारै शान्त हुने समय', body: 'तपाईंको सामान्य सुत्ने समय ({bedtime}) नजिक छ। केही बिस्तारै सास र मधुरो उज्यालोले मद्दत गर्न सक्छ।' },
  },
  MOOD_CHECKIN: {
    en: { title: 'A soft check-in', body: 'It has been a few days. How are you feeling today? Two minutes is plenty, and skipping is fine too.' },
    bn: { title: 'একটু নরম করে জিজ্ঞাসা', body: 'কয়েক দিন হয়ে গেছে। আজ কেমন লাগছে? দুই মিনিটই যথেষ্ট, আর না করলেও ঠিক আছে।' },
    hi: { title: 'एक हल्का सा हाल-चाल', body: 'कुछ दिन हो गए हैं। आज कैसा लग रहा है? दो मिनट काफ़ी हैं, और छोड़ देना भी ठीक है।' },
    ne: { title: 'एउटा नरम सोधपुछ', body: 'केही दिन भयो। आज कस्तो महसुस भइरहेको छ? दुई मिनेट काफी छ, र छोड्दा पनि ठीक छ।' },
  },
  WEEKLY_REVIEW: {
    en: { title: 'Your weekly review is ready', body: 'Take a look at the small steps you took this week.' },
    bn: { title: 'আপনার সাপ্তাহিক রিভিউ তৈরি', body: 'এই সপ্তাহে আপনার নেওয়া ছোট পদক্ষেপগুলো একবার দেখে নিন।' },
    hi: { title: 'आपकी साप्ताहिक समीक्षा तैयार है', body: 'इस हफ़्ते आपने जो छोटे क़दम उठाए, उन पर एक नज़र डालिए।' },
    ne: { title: 'तपाईंको साप्ताहिक समीक्षा तयार छ', body: 'यस हप्ता तपाईंले चालेका साना कदमहरूमा एक नजर हाल्नुहोस्।' },
  },
  MORNING_PLAN: {
    en: { title: 'Good morning', body: 'Your gentle plan for today is ready. One small step is enough.' },
    bn: { title: 'শুভ সকাল', body: 'আজকের জন্য আপনার হালকা পরিকল্পনা তৈরি। একটি ছোট পদক্ষেপই যথেষ্ট।' },
    hi: { title: 'सुप्रभात', body: 'आज की आपकी हल्की योजना तैयार है। एक छोटा क़दम ही काफ़ी है।' },
    ne: { title: 'शुभ प्रभात', body: 'आजको लागि तपाईंको सरल योजना तयार छ। एउटा सानो कदम नै काफी छ।' },
  },
};

export const NUDGE_CTA: Record<NudgeType, string> = { WIND_DOWN: 'sleep_routine', MOOD_CHECKIN: 'checkin', WEEKLY_REVIEW: 'weekly_review', MORNING_PLAN: 'plan' };

export const SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, L<string>> = {
  SPRING: { en: 'Spring', bn: 'বসন্ত', hi: 'वसंत', ne: 'वसन्त' },
  SUMMER: { en: 'Summer', bn: 'গ্রীষ্ম', hi: 'ग्रीष्म', ne: 'गर्मी' },
  AUTUMN: { en: 'Autumn', bn: 'শরৎ', hi: 'शरद', ne: 'शरद' },
  WINTER: { en: 'Winter', bn: 'শীত', hi: 'शीत', ne: 'जाडो' },
};

export type InsightKind = 'KAIZEN_WEEK' | 'SLEEP_TREND' | 'MOOD_WEEK' | 'WEEKLY_SUMMARY';
export const INSIGHT_COPY: Record<InsightKind, L<TitleBody>> = {
  KAIZEN_WEEK: {
    en: { title: 'Small steps', body: 'You took {n} small steps in the last 7 days.' },
    bn: { title: 'ছোট পদক্ষেপ', body: 'গত ৭ দিনে আপনি {n}টি ছোট পদক্ষেপ নিয়েছেন।' },
    hi: { title: 'छोटे क़दम', body: 'पिछले 7 दिनों में आपने {n} छोटे क़दम उठाए।' },
    ne: { title: 'साना कदम', body: 'पछिल्ला 7 दिनमा तपाईंले {n} वटा साना कदम चाल्नुभयो।' },
  },
  SLEEP_TREND: {
    en: { title: 'Your sleep', body: 'Your average sleep score over the last 7 days is {n}.' },
    bn: { title: 'আপনার ঘুম', body: 'গত ৭ দিনে আপনার গড় ঘুমের স্কোর {n}।' },
    hi: { title: 'आपकी नींद', body: 'पिछले 7 दिनों में आपका औसत नींद स्कोर {n} है।' },
    ne: { title: 'तपाईंको निद्रा', body: 'पछिल्ला 7 दिनमा तपाईंको औसत निद्रा स्कोर {n} छ।' },
  },
  MOOD_WEEK: {
    en: { title: 'Your week', body: 'Your average mood over the last 7 days is {n} out of 10.' },
    bn: { title: 'আপনার সপ্তাহ', body: 'গত ৭ দিনে আপনার গড় মেজাজ ১০-এর মধ্যে {n}।' },
    hi: { title: 'आपका हफ़्ता', body: 'पिछले 7 दिनों में आपका औसत मूड 10 में से {n} है।' },
    ne: { title: 'तपाईंको हप्ता', body: 'पछिल्ला 7 दिनमा तपाईंको औसत मुड 10 मध्ये {n} छ।' },
  },
  WEEKLY_SUMMARY: {
    en: { title: 'Last weekly review', body: 'Your latest weekly review is saved. Tap to read it again.' },
    bn: { title: 'সর্বশেষ সাপ্তাহিক রিভিউ', body: 'আপনার সর্বশেষ সাপ্তাহিক রিভিউ সংরক্ষিত আছে। আবার পড়তে ট্যাপ করুন।' },
    hi: { title: 'पिछली साप्ताहिक समीक्षा', body: 'आपकी ताज़ा साप्ताहिक समीक्षा सहेजी गई है। दोबारा पढ़ने के लिए टैप करें।' },
    ne: { title: 'पछिल्लो साप्ताहिक समीक्षा', body: 'तपाईंको पछिल्लो साप्ताहिक समीक्षा सुरक्षित छ। फेरि पढ्न ट्याप गर्नुहोस्।' },
  },
};

/** Monthly fallback (no model): headline and lines are assembled from computed facts only. */
export const MONTHLY_COPY: L<{ headline: string; days: string; mood: string; sleep: string; kaizen: string; close: string }> = {
  en: { headline: 'Here is your last {days} days, in your own numbers.', days: 'You logged {n} days this period.', mood: 'Your average mood was {n} out of 10.', sleep: 'Your average sleep score was {n}.', kaizen: 'You completed {n} small steps.', close: 'Keep it gentle, one small step at a time.' },
  bn: { headline: 'আপনার গত {days} দিন, আপনার নিজের সংখ্যায়।', days: 'এই সময়ে আপনি {n} দিন লিখেছেন।', mood: 'আপনার গড় মেজাজ ১০-এর মধ্যে {n}।', sleep: 'আপনার গড় ঘুমের স্কোর {n}।', kaizen: 'আপনি {n}টি ছোট পদক্ষেপ সম্পন্ন করেছেন।', close: 'ধীরে চলুন, একটি করে ছোট পদক্ষেপ।' },
  hi: { headline: 'आपके पिछले {days} दिन, आपके अपने आँकड़ों में।', days: 'इस अवधि में आपने {n} दिन दर्ज किए।', mood: 'आपका औसत मूड 10 में से {n} रहा।', sleep: 'आपका औसत नींद स्कोर {n} रहा।', kaizen: 'आपने {n} छोटे क़दम पूरे किए।', close: 'धीरे चलिए, एक-एक छोटा क़दम।' },
  ne: { headline: 'तपाईंका पछिल्ला {days} दिन, तपाईंकै अङ्कमा।', days: 'यो अवधिमा तपाईंले {n} दिन लेख्नुभयो।', mood: 'तपाईंको औसत मुड 10 मध्ये {n} रह्यो।', sleep: 'तपाईंको औसत निद्रा स्कोर {n} रह्यो।', kaizen: 'तपाईंले {n} वटा साना कदम पूरा गर्नुभयो।', close: 'बिस्तारै चल्नुहोस्, एक-एक सानो कदम।' },
};

/** Static prompts for the gentler-thought helper when the model is unavailable or its output is rejected. Never judges the thought. */
export const GENTLER_FALLBACK: L<string[]> = {
  en: ['This is a thought, not a fact. What would you say to a friend who had this thought?', 'What is one small thing that does not fit this thought perfectly?', 'Is there a kinder way to say this that still feels true?'],
  bn: ['এটি একটি ভাবনা, তথ্য নয়। এই ভাবনা কোনো বন্ধুর হলে আপনি তাকে কী বলতেন?', 'এই ভাবনার সঙ্গে পুরোপুরি মেলে না, এমন একটি ছোট বিষয় কী?', 'একই কথা আরও কোমলভাবে বলার কোনো উপায় আছে কি, যা তবুও সত্যি মনে হয়?'],
  hi: ['यह एक विचार है, तथ्य नहीं। अगर किसी दोस्त का यही विचार होता तो आप उससे क्या कहते?', 'ऐसी एक छोटी बात क्या है जो इस विचार से पूरी तरह मेल नहीं खाती?', 'क्या यही बात और नरमी से कही जा सकती है, जो फिर भी सच लगे?'],
  ne: ['यो एउटा विचार हो, तथ्य होइन। साथीलाई यस्तै विचार आएको भए तपाईं के भन्नुहुन्थ्यो?', 'यो विचारसँग पूरै नमिल्ने एउटा सानो कुरा के हो?', 'यही कुरा झन् कोमलतासँग भन्न सकिन्छ, जुन अझै सत्य लाग्छ?'],
};
