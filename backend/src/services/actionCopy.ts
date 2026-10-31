import { copyLang, fill, type CopyLang } from './wellnessCopy.js';

/**
 * Fixed, reviewed-by-rule copy for the in-app action menu (titles, "why this helps", "why am I seeing this", routine steps, walk ideas,
 * reach-out drafts). Locales: en, bn, hi, ne; anything else falls back to English. The hi/ne strings need a native-speaker review before launch.
 * Tone rules: an invitation, never an order; no scores or numbers about the person; no streaks; no clinical claims.
 */
export type L<T> = Record<CopyLang, T>;
export const pick = <T>(c: L<T>, locale?: string | null): T => c[copyLang(locale)];

export const CTA_TRY: L<string> = { en: 'Try it', bn: 'চেষ্টা করুন', hi: 'आज़माएँ', ne: 'प्रयास गर्नुहोस्' };
export const NOT_NOW: L<string> = { en: 'Not now', bn: 'এখন নয়', hi: 'अभी नहीं', ne: 'अहिले होइन' };

export interface ActionCopy { title: L<string>; why: L<string>; cta?: L<string> }

export const ACTION_COPY: Record<string, ActionCopy> = {
  BREATHING: {
    title: { en: 'Slow breathing, 2 minutes', bn: '২ মিনিট ধীরে শ্বাস', hi: '2 मिनट धीमी साँसें', ne: '२ मिनेट बिस्तारै सास' },
    why: { en: 'A few slow breaths can help your body settle.', bn: 'কয়েকটি ধীর শ্বাস শরীরকে শান্ত হতে সাহায্য করতে পারে।', hi: 'कुछ धीमी साँसें शरीर को शांत होने में मदद कर सकती हैं।', ne: 'केही बिस्तारै सासले शरीरलाई शान्त हुन मद्दत गर्न सक्छ।' },
  },
  GROUNDING: {
    title: { en: 'Grounding, 5-4-3-2-1', bn: 'গ্রাউন্ডিং, ৫-৪-৩-২-১', hi: 'ग्राउंडिंग, 5-4-3-2-1', ne: 'ग्राउन्डिङ, ५-४-३-२-१' },
    why: { en: 'Noticing things around you can bring you back to the present.', bn: 'আশপাশের জিনিস লক্ষ্য করলে বর্তমানে ফিরে আসা সহজ হয়।', hi: 'आसपास की चीज़ें देखने से वर्तमान में लौटना आसान होता है।', ne: 'वरपरका कुरा हेर्दा अहिलेमा फर्कन सजिलो हुन्छ।' },
  },
  THOUGHT_RECORD: {
    title: { en: 'Look at one thought gently', bn: 'একটি ভাবনাকে নরমভাবে দেখুন', hi: 'एक विचार को नरमी से देखें', ne: 'एउटा विचारलाई कोमलतासँग हेर्नुहोस्' },
    why: { en: 'Writing a thought down can make it feel a little lighter.', bn: 'ভাবনাটা লিখে ফেললে একটু হালকা লাগতে পারে।', hi: 'विचार को लिख देने से वह थोड़ा हल्का लग सकता है।', ne: 'विचार लेखिदिँदा अलि हल्का महसुस हुन सक्छ।' },
  },
  JOURNAL_TEXT: {
    title: { en: 'Write a few lines', bn: 'কয়েক লাইন লিখুন', hi: 'कुछ पंक्तियाँ लिखें', ne: 'केही लाइन लेख्नुहोस्' },
    why: { en: 'Putting it into words, without fixing it, can ease the load.', bn: 'ঠিক করার চেষ্টা না করে শুধু শব্দে লিখলে ভার একটু কমতে পারে।', hi: 'सुधारने की कोशिश किए बिना शब्दों में लिखने से बोझ कम हो सकता है।', ne: 'ठीक गर्न नखोजी शब्दमा लेख्दा भार अलि हल्का हुन सक्छ।' },
  },
  JOURNAL_VOICE: {
    title: { en: 'Say it out loud as a voice note', bn: 'মুখে বলুন, ভয়েস নোট', hi: 'बोलकर कहें, वॉइस नोट', ne: 'बोलेर भन्नुहोस्, भ्वाइस नोट' },
    why: { en: 'Sometimes speaking is easier than typing.', bn: 'কখনও টাইপের চেয়ে বলা সহজ।', hi: 'कभी-कभी टाइप करने से बोलना आसान होता है।', ne: 'कहिलेकाहीँ टाइप गर्नुभन्दा बोल्न सजिलो हुन्छ।' },
  },
  GRATITUDE_NOTE: {
    title: { en: 'One thing that went okay', bn: 'ভালো লাগা একটি জিনিস', hi: 'एक चीज़ जो ठीक रही', ne: 'ठीक भएको एउटा कुरा' },
    why: { en: 'Noticing one small good thing can soften a heavy day.', bn: 'একটি ছোট ভালো জিনিস লক্ষ্য করলে ভারী দিনও একটু নরম হতে পারে।', hi: 'एक छोटी अच्छी बात देखना भारी दिन को थोड़ा नरम कर सकता है।', ne: 'एउटा सानो राम्रो कुरा सम्झँदा गह्रौँ दिन अलि नरम हुन सक्छ।' },
  },
  SLEEP_ROUTINE: {
    title: { en: "Plan tonight's wind-down", bn: 'আজ রাতের শান্ত হওয়ার রুটিন', hi: 'आज रात की वाइंड-डाउन योजना', ne: 'आज राति शान्त हुने तयारी' },
    why: { en: 'A gentle routine before bed can make falling asleep easier.', bn: 'ঘুমের আগে হালকা রুটিন ঘুমিয়ে পড়া সহজ করতে পারে।', hi: 'सोने से पहले की हल्की दिनचर्या नींद आसान कर सकती है।', ne: 'सुत्नुअघिको सरल दिनचर्याले निदाउन सजिलो बनाउन सक्छ।' },
  },
  KAIZEN_STEP: {
    title: { en: "Today's small step", bn: 'আজকের ছোট পদক্ষেপ', hi: 'आज का छोटा क़दम', ne: 'आजको सानो कदम' },
    why: { en: 'One tiny step is enough for today.', bn: 'আজকের জন্য একটি ছোট পদক্ষেপই যথেষ্ট।', hi: 'आज के लिए एक छोटा क़दम ही काफ़ी है।', ne: 'आजका लागि एउटा सानो कदम नै काफी छ।' },
  },
  WALK_10: {
    title: { en: 'A 10-minute walk or something pleasant', bn: '১০ মিনিট হাঁটা বা ভালো লাগার কিছু', hi: '10 मिनट की सैर या कुछ अच्छा सा', ne: '१० मिनेट हिँड्ने वा केही मनपर्ने काम' },
    why: { en: 'A little movement or a pleasant activity may lift the mood a bit.', bn: 'একটু নড়াচড়া বা ভালো লাগার কাজ মনটাকে একটু হালকা করতে পারে।', hi: 'थोड़ा चलना या कोई अच्छा काम मन को थोड़ा हल्का कर सकता है।', ne: 'अलि हिँडडुल वा मनपर्ने काम गर्दा मन अलि हल्का हुन सक्छ।' },
  },
  SOUNDS: {
    title: { en: 'Calming sounds', bn: 'শান্ত করার শব্দ', hi: 'शांत करने वाली आवाज़ें', ne: 'शान्त पार्ने आवाजहरू' },
    why: { en: 'Soft sounds can give your mind something gentle to rest on.', bn: 'নরম শব্দ মনকে বিশ্রামের জন্য কোমল কিছু দিতে পারে।', hi: 'हल्की आवाज़ें मन को टिकने के लिए कुछ कोमल दे सकती हैं।', ne: 'मधुरो आवाजले मनलाई आराम गर्ने कोमल सहारा दिन सक्छ।' },
  },
  REACH_OUT: {
    title: { en: 'Message someone you trust', bn: 'বিশ্বস্ত কাউকে বার্তা পাঠান', hi: 'किसी भरोसेमंद को संदेश भेजें', ne: 'भरोसाको कसैलाई सन्देश पठाउनुहोस्' },
    why: { en: 'A short message to someone close can make things feel less alone. Nothing is sent for you.', bn: 'কাছের কাউকে ছোট একটি বার্তা একা লাগা কমাতে পারে। আপনার হয়ে কিছু পাঠানো হয় না।', hi: 'किसी करीबी को छोटा संदेश अकेलापन कम कर सकता है। आपकी ओर से कुछ नहीं भेजा जाता।', ne: 'नजिकको कसैलाई छोटो सन्देशले एक्लो महसुस कम गर्न सक्छ। तपाईंको तर्फबाट केही पठाइँदैन।' },
  },
  SAFETY_PLAN: {
    title: { en: 'Open your safety plan', bn: 'আপনার সুরক্ষা পরিকল্পনা খুলুন', hi: 'अपनी सुरक्षा योजना खोलें', ne: 'आफ्नो सुरक्षा योजना खोल्नुहोस्' },
    why: { en: 'Your own steps for getting through a hard moment.', bn: 'কঠিন মুহূর্ত পার করার জন্য আপনার নিজের ধাপগুলো।', hi: 'कठिन पल से गुज़रने के लिए आपके अपने क़दम।', ne: 'कठिन क्षण पार गर्न तपाईंका आफ्नै कदमहरू।' },
    cta: { en: 'Open', bn: 'খুলুন', hi: 'खोलें', ne: 'खोल्नुहोस्' },
  },
  EMERGENCY: {
    title: { en: 'Get help now', bn: 'এখনই সাহায্য নিন', hi: 'अभी मदद लें', ne: 'अहिले नै सहयोग लिनुहोस्' },
    why: { en: 'If you may be in danger, emergency numbers and support lines are here.', bn: 'বিপদে থাকতে পারেন মনে হলে জরুরি নম্বর ও সহায়তা লাইন এখানে আছে।', hi: 'अगर आप ख़तरे में हो सकते हैं, तो आपातकालीन नंबर और सहायता लाइनें यहाँ हैं।', ne: 'तपाईं खतरामा हुन सक्नुहुन्छ भने आपतकालीन नम्बर र सहयोग लाइन यहाँ छन्।' },
    cta: { en: 'Get help', bn: 'সাহায্য নিন', hi: 'मदद लें', ne: 'सहयोग लिनुहोस्' },
  },
  TRUSTED_PERSON: {
    title: { en: 'Reach a person you trust', bn: 'বিশ্বস্ত কারও সঙ্গে যোগাযোগ করুন', hi: 'किसी भरोसेमंद व्यक्ति से संपर्क करें', ne: 'भरोसाका व्यक्तिसँग सम्पर्क गर्नुहोस्' },
    why: { en: 'You do not have to carry this alone.', bn: 'এটা আপনাকে একা বইতে হবে না।', hi: 'आपको यह अकेले नहीं उठाना है।', ne: 'तपाईंले यो एक्लै बोक्नुपर्दैन।' },
    cta: { en: 'Open', bn: 'খুলুন', hi: 'खोलें', ne: 'खोल्नुहोस्' },
  },
};

/** "Why am I seeing this?": one line, built from the rule that fired. Never a number or a score about the person. {weekday} is filled where relevant. */
export const REASONS = {
  chat: { en: 'Nivora thought this might fit what you shared.', bn: 'আপনি যা বললেন তার সঙ্গে এটি মানাতে পারে মনে হয়েছে।', hi: 'आपने जो बताया, उससे यह मेल खा सकता है, ऐसा लगा।', ne: 'तपाईंले भनेको कुरासँग यो मिल्न सक्छ जस्तो लाग्यो।' },
  general: { en: 'A small, optional idea for right now.', bn: 'এই মুহূর্তের জন্য ছোট, ঐচ্ছিক একটি ভাবনা।', hi: 'अभी के लिए एक छोटा, वैकल्पिक सुझाव।', ne: 'अहिलेका लागि एउटा सानो, ऐच्छिक सुझाव।' },
  tag_sleep: { en: 'You mentioned trouble with sleep.', bn: 'আপনি ঘুমের সমস্যার কথা বলেছেন।', hi: 'आपने नींद की परेशानी का ज़िक्र किया।', ne: 'तपाईंले निद्राको समस्या उल्लेख गर्नुभयो।' },
  tag_looping: { en: 'You mentioned thoughts going round and round.', bn: 'আপনি ভাবনা ঘুরেফিরে আসার কথা বলেছেন।', hi: 'आपने बार-बार घूमते विचारों का ज़िक्र किया।', ne: 'तपाईंले घुमिरहने विचारको कुरा गर्नुभयो।' },
  tag_anxiety: { en: 'You mentioned feeling anxious.', bn: 'আপনি উদ্বেগ বোধ করার কথা বলেছেন।', hi: 'आपने घबराहट महसूस करने का ज़िक्र किया।', ne: 'तपाईंले चिन्ता महसुस गरेको कुरा गर्नुभयो।' },
  tag_stress: { en: 'You mentioned feeling stressed.', bn: 'আপনি চাপ অনুভব করার কথা বলেছেন।', hi: 'आपने तनाव महसूस करने का ज़िक्र किया।', ne: 'तपाईंले तनाव महसुस गरेको कुरा गर्नुभयो।' },
  tag_anger: { en: 'You mentioned feeling angry or tense.', bn: 'আপনি রাগ বা টান টান লাগার কথা বলেছেন।', hi: 'आपने गुस्से या तनाव का ज़िक्र किया।', ne: 'तपाईंले रिस वा तनावको कुरा गर्नुभयो।' },
  tag_low_energy: { en: 'You said your energy is low.', bn: 'আপনি বলেছেন শক্তি কম লাগছে।', hi: 'आपने कहा कि ऊर्जा कम है।', ne: 'तपाईंले ऊर्जा कम भएको भन्नुभयो।' },
  tag_low_mood: { en: 'You mentioned feeling low.', bn: 'আপনি মন খারাপের কথা বলেছেন।', hi: 'आपने उदास महसूस करने का ज़िक्र किया।', ne: 'तपाईंले मन उदास भएको कुरा गर्नुभयो।' },
  tag_loneliness: { en: 'You mentioned feeling alone.', bn: 'আপনি একা লাগার কথা বলেছেন।', hi: 'आपने अकेलापन महसूस करने का ज़िक्र किया।', ne: 'तपाईंले एक्लो महसुस गरेको कुरा गर्नुभयो।' },
  tag_gratitude: { en: 'You mentioned something good.', bn: 'আপনি ভালো কিছুর কথা বলেছেন।', hi: 'आपने कुछ अच्छा होने का ज़िक्र किया।', ne: 'तपाईंले केही राम्रो कुरा उल्लेख गर्नुभयो।' },
  sleep_short: { en: "Last night's sleep was short, so today is lighter.", bn: 'গত রাতে ঘুম কম হয়েছে, তাই আজকের দিন হালকা রাখা হয়েছে।', hi: 'कल रात नींद कम रही, इसलिए आज का दिन हल्का रखा गया है।', ne: 'हिजो राति निद्रा कम भयो, त्यसैले आजको दिन हल्का राखिएको छ।' },
  evening: { en: 'It is evening, a good time to wind down.', bn: 'এখন সন্ধ্যা, শান্ত হওয়ার ভালো সময়।', hi: 'शाम हो गई है, धीरे-धीरे शांत होने का अच्छा समय।', ne: 'साँझ परेको छ, शान्त हुने राम्रो समय।' },
  morning: { en: 'A fresh day: one small step is enough.', bn: 'নতুন একটি দিন: একটি ছোট পদক্ষেপই যথেষ্ট।', hi: 'नया दिन: एक छोटा क़दम ही काफ़ी है।', ne: 'नयाँ दिन: एउटा सानो कदम नै काफी छ।' },
  risk_support: { en: 'Support is here whenever you want it.', bn: 'যখনই চান, সহায়তা এখানে আছে।', hi: 'जब भी चाहें, सहायता यहाँ है।', ne: 'जब चाहनुहुन्छ, सहयोग यहाँ छ।' },
  session_close: { en: 'A tiny thing to take with you from today.', bn: 'আজ থেকে সঙ্গে নেওয়ার একটি ছোট জিনিস।', hi: 'आज से साथ ले जाने के लिए एक छोटी सी बात।', ne: 'आजबाट साथ लैजान एउटा सानो कुरा।' },
  journal_step: { en: 'This came from the feelings in your journal reading.', bn: 'আপনার জার্নাল পড়ার অনুভূতি থেকে এটি এসেছে।', hi: 'यह आपकी जर्नल की भावनाओं से आया है।', ne: 'यो तपाईंको जर्नलका भावनाबाट आएको हो।' },
  pattern_sleep: { en: 'Your sleep and how you felt tended to go together this month.', bn: 'এই মাসে আপনার ঘুম আর অনুভূতি একসঙ্গে ওঠানামা করেছে।', hi: 'इस महीने आपकी नींद और आपका मन साथ-साथ ऊपर-नीचे हुए।', ne: 'यो महिना तपाईंको निद्रा र मनको अवस्था सँगै उतारचढाव भए।' },
  pattern_move: { en: 'Moving and how you felt tended to go together this month.', bn: 'এই মাসে নড়াচড়া আর আপনার অনুভূতি একসঙ্গে ওঠানামা করেছে।', hi: 'इस महीने चलना-फिरना और आपका मन साथ-साथ ऊपर-नीचे हुए।', ne: 'यो महिना हिँडडुल र तपाईंको मनको अवस्था सँगै उतारचढाव भए।' },
  pattern_calm: { en: 'Your mood and stress tended to move together this month.', bn: 'এই মাসে আপনার মনের অবস্থা আর চাপ একসঙ্গে ওঠানামা করেছে।', hi: 'इस महीने आपका मूड और तनाव साथ-साथ ऊपर-नीचे हुए।', ne: 'यो महिना तपाईंको मुड र तनाव सँगै उतारचढाव भए।' },
  pattern_weekday: { en: '{weekday}s tended to feel a little lower for you.', bn: 'এই সময়ে {weekday} আপনার একটু বেশি ভারী লাগার প্রবণতা ছিল।', hi: 'इस दौरान {weekday} आपको थोड़े भारी लगने की प्रवृत्ति रही।', ne: 'यस अवधिमा {weekday} तपाईंलाई अलि गह्रौँ लाग्ने प्रवृत्ति देखियो।' },
  week_sleep: { en: 'This week included some shorter nights.', bn: 'এই সপ্তাহে কিছু রাতে ঘুম কম হয়েছে।', hi: 'इस हफ़्ते कुछ रातें छोटी रहीं।', ne: 'यो हप्ता केही राति निद्रा छोटो भयो।' },
  week_steps: { en: 'A small step is an easy way to begin the next week.', bn: 'ছোট একটি পদক্ষেপ নতুন সপ্তাহ শুরুর সহজ উপায়।', hi: 'एक छोटा क़दम अगला हफ़्ता शुरू करने का आसान तरीक़ा है।', ne: 'एउटा सानो कदम अर्को हप्ता सुरु गर्ने सजिलो तरिका हो।' },
  nudge_WIND_DOWN: { en: 'Your usual bedtime is coming up.', bn: 'আপনার সাধারণ ঘুমের সময় এগিয়ে আসছে।', hi: 'आपके सोने का सामान्य समय पास आ रहा है।', ne: 'तपाईंको सामान्य सुत्ने समय नजिक आउँदैछ।' },
  nudge_MOOD_CHECKIN: { en: 'A short check-in is here whenever you like.', bn: 'যখন ইচ্ছা হয়, ছোট একটি check-in এখানে আছে।', hi: 'जब मन हो, एक छोटा चेक-इन यहाँ है।', ne: 'जब मन लाग्छ, छोटो चेक-इन यहाँ छ।' },
  nudge_WEEKLY_REVIEW: { en: 'You took some steps this week, and a look back is ready.', bn: 'এই সপ্তাহে আপনি কিছু পদক্ষেপ নিয়েছেন, ফিরে দেখার জন্য প্রস্তুত।', hi: 'इस हफ़्ते आपने कुछ क़दम उठाए, और पीछे मुड़कर देखने की सामग्री तैयार है।', ne: 'यो हप्ता तपाईंले केही कदम चाल्नुभयो, फर्केर हेर्न तयार छ।' },
  nudge_MORNING_PLAN: { en: 'A new morning: your gentle plan is ready.', bn: 'নতুন সকাল: আপনার হালকা পরিকল্পনা তৈরি।', hi: 'नई सुबह: आपकी हल्की योजना तैयार है।', ne: 'नयाँ बिहान: तपाईंको सरल योजना तयार छ।' },
  nudge_SESSION_INVITE: { en: 'The last few days seemed heavier, so here is an option to talk it through if you want to.', bn: 'গত কয়েক দিন একটু ভারী মনে হয়েছে, তাই চাইলে কথা বলার একটি সুযোগ রাখা হলো।', hi: 'पिछले कुछ दिन भारी लगे, इसलिए मन हो तो बात करने का एक विकल्प यहाँ है।', ne: 'पछिल्ला केही दिन गह्रौँ देखिए, त्यसैले मन लागे कुरा गर्ने एउटा विकल्प यहाँ छ।' },
  nudge_SUPPORT: { en: 'The last few days seemed heavy, and support is here for you.', bn: 'গত কয়েক দিন ভারী মনে হয়েছে, আর সহায়তা আপনার জন্য এখানে আছে।', hi: 'पिछले कुछ दिन भारी लगे, और सहायता आपके लिए यहाँ है।', ne: 'पछिल्ला केही दिन गह्रौँ देखिए, र सहयोग तपाईंका लागि यहाँ छ।' },
  insight_KAIZEN_WEEK: { en: 'Based on the small steps you marked this week.', bn: 'এই সপ্তাহে আপনার চিহ্নিত ছোট পদক্ষেপের ভিত্তিতে।', hi: 'इस हफ़्ते आपके चिह्नित छोटे क़दमों के आधार पर।', ne: 'यो हप्ता तपाईंले चिन्ह लगाएका साना कदमका आधारमा।' },
  insight_SLEEP_TREND: { en: 'Based on the sleep you logged this week.', bn: 'এই সপ্তাহে আপনার লেখা ঘুমের তথ্যের ভিত্তিতে।', hi: 'इस हफ़्ते दर्ज की गई आपकी नींद के आधार पर।', ne: 'यो हप्ता तपाईंले लेखेको निद्राका आधारमा।' },
  insight_MOOD_WEEK: { en: 'Based on your own check-ins this week.', bn: 'এই সপ্তাহে আপনার নিজের check-in-এর ভিত্তিতে।', hi: 'इस हफ़्ते आपके अपने चेक-इन के आधार पर।', ne: 'यो हप्ता तपाईंका आफ्नै चेक-इनका आधारमा।' },
  insight_WEEKLY_SUMMARY: { en: 'You saved a weekly review, so it is here to read again.', bn: 'আপনি সাপ্তাহিক রিভিউ সংরক্ষণ করেছেন, তাই আবার পড়ার জন্য এখানে আছে।', hi: 'आपने साप्ताहिक समीक्षा सहेजी थी, इसलिए दोबारा पढ़ने के लिए यहाँ है।', ne: 'तपाईंले साप्ताहिक समीक्षा सुरक्षित गर्नुभएको थियो, त्यसैले फेरि पढ्न यहाँ छ।' },
  plan_focus: { en: 'This is your focus step for today.', bn: 'এটি আজকের জন্য আপনার ফোকাসের পদক্ষেপ।', hi: 'यह आज के लिए आपका मुख्य क़दम है।', ne: 'यो आजका लागि तपाईंको मुख्य कदम हो।' },
} satisfies Record<string, L<string>>;
export type ReasonKey = keyof typeof REASONS;
export const reasonText = (k: ReasonKey, locale?: string | null, v: Record<string, string | number> = {}) => fill(pick(REASONS[k], locale), v);

export const WEEKDAY_NAMES: L<string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  bn: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'],
  hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
  ne: ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'],
};

/** Short pleasant-activity ideas for WALK_10 (the app shows these as choices; the person may also write their own). */
export const WALK_CHOICES: { key: string; minutes: number; label: L<string> }[] = [
  { key: 'walk', minutes: 10, label: { en: 'A 10-minute walk', bn: '১০ মিনিট হাঁটা', hi: '10 मिनट की सैर', ne: '१० मिनेट हिँड्ने' } },
  { key: 'outside', minutes: 5, label: { en: 'Step outside for fresh air', bn: 'খোলা হাওয়ায় একটু বাইরে যান', hi: 'ताज़ी हवा के लिए बाहर निकलें', ne: 'ताजा हावाका लागि बाहिर निस्कनुहोस्' } },
  { key: 'stretch', minutes: 5, label: { en: 'Gentle stretching', bn: 'হালকা স্ট্রেচিং', hi: 'हल्की स्ट्रेचिंग', ne: 'हल्का स्ट्रेचिङ' } },
  { key: 'music', minutes: 10, label: { en: 'Listen to a song I like', bn: 'পছন্দের একটি গান শুনুন', hi: 'अपना पसंदीदा गाना सुनें', ne: 'मनपर्ने गीत सुन्नुहोस्' } },
  { key: 'warm_drink', minutes: 10, label: { en: 'Make a warm drink and sit with it', bn: 'গরম কিছু বানিয়ে শান্তভাবে বসুন', hi: 'कुछ गर्म बनाकर आराम से बैठें', ne: 'तातो पेय बनाएर शान्त बस्नुहोस्' } },
];

/** Extra steps the Sleep Coach can add to tonight's routine (rule-based mapping, see services/routineSteps.ts). */
export const ROUTINE_EXTRAS: Record<string, { minutes: number; label: L<string> }> = {
  DIM_LIGHTS: { minutes: 5, label: { en: 'Dim the lights', bn: 'আলো কমিয়ে দিন', hi: 'रोशनी हल्की करें', ne: 'उज्यालो मधुरो पार्नुहोस्' } },
  PHONE_AWAY: { minutes: 10, label: { en: 'Put the phone away', bn: 'ফোন সরিয়ে রাখুন', hi: 'फ़ोन दूर रख दें', ne: 'फोन टाढा राख्नुहोस्' } },
  STRETCH: { minutes: 5, label: { en: 'Gentle stretching', bn: 'হালকা স্ট্রেচিং', hi: 'हल्की स्ट्रेचिंग', ne: 'हल्का स्ट्रेचिङ' } },
  SOUNDS: { minutes: 10, label: { en: 'Calming sounds', bn: 'শান্ত করার শব্দ', hi: 'शांत करने वाली आवाज़ें', ne: 'शान्त पार्ने आवाजहरू' } },
  WRITE_WORRIES: { minutes: 5, label: { en: 'Write down tomorrow\'s worries', bn: 'আগামীকালের চিন্তাগুলো লিখে রাখুন', hi: 'कल की चिंताएँ लिख दें', ne: 'भोलिका चिन्ताहरू लेखेर राख्नुहोस्' } },
};

/** Labels for the built-in routine steps (so the app can show them in the user's language). */
export const ROUTINE_STEP_LABEL: Record<string, L<string>> = {
  breathing: { en: 'Slow breathing', bn: 'ধীরে শ্বাস', hi: 'धीमी साँसें', ne: 'बिस्तारै सास' },
  reflection: { en: 'A short reflection', bn: 'ছোট একটি ভাবনা', hi: 'एक छोटा चिंतन', ne: 'छोटो मनन' },
  audio: { en: 'Sleep sounds or story', bn: 'ঘুমের শব্দ বা গল্প', hi: 'नींद की आवाज़ें या कहानी', ne: 'निद्राका आवाज वा कथा' },
  sleep: { en: 'Bedtime', bn: 'ঘুমের সময়', hi: 'सोने का समय', ne: 'सुत्ने समय' },
};

/** Titles of small steps this module creates in Kaizen ({n} = minutes). Categories match KAIZEN_CATEGORIES. */
export const STEP_TITLE: Record<string, L<string>> = {
  BREATHING: { en: 'Breathe slowly for {n} minutes', bn: '{n} মিনিট ধীরে শ্বাস নিন', hi: '{n} मिनट धीरे-धीरे साँस लें', ne: '{n} मिनेट बिस्तारै सास लिनुहोस्' },
  GROUNDING: { en: 'Ground yourself for {n} minutes', bn: '{n} মিনিট নিজেকে বর্তমানে ফিরিয়ে আনুন', hi: '{n} मिनट खुद को वर्तमान में लाएँ', ne: '{n} मिनेट आफूलाई अहिलेमा फर्काउनुहोस्' },
  REFLECTION: { en: 'Look at one thought gently for {n} minutes', bn: '{n} মিনিট একটি ভাবনাকে নরমভাবে দেখুন', hi: '{n} मिनट एक विचार को नरमी से देखें', ne: '{n} मिनेट एउटा विचारलाई कोमलतासँग हेर्नुहोस्' },
  JOURNALING: { en: 'Write what is on your mind for {n} minutes', bn: '{n} মিনিট মনের কথা লিখুন', hi: '{n} मिनट मन की बात लिखें', ne: '{n} मिनेट मनका कुरा लेख्नुहोस्' },
  GRATITUDE: { en: 'Notice one good thing for {n} minutes', bn: '{n} মিনিট একটি ভালো জিনিস লক্ষ্য করুন', hi: '{n} मिनट एक अच्छी बात पर ध्यान दें', ne: '{n} मिनेट एउटा राम्रो कुरामा ध्यान दिनुहोस्' },
  SLEEP_ROUTINE: { en: 'Wind down before bed for {n} minutes', bn: 'ঘুমের আগে {n} মিনিট শান্ত হন', hi: 'सोने से पहले {n} मिनट शांत हों', ne: 'सुत्नुअघि {n} मिनेट शान्त हुनुहोस्' },
  SHORT_WALK: { en: 'Take a gentle walk for {n} minutes', bn: '{n} মিনিট হালকা হাঁটুন', hi: '{n} मिनट हल्की सैर करें', ne: '{n} मिनेट हल्का हिँड्नुहोस्' },
  RELAXATION: { en: 'Rest your body for {n} minutes', bn: '{n} মিনিট শরীরকে বিশ্রাম দিন', hi: '{n} मिनट शरीर को आराम दें', ne: '{n} मिनेट शरीरलाई आराम दिनुहोस्' },
  SOCIAL: { en: 'Reach out to someone for {n} minutes', bn: '{n} মিনিট কারও সঙ্গে যোগাযোগ করুন', hi: '{n} मिनट किसी से संपर्क करें', ne: '{n} मिनेट कसैसँग सम्पर्क गर्नुहोस्' },
  SELF_OBSERVATION: { en: 'Notice how you feel for {n} minutes', bn: '{n} মিনিট নিজের অনুভূতি লক্ষ্য করুন', hi: '{n} मिनट अपनी भावना पर ध्यान दें', ne: '{n} मिनेट आफ्नो भावना हेर्नुहोस्' },
};

/** Editable drafts for REACH_OUT. Nothing is sent by the app: the person copies or shares the text themselves. */
export const REACH_OUT_DRAFTS: L<string[]> = {
  en: [
    'Hi {name}, I have been feeling a bit low lately and would like to talk. Do you have a few minutes this week?',
    'Hi {name}, thinking of you. Could we catch up soon? I could use some company.',
    'Hi {name}, it has been a heavy few days. No need to fix anything, I would just like to hear your voice.',
  ],
  bn: [
    'হাই {name}, কিছুদিন ধরে মনটা একটু ভারী। কথা বলতে চাই। এই সপ্তাহে কি কয়েক মিনিট সময় হবে?',
    'হাই {name}, তোমার কথা মনে পড়ল। শিগগির কি একটু কথা বলা যায়? একটু সঙ্গ পেলে ভালো লাগত।',
    'হাই {name}, কয়েকটা দিন বেশ ভারী গেছে। কিছু ঠিক করতে হবে না, শুধু তোমার সঙ্গে একটু কথা বলতে চাই।',
  ],
  hi: [
    'हाय {name}, कुछ दिनों से मन थोड़ा भारी है और बात करना चाहता/चाहती हूँ। क्या इस हफ़्ते कुछ मिनट मिलेंगे?',
    'हाय {name}, तुम्हारी याद आई। क्या जल्दी बात हो सकती है? थोड़ा साथ चाहिए।',
    'हाय {name}, कुछ दिन भारी रहे। कुछ ठीक नहीं करना है, बस तुम्हारी आवाज़ सुनना चाहता/चाहती हूँ।',
  ],
  ne: [
    'हाई {name}, केही दिनदेखि मन अलि भारी छ र कुरा गर्न मन छ। यो हप्ता केही मिनेट समय होला?',
    'हाई {name}, तिम्रो याद आयो। छिट्टै कुरा गर्न सकिन्छ? अलि साथ चाहियो।',
    'हाई {name}, केही दिन गह्रौँ भए। केही ठीक गर्नुपर्दैन, बस तिम्रो आवाज सुन्न मन छ।',
  ],
};

/** Button text of the "Your month" pattern cards (one rule-based next step each). */
export const PATTERN_CTA = {
  sleep: { en: "See tonight's routine", bn: 'আজ রাতের রুটিন দেখুন', hi: 'आज रात की दिनचर्या देखें', ne: 'आज राति को दिनचर्या हेर्नुहोस्' },
  walk: { en: 'Add a 10-minute walk to Kaizen', bn: 'Kaizen-এ ১০ মিনিট হাঁটা যোগ করুন', hi: 'Kaizen में 10 मिनट की सैर जोड़ें', ne: 'Kaizen मा १० मिनेट हिँडाइ थप्नुहोस्' },
  step: { en: "See today's small step", bn: 'আজকের ছোট পদক্ষেপ দেখুন', hi: 'आज का छोटा क़दम देखें', ne: 'आजको सानो कदम हेर्नुहोस्' },
  breathe: { en: 'Try 2 minutes of slow breathing', bn: '২ মিনিট ধীরে শ্বাস নিয়ে দেখুন', hi: '2 मिनट धीमी साँसें आज़माएँ', ne: '२ मिनेट बिस्तारै सास प्रयास गर्नुहोस्' },
  weekday: { en: 'Plan a gentle step for {weekday}', bn: '{weekday}-এর জন্য একটি হালকা পদক্ষেপ ঠিক করুন', hi: '{weekday} के लिए एक हल्का क़दम तय करें', ne: '{weekday} का लागि एउटा हल्का कदम तय गर्नुहोस्' },
} satisfies Record<string, L<string>>;

export const PRACTICE_LINE: L<string> = {
  en: 'You made time for {n} calming practices in this period.',
  bn: 'এই সময়ে আপনি {n}টি শান্ত করার অনুশীলনের জন্য সময় দিয়েছেন।',
  hi: 'इस अवधि में आपने {n} शांत करने वाले अभ्यासों के लिए समय निकाला।',
  ne: 'यो अवधिमा तपाईंले {n} वटा शान्त पार्ने अभ्यासका लागि समय निकाल्नुभयो।',
};
