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

/**
 * Finer reading of the AI's OWN reply text (English, Bangla, Hindi, Nepali, romanised Bangla) for the face while she speaks.
 * Crisis / safety wording always wins and gives a serious, caring face, never a smile. Text only; nothing about the user's face or voice.
 */
export type ReplyTone = 'warm' | 'concerned' | 'encouraging' | 'neutral';
const CONCERNED_REPLY = [
  'emergency', 'your safety', 'hurt yourself', 'harm yourself', 'crisis', 'helpline', 'hotline', 'in danger', 'not alone in this', 'reach out to someone', 'suicid', 'end your life',
  'জরুরি', 'নিরাপত্তা', 'নিজের ক্ষতি', 'হেল্পলাইন', 'আত্মহত্যা', 'বিপদে',
  'आपातकाल', 'सुरक्षा', 'खुद को नुकसान', 'हेल्पलाइन', 'आत्महत्या', 'संकट', 'खतरे',
  'आपतकालीन', 'सुरक्षाको', 'आफैँलाई हानि', 'आफूलाई हानि', 'हेल्पलाइन', 'संकटमा', 'खतरामा',
  'joruri', 'nirapotta', 'nirapotta',
];
const ENCOURAGING_REPLY = [
  'you can do', 'you can do this', 'well done', 'great job', 'good job', 'proud of you', 'keep going', 'one step at a time', 'you\'ve got this', 'you got this', 'that\'s wonderful', 'that is wonderful', 'congratulations', 'glad to hear', 'so glad', 'good for you', 'you are stronger', 'you\'re stronger', 'it is okay to try', 'give it a try',
  'পারবে', 'পারবেন', 'দারুণ', 'অভিনন্দন', 'গর্বিত', 'এগিয়ে যাও', 'এগিয়ে যান', 'চালিয়ে যাও', 'খুব ভালো', 'সাবাশ', 'শুভকামনা',
  'तुम कर सकते', 'आप कर सकते', 'आप कर सकती', 'शाबाश', 'बधाई', 'गर्व', 'आगे बढ़', 'बहुत अच्छा', 'हिम्मत रखो', 'हिम्मत रखें',
  'तपाईं सक्नुहुन्छ', 'तिमी सक्छौ', 'बधाई', 'गर्व', 'अगाडि बढ', 'धेरै राम्रो', 'साहस राख',
  'parbe', 'parben', 'abhinandon', 'egiye jao', 'darun',
];
const WARM_REPLY = [
  'sorry', 'i hear you', 'i understand', 'sounds', 'that must', 'here for you', 'i\'m here', 'i am here', 'thank you for sharing', 'thanks for sharing', 'it makes sense', 'it\'s okay', 'it is okay', 'take your time', 'gentle', 'be kind to yourself', 'feel',
  'দুঃখিত', 'বুঝতে পারছি', 'আমি আছি', 'পাশে আছি', 'ধন্যবাদ', 'সময় নাও', 'সময় নিন', 'স্বাভাবিক', 'কষ্ট', 'অনুভব',
  'माफ़', 'माफ', 'समझ सकता', 'समझ सकती', 'मैं यहाँ', 'मैं यहां', 'आपके साथ', 'धन्यवाद', 'अपना समय', 'स्वाभाविक', 'दुख', 'महसूस',
  'माफ गर्नुहोस्', 'बुझ्न सक्छु', 'म यहाँ', 'तपाईंसँग', 'धन्यवाद', 'समय लिनुहोस्', 'स्वाभाविक', 'दुःख', 'महसुस',
  'dukkhito', 'bujhte parchi', 'ami achi', 'pashe achi',
];
export function replyToneFor(reply: string): ReplyTone {
  const t = reply.toLowerCase();
  if (has(t, CONCERNED_REPLY)) return 'concerned';
  if (has(t, ENCOURAGING_REPLY)) return 'encouraging';
  if (has(t, WARM_REPLY)) return 'warm';
  return 'neutral';
}

/** How the avatar should look while SPEAKING a reply, from the reply text. */
export type Tone = 'warm' | 'cheerful' | 'concerned';
const SAFETY_REPLY = ['emergency', 'your safety', 'hurt yourself', 'crisis', 'জরুরি', 'নিরাপত্তা', 'নিজের ক্ষতি'];
export function toneFor(reply: string): Tone {
  if (has(reply.toLowerCase(), SAFETY_REPLY)) return 'concerned'; // the app's crisis replies are spoken with a serious, caring face
  const r = reactionFor(reply);
  return r === 'joy' ? 'cheerful' : r === 'concern' ? 'concerned' : 'warm';
}
