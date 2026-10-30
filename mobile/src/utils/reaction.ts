/**
 * Picks how the avatar should react to what the user just SAID or TYPED.
 *
 * This looks only at the words the user chose to share (English, Bangla script and romanised Bangla). It does not use the camera,
 * face, or voice tone, and it is not a diagnosis or emotion detector: it is a simple, local keyword heuristic so the avatar
 * can show a fitting expression (a soft nod, a warm smile, a worried look). It can be wrong, which is harmless: it only
 * changes a drawing. Severe-distress wording gets a serious, caring face, never a smile.
 */
export type Reaction = 'empathy' | 'joy' | 'curious' | 'concern' | 'nod';

const has = (t: string, words: string[]) => words.some((w) => t.includes(w));

const SEVERE = [
  'suicid', 'kill myself', 'end my life', 'want to die', 'hurt myself', 'self harm', 'self-harm', 'no reason to live',
  'আত্মহত্যা', 'মরে যেতে চাই', 'মরতে চাই', 'বাঁচতে চাই না', 'নিজেকে শেষ', 'morte chai', 'atmohotta', 'bachte chai na',
];
const DISTRESS = [
  'sad', 'tired', 'exhaust', 'stress', 'anxious', 'anxiety', 'lonely', 'alone', 'cry', 'depress', 'worried', 'worry', 'hurt', 'pain',
  'overwhelm', 'scared', 'afraid', 'hopeless', 'upset', 'angry', 'frustrat', 'fed up', 'can\'t sleep', 'not okay', 'not good', 'not well', 'bad day',
  'ক্লান্ত', 'মন খারাপ', 'চাপ', 'দুশ্চিন্তা', 'কষ্ট', 'একা', 'কান্না', 'কাঁদ', 'ভয়', 'টেনশন', 'চিন্তা', 'হতাশ', 'ভালো লাগছে না', 'ভালো নেই', 'রাগ', 'ঘুম আসছে না', 'অসহ্য',
  'klanto', 'mon kharap', 'kosto', 'tension', 'chap', 'eka', 'valo lagche na', 'bhalo lagche na', 'valo nei', 'bhalo nei', 'rag',
];
const JOY = [
  'happy', 'great', 'good news', 'thank', 'grateful', 'excited', 'love', 'proud', 'better', 'wonderful', 'amazing', 'glad', 'passed', 'got the job', 'feeling good', 'much better',
  'খুশি', 'আনন্দ', 'ধন্যবাদ', 'দারুণ', 'চমৎকার', 'ভালো আছি', 'ভালো লাগছে', 'খুব ভালো', 'সফল', 'গর্বিত', 'ভালো হয়েছে', 'শুভ',
  'khushi', 'khushi', 'dhonnobad', 'dhanyabad', 'valo achi', 'bhalo achi', 'darun', 'valo lagche', 'bhalo lagche',
];
const CURIOUS = ['why', 'how', 'what', 'really', 'wonder', 'কেন', 'কীভাবে', 'কিভাবে', 'কী ', 'কি ', 'সত্যি', 'কেমন', 'keno', 'kivabe', 'kemon'];
const NEGATION = /\b(not|never|no longer|don't|dont|can't|cant|isn't)\b|না(?![ঀ-৿])/i;

export function reactionFor(text: string): Reaction {
  const t = ` ${text.toLowerCase()} `;
  if (has(t, SEVERE)) return 'concern';
  if (has(t, DISTRESS)) return 'empathy';
  if (has(t, JOY)) return NEGATION.test(t) ? 'empathy' : 'joy'; // "not happy" must not get a grin
  if (t.includes('?') || t.includes('？') || has(t, CURIOUS)) return 'curious';
  return 'nod';
}

/** How the avatar should look while SPEAKING a reply, from the reply text. */
export type Tone = 'warm' | 'cheerful' | 'concerned';
const SAFETY_REPLY = ['emergency', 'your safety', 'hurt yourself', 'crisis', 'জরুরি', 'নিরাপত্তা', 'নিজের ক্ষতি'];
export function toneFor(reply: string): Tone {
  if (has(reply.toLowerCase(), SAFETY_REPLY)) return 'concerned'; // the app's crisis replies are spoken with a serious, caring face
  const r = reactionFor(reply);
  return r === 'joy' ? 'cheerful' : r === 'concern' ? 'concerned' : 'warm';
}
