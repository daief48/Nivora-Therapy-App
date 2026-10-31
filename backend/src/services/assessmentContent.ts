/**
 * Screening questionnaires: PHQ-9, GAD-7 (Pfizer Inc.; Spitzer, Kroenke, Williams et al.; free to use) and AUDIT (World Health Organization).
 * These are screening tools, NOT diagnoses. Wording follows the published English versions.
 * NOTE: the Bangla (bn) translations below are working translations that NEED REVIEW by a clinician / native speaker.
 * They are NOT validated translations.
 */
export const INSTRUMENTS = ['PHQ9', 'GAD7', 'AUDIT'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];
export type BandKey = 'minimal' | 'mild' | 'moderate' | 'moderately_severe' | 'severe' | 'low_risk' | 'hazardous' | 'harmful' | 'possible_dependence';

export interface L10n { en: string; bn: string }
export interface Option { value: number; label: L10n }
export interface Item { text: L10n; options: Option[] }
export interface Band { key: BandKey; min: number; max: number }
export interface InstrumentDef {
  id: Instrument; title: L10n; intro: L10n; timeframe: L10n; maxScore: number; items: Item[]; bands: Band[]; attribution: L10n;
}

const opts = (labels: [string, string][], values: number[]): Option[] => labels.map(([en, bn], i) => ({ value: values[i], label: { en, bn } }));

const FREQ4 = opts([['Not at all', 'একেবারেই না'], ['Several days', 'কয়েক দিন'], ['More than half the days', 'অর্ধেকের বেশি দিন'], ['Nearly every day', 'প্রায় প্রতিদিন']], [0, 1, 2, 3]);
const it = (en: string, bn: string, options: Option[]): Item => ({ text: { en, bn }, options });

const PHQ9_ITEMS: Item[] = [
  it('Little interest or pleasure in doing things', 'কোনো কাজে আগ্রহ বা আনন্দ কম পাওয়া', FREQ4),
  it('Feeling down, depressed, or hopeless', 'মন খারাপ লাগা, বিষণ্ণ বা হতাশ বোধ করা', FREQ4),
  it('Trouble falling or staying asleep, or sleeping too much', 'ঘুম আসতে বা ঘুম ধরে রাখতে সমস্যা, অথবা অতিরিক্ত ঘুম', FREQ4),
  it('Feeling tired or having little energy', 'ক্লান্ত লাগা বা শক্তি কম থাকা', FREQ4),
  it('Poor appetite or overeating', 'খিদে কম লাগা বা অতিরিক্ত খাওয়া', FREQ4),
  it('Feeling bad about yourself, or that you are a failure or have let yourself or your family down', 'নিজেকে নিয়ে খারাপ লাগা, নিজেকে ব্যর্থ মনে করা, বা নিজেকে অথবা পরিবারকে হতাশ করেছি বলে মনে হওয়া', FREQ4),
  it('Trouble concentrating on things, such as reading or watching television', 'পড়া বা টিভি দেখার মতো কাজে মনোযোগ দিতে সমস্যা', FREQ4),
  it('Moving or speaking so slowly that other people could have noticed, or the opposite: being so fidgety or restless that you have been moving around a lot more than usual', 'এত ধীরে নড়াচড়া বা কথা বলা যে অন্যরা খেয়াল করতে পারে, অথবা উল্টোটা: এত অস্থির বা ছটফটে থাকা যে স্বাভাবিকের চেয়ে অনেক বেশি নড়াচড়া করা', FREQ4),
  it('Thoughts that you would be better off dead, or of hurting yourself in some way', 'মনে হওয়া যে মরে যাওয়াই ভালো, অথবা নিজেকে কোনোভাবে আঘাত করার চিন্তা', FREQ4),
];

const GAD7_ITEMS: Item[] = [
  it('Feeling nervous, anxious, or on edge', 'নার্ভাস, উদ্বিগ্ন বা অস্থির বোধ করা', FREQ4),
  it('Not being able to stop or control worrying', 'দুশ্চিন্তা থামাতে বা নিয়ন্ত্রণ করতে না পারা', FREQ4),
  it('Worrying too much about different things', 'নানা বিষয় নিয়ে অতিরিক্ত দুশ্চিন্তা করা', FREQ4),
  it('Trouble relaxing', 'শিথিল হতে বা স্বস্তি পেতে সমস্যা', FREQ4),
  it('Being so restless that it is hard to sit still', 'এত অস্থির লাগা যে স্থির হয়ে বসা কঠিন', FREQ4),
  it('Becoming easily annoyed or irritable', 'সহজেই বিরক্ত বা খিটখিটে হয়ে যাওয়া', FREQ4),
  it('Feeling afraid, as if something awful might happen', 'ভয় লাগা, যেন ভয়ানক কিছু ঘটতে যাচ্ছে', FREQ4),
];

const A_FREQ = opts([['Never', 'কখনো না'], ['Less than monthly', 'মাসে একবারের কম'], ['Monthly', 'মাসে একবার'], ['Weekly', 'সপ্তাহে একবার'], ['Daily or almost daily', 'প্রতিদিন বা প্রায় প্রতিদিন']], [0, 1, 2, 3, 4]);
const A_YEAR = opts([['No', 'না'], ['Yes, but not in the last year', 'হ্যাঁ, তবে গত এক বছরে নয়'], ['Yes, during the last year', 'হ্যাঁ, গত এক বছরের মধ্যে']], [0, 2, 4]);

const AUDIT_ITEMS: Item[] = [
  it('How often do you have a drink containing alcohol?', 'আপনি কত ঘন ঘন অ্যালকোহলযুক্ত পানীয় পান করেন?',
    opts([['Never', 'কখনো না'], ['Monthly or less', 'মাসে একবার বা তার কম'], ['2 to 4 times a month', 'মাসে ২ থেকে ৪ বার'], ['2 to 3 times a week', 'সপ্তাহে ২ থেকে ৩ বার'], ['4 or more times a week', 'সপ্তাহে ৪ বা তার বেশি বার']], [0, 1, 2, 3, 4])),
  it('How many drinks containing alcohol do you have on a typical day when you are drinking?', 'পান করার দিনে সাধারণত কত ড্রিংক পান করেন?',
    opts([['1 or 2', '১ বা ২'], ['3 or 4', '৩ বা ৪'], ['5 or 6', '৫ বা ৬'], ['7 to 9', '৭ থেকে ৯'], ['10 or more', '১০ বা তার বেশি']], [0, 1, 2, 3, 4])),
  it('How often do you have six or more drinks on one occasion?', 'কত ঘন ঘন একবারে ছয় বা তার বেশি ড্রিংক পান করেন?', A_FREQ),
  it('How often during the last year have you found that you were not able to stop drinking once you had started?', 'গত এক বছরে কত ঘন ঘন শুরু করার পর পান করা থামাতে পারেননি?', A_FREQ),
  it('How often during the last year have you failed to do what was normally expected of you because of drinking?', 'গত এক বছরে কত ঘন ঘন পানের কারণে আপনার কাছে স্বাভাবিকভাবে প্রত্যাশিত কাজ করতে ব্যর্থ হয়েছেন?', A_FREQ),
  it('How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?', 'গত এক বছরে কত ঘন ঘন অতিরিক্ত পানের পর নিজেকে সচল করতে সকালে প্রথমে পান করার প্রয়োজন হয়েছে?', A_FREQ),
  it('How often during the last year have you had a feeling of guilt or remorse after drinking?', 'গত এক বছরে কত ঘন ঘন পানের পর অপরাধবোধ বা অনুশোচনা হয়েছে?', A_FREQ),
  it('How often during the last year have you been unable to remember what happened the night before because you had been drinking?', 'গত এক বছরে কত ঘন ঘন পানের কারণে আগের রাতে কী ঘটেছিল মনে করতে পারেননি?', A_FREQ),
  it('Have you or someone else been injured as a result of your drinking?', 'আপনার পানের কারণে আপনি বা অন্য কেউ কি আঘাত পেয়েছেন?', A_YEAR),
  it('Has a relative, friend, doctor, or other health worker been concerned about your drinking or suggested you cut down?', 'কোনো আত্মীয়, বন্ধু, চিকিৎসক বা স্বাস্থ্যকর্মী কি আপনার পান নিয়ে উদ্বেগ প্রকাশ করেছেন বা কমাতে বলেছেন?', A_YEAR),
];

const days: L10n = { en: 'Over the last 2 weeks, how often have you been bothered by the following problems?', bn: 'গত ২ সপ্তাহে নিচের সমস্যাগুলো আপনাকে কত ঘন ঘন কষ্ট দিয়েছে?' };
const PFIZER: L10n = { en: 'Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. Free to use. A screening tool, not a diagnosis.', bn: 'ডা. রবার্ট এল. স্পিৎজার, জ্যানেট বি.ডব্লিউ. উইলিয়ামস, কার্ট ক্রোনকে ও সহকর্মীরা ফাইজার ইনকের শিক্ষামূলক অনুদানে তৈরি করেছেন। বিনামূল্যে ব্যবহারযোগ্য। এটি একটি স্ক্রিনিং টুল, রোগ নির্ণয় নয়।' };

export const INSTRUMENT_DEFS: Record<Instrument, InstrumentDef> = {
  PHQ9: {
    id: 'PHQ9', title: { en: 'PHQ-9 (mood)', bn: 'PHQ-9 (মেজাজ)' }, intro: days, timeframe: { en: 'Last 2 weeks', bn: 'গত ২ সপ্তাহ' }, maxScore: 27, items: PHQ9_ITEMS, attribution: PFIZER,
    bands: [{ key: 'minimal', min: 0, max: 4 }, { key: 'mild', min: 5, max: 9 }, { key: 'moderate', min: 10, max: 14 }, { key: 'moderately_severe', min: 15, max: 19 }, { key: 'severe', min: 20, max: 27 }],
  },
  GAD7: {
    id: 'GAD7', title: { en: 'GAD-7 (anxiety)', bn: 'GAD-7 (উদ্বেগ)' }, intro: days, timeframe: { en: 'Last 2 weeks', bn: 'গত ২ সপ্তাহ' }, maxScore: 21, items: GAD7_ITEMS, attribution: PFIZER,
    bands: [{ key: 'minimal', min: 0, max: 4 }, { key: 'mild', min: 5, max: 9 }, { key: 'moderate', min: 10, max: 14 }, { key: 'severe', min: 15, max: 21 }],
  },
  AUDIT: {
    id: 'AUDIT', title: { en: 'AUDIT (alcohol use)', bn: 'AUDIT (অ্যালকোহল ব্যবহার)' },
    intro: { en: 'These questions are about your use of alcohol. One drink is about a small beer, a glass of wine or a single measure of spirits.', bn: 'এই প্রশ্নগুলো আপনার অ্যালকোহল ব্যবহার সম্পর্কে। এক ড্রিংক মানে প্রায় এক ছোট বিয়ার, এক গ্লাস ওয়াইন বা এক পেগ স্পিরিট।' },
    timeframe: { en: 'Last year', bn: 'গত এক বছর' }, maxScore: 40, items: AUDIT_ITEMS,
    attribution: { en: 'The Alcohol Use Disorders Identification Test (AUDIT) was developed by the World Health Organization. A screening tool, not a diagnosis.', bn: 'অ্যালকোহল ইউজ ডিজঅর্ডারস আইডেন্টিফিকেশন টেস্ট (AUDIT) বিশ্ব স্বাস্থ্য সংস্থা (WHO) তৈরি করেছে। এটি একটি স্ক্রিনিং টুল, রোগ নির্ণয় নয়।' },
    bands: [{ key: 'low_risk', min: 0, max: 7 }, { key: 'hazardous', min: 8, max: 15 }, { key: 'harmful', min: 16, max: 19 }, { key: 'possible_dependence', min: 20, max: 40 }],
  },
};

export const isInstrument = (s: unknown): s is Instrument => typeof s === 'string' && (INSTRUMENTS as readonly string[]).includes(s);
