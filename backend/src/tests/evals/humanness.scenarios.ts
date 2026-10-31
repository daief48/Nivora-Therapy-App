import type { EvalLang } from './scenarios.js';

/** Multi-turn user scripts for the humanness eval. Plain data; none contains crisis wording (those turns would get the fixed crisis reply). */
export interface HumannessScript { id: string; kind: 'short-answers' | 'venting' | 'grief' | 'direct-question' | 'ambivalent' | 'practical'; language: EvalLang; turns: string[] }

export const HUMANNESS_SCRIPTS: HumannessScript[] = [
  { id: 'en-short-answers', kind: 'short-answers', language: 'en', turns: ['hi', 'tired', 'work i guess', 'yeah', 'not really', 'idk', 'maybe'] },
  { id: 'en-venting', kind: 'venting', language: 'en', turns: [
    'My manager moved the deadline up again without asking anyone and I have been up until 2am three nights in a row and nobody even noticed.',
    'And the worst part is my team just goes along with it. I am so sick of being the only one who gets angry about it.',
    'Then I go home and snap at my sister over nothing. I hate who I am becoming.',
    'I do not know. I just needed to say it somewhere.',
  ] },
  { id: 'en-grief', kind: 'grief', language: 'en', turns: [
    'My grandmother passed away last month.', 'I keep picking up the phone to call her on Sundays.', 'Everyone says she had a good long life, so I feel guilty for still being this sad.', 'She used to hum while cooking. I miss that.',
  ] },
  { id: 'en-direct-question', kind: 'direct-question', language: 'en', turns: [
    'Can you just tell me why I cannot stop overthinking everything?', 'Okay but what would you do in my place?', 'Is it normal to feel this way after a breakup three months ago?',
  ] },
  { id: 'en-ambivalent', kind: 'ambivalent', language: 'en', turns: [
    'I got the job offer in another city. Everyone says take it.', 'But my mum is not well and I would be leaving her.', 'I think I want to go and I think that makes me selfish.', 'Thanks. That helps a bit.',
  ] },
  { id: 'bn-short-answers', kind: 'short-answers', language: 'bn', turns: ['হাই', 'ভালো না', 'পড়াশোনা', 'হুম', 'জানি না', 'হয়তো'] },
  { id: 'bn-venting', kind: 'venting', language: 'bn', turns: [
    'অফিসে বস আবারও কাউকে না জানিয়ে ডেডলাইন এগিয়ে দিয়েছে, তিন রাত ধরে আমি রাত দুইটা পর্যন্ত জেগে কাজ করছি, কেউ খেয়ালই করে না।',
    'সবচেয়ে খারাপ লাগে যে আমার কলিগরা সবাই মেনে নেয়। আমি একাই রাগ করি।',
    'বাসায় গিয়ে ছোট বোনের সাথে বিনা কারণে ঝগড়া করে ফেলি। নিজেকেই আর ভালো লাগে না।',
    'জানি না, শুধু কাউকে বলতে চাইছিলাম।',
  ] },
  { id: 'bn-grief', kind: 'grief', language: 'bn', turns: [
    'আমার দাদু গত মাসে মারা গেছেন।', 'প্রতি শুক্রবার এখনও ফোন হাতে নিয়ে ওনাকে কল করতে যাই।', 'সবাই বলে উনি অনেক বছর বেঁচে ছিলেন, তাই এত কষ্ট পাচ্ছি বলে নিজেকে দোষী লাগে।',
  ] },
  { id: 'bn-direct-question', kind: 'direct-question', language: 'bn', turns: [
    'আচ্ছা, আমি কেন সবকিছু নিয়ে এত বেশি ভাবি, আপনি কি বলতে পারেন?', 'আপনি আমার জায়গায় হলে কী করতেন?', 'তিন মাস আগে ব্রেকআপের পরেও এমন লাগাটা কি স্বাভাবিক?',
  ] },
  { id: 'bn-practical', kind: 'practical', language: 'bn', turns: [
    'সামনের সপ্তাহে আমার ইন্টারভিউ, ভয়ে হাত ঠান্ডা হয়ে যাচ্ছে।', 'আগের বার প্রশ্নের উত্তর দিতে গিয়ে সব ভুলে গিয়েছিলাম।', 'ঠিক আছে, চেষ্টা করব।',
  ] },
];
