
export const KAIZEN_CATEGORIES = [
  'BREATHING', 'REFLECTION', 'JOURNALING', 'GROUNDING', 'MEDITATION', 'SLEEP_ROUTINE', 'SHORT_WALK',
  'DIGITAL_BREAK', 'PLANNING', 'GRATITUDE', 'SOCIAL', 'RELAXATION', 'SELF_OBSERVATION',
] as const;
export type KaizenCategory = (typeof KAIZEN_CATEGORIES)[number];
export type Lang = 'en' | 'bn';

interface Template {
  unit: 'minutes' | 'breaths'; start: number; max: number; micro: number;
  en: { title: string; desc: string }; bn: { title: string; desc: string };
}

// {n} is the current target and {u} its unit. Titles stay small, concrete and kind.
export const TEMPLATES: Record<KaizenCategory, Template> = {
  BREATHING: { unit: 'minutes', start: 2, max: 10, micro: 3,
    en: { title: 'Breathe slowly for {n} {u}', desc: 'Breathe in for 4, out for 6. Let your shoulders drop.' },
    bn: { title: '{n} {u} ধীরে শ্বাস নিন', desc: '৪ গুনে শ্বাস নিন, ৬ গুনে ছাড়ুন। কাঁধ শিথিল রাখুন।' } },
  REFLECTION: { unit: 'minutes', start: 2, max: 10, micro: 1,
    en: { title: 'Pause and reflect for {n} {u}', desc: 'Ask yourself: what do I need most right now?' },
    bn: { title: '{n} {u} থেমে নিজের কথা ভাবুন', desc: 'নিজেকে জিজ্ঞেস করুন: এই মুহূর্তে আমার সবচেয়ে বেশি কী দরকার?' } },
  JOURNALING: { unit: 'minutes', start: 2, max: 10, micro: 1,
    en: { title: 'Write what is on your mind for {n} {u}', desc: 'No rules. A few honest lines are enough.' },
    bn: { title: '{n} {u} মনের কথা লিখুন', desc: 'কোনো নিয়ম নেই। কয়েকটি সৎ লাইনই যথেষ্ট।' } },
  GROUNDING: { unit: 'minutes', start: 2, max: 8, micro: 1,
    en: { title: 'Ground yourself for {n} {u}', desc: 'Name 3 things you see, 2 you hear, 1 you feel.' },
    bn: { title: '{n} {u} নিজেকে বর্তমানে ফিরিয়ে আনুন', desc: '৩টি দেখা, ২টি শোনা ও ১টি অনুভূতির জিনিসের নাম বলুন।' } },
  MEDITATION: { unit: 'minutes', start: 2, max: 12, micro: 1,
    en: { title: 'Sit quietly for {n} {u}', desc: 'Notice your breath. When your mind wanders, gently return.' },
    bn: { title: '{n} {u} শান্ত হয়ে বসুন', desc: 'শ্বাসের দিকে মন দিন। মন সরে গেলে আলতো করে ফিরিয়ে আনুন।' } },
  SLEEP_ROUTINE: { unit: 'minutes', start: 5, max: 20, micro: 2,
    en: { title: 'Wind down for {n} {u} before bed', desc: 'Dim the lights and put the phone away.' },
    bn: { title: 'ঘুমের আগে {n} {u} নিজেকে শান্ত করুন', desc: 'আলো কমান এবং ফোন সরিয়ে রাখুন।' } },
  SHORT_WALK: { unit: 'minutes', start: 3, max: 20, micro: 1,
    en: { title: 'Take a gentle walk for {n} {u}', desc: 'Slow steps, no destination, no phone.' },
    bn: { title: '{n} {u} হালকা হাঁটুন', desc: 'ধীরে হাঁটুন, ফোন ছাড়া।' } },
  DIGITAL_BREAK: { unit: 'minutes', start: 5, max: 30, micro: 2,
    en: { title: 'Take a screen break for {n} {u}', desc: 'Look out of a window or stretch.' },
    bn: { title: '{n} {u} স্ক্রিন থেকে বিরতি নিন', desc: 'জানালার বাইরে তাকান বা শরীর স্ট্রেচ করুন।' } },
  PLANNING: { unit: 'minutes', start: 2, max: 10, micro: 1,
    en: { title: 'Write your most important task in {n} {u}', desc: 'Just one task. Make it small enough to start.' },
    bn: { title: '{n} {u} আজকের সবচেয়ে গুরুত্বপূর্ণ কাজ লিখুন', desc: 'মাত্র একটি কাজ। শুরু করা যায় এমন ছোট করে লিখুন।' } },
  GRATITUDE: { unit: 'minutes', start: 2, max: 8, micro: 1,
    en: { title: 'Notice what went well for {n} {u}', desc: 'Think of one small thing you are thankful for today.' },
    bn: { title: '{n} {u} ভালো লাগা বিষয়গুলো ভাবুন', desc: 'আজকের একটি ছোট কৃতজ্ঞতার বিষয় মনে করুন।' } },
  SOCIAL: { unit: 'minutes', start: 3, max: 15, micro: 1,
    en: { title: 'Reach out to someone for {n} {u}', desc: 'A short message to someone you trust is enough.' },
    bn: { title: '{n} {u} কারও সঙ্গে যোগাযোগ করুন', desc: 'বিশ্বস্ত কাউকে ছোট একটি বার্তাই যথেষ্ট।' } },
  RELAXATION: { unit: 'minutes', start: 3, max: 15, micro: 1,
    en: { title: 'Relax your body for {n} {u}', desc: 'Tense and release each muscle group, from toes up.' },
    bn: { title: '{n} {u} শরীর শিথিল করুন', desc: 'পায়ের পাতা থেকে উপরের দিকে পেশি শক্ত করে ছেড়ে দিন।' } },
  SELF_OBSERVATION: { unit: 'minutes', start: 2, max: 8, micro: 1,
    en: { title: 'Notice how you feel for {n} {u}', desc: 'Just observe your body and mood without judging.' },
    bn: { title: '{n} {u} নিজের অনুভূতি লক্ষ্য করুন', desc: 'বিচার না করে শরীর ও মনের অবস্থা শুধু লক্ষ্য করুন।' } },
};

export const unitLabel = (unit: string, n: number, lang: Lang) =>
  lang === 'bn' ? (unit === 'breaths' ? 'বার শ্বাস' : 'মিনিট') : unit === 'breaths' ? (n === 1 ? 'breath' : 'breaths') : n === 1 ? 'minute' : 'minutes';

/** The size of one small step, used by the helper-step builders (kaizenExtras, Practice). */
export interface Plan { target: number; unit: 'minutes' | 'breaths'; micro: boolean; difficulty: number; reason: string }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function buildAction(category: KaizenCategory, plan: Plan, lang: Lang) {
  const tpl = TEMPLATES[category][lang];
  const u = unitLabel(plan.unit, plan.target, lang);
  return {
    title: tpl.title.replace('{n}', String(plan.target)).replace('{u}', u),
    description: plan.micro
      ? (lang === 'bn' ? 'কোনো চাপ নেই। আজ শুধু একটি ছোট শুরু। ' : 'No pressure. Just a tiny restart today. ') + tpl.desc
      : tpl.desc,
  };
}

const MESSAGES = {
  FULL: { en: 'You did it. This small step matters. 🌱', bn: 'আপনি করেছেন। এই ছোট পদক্ষেপটিও গুরুত্বপূর্ণ। 🌱', hi: 'यह हो गया। यह छोटा क़दम भी मायने रखता है। 🌱', ne: 'यो भयो। यो सानो कदम पनि महत्त्वपूर्ण छ। 🌱' },
  PARTIAL: { en: 'Every bit counts. Tomorrow we can make it a little easier.', bn: 'যতটুকু করেছেন সেটাই যথেষ্ট। কাল আমরা এটি আরও সহজ করব।', hi: 'जितना हुआ, वही काफ़ी है। कल हम इसे थोड़ा और आसान बना सकते हैं।', ne: 'जति भयो त्यति नै पर्याप्त छ। भोलि हामी यसलाई अलि सजिलो बनाउन सक्छौं।' },
  SKIPPED: { en: 'No pressure at all. Rest is part of the journey. Tomorrow we start smaller.', bn: 'কোনো চাপ নেই। বিশ্রামও যাত্রার অংশ। কাল আমরা আরও ছোট করে শুরু করব।', hi: 'कोई दबाव नहीं। आराम भी सफ़र का हिस्सा है। कल हम और छोटे से शुरू करेंगे।', ne: 'कुनै दबाब छैन। आराम पनि यात्राकै हिस्सा हो। भोलि हामी अझ सानोबाट सुरु गर्नेछौं।' },
  RETURN: { en: 'Welcome back. Glad you are here.', bn: 'আবার ফিরে এসেছেন, ভালো লাগল।', hi: 'फिर से मिलकर अच्छा लगा।', ne: 'फेरि भेट भएकोमा खुशी लाग्यो।' },
} as const;
export const kaizenMessage = (kind: keyof typeof MESSAGES, lang: Lang | 'hi' | 'ne') => MESSAGES[kind][lang];

/** The "make it smaller" step (0.6 factor). Used when a short night shrinks today's target. */
export const shrinkTarget = (target: number, max: number, factor = 0.6): number => clamp(Math.round(target * factor), 1, max);
