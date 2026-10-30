import type { Db } from '../config/database.js';
import type { Cipher } from '../utils/crypto.js';
import type { GlmClient } from './glmClient.js';
import {
  contentTokens, hasSecret, lifeSummaryOf, listMemories, retractSessionContribution, rewriteMemory, similarity, tokensMatchedIn, USER_MEMORY_LIMIT,
  type MemoryView,
} from './memoryService.js';
import { assessSafely, devanagariLang } from './safetyService.js';

/**
 * Spoken / typed memory commands ("forget that", "remember that my exam is on Friday", "that's wrong, it was my uncle not my father",
 * "what do you remember about me?") in English, Bangla, Hindi and Nepali. Regex only: no model call, and ambiguous text is never
 * handled (it simply goes on to the model). When a command is handled the text must NOT be sent to the model.
 */
export type CommandLang = 'en' | 'bn' | 'hi' | 'ne' | 'mixed' | 'auto';
export interface CommandDeps { db: Db; cipher: Cipher; glm?: GlmClient }
export interface CommandInput { userId: string; sessionId: string; text: string; lang: CommandLang }
export interface CommandResult { handled: boolean; reply?: string }

export type MemoryIntent =
  | { type: 'FORGET_SESSION' } | { type: 'FORGET_LAST' } | { type: 'FORGET_ABOUT'; topic: string }
  | { type: 'REMEMBER'; fact: string } | { type: 'CORRECT'; oldText: string; newText: string } | { type: 'LIST' };

// ---------- parsing ----------

const MAX_LEN = 360;
const FILLER = /^(?:(?:please|pls|hey|hi|hello|ok(?:ay)?|nivora|so|and|also|can you|could you|would you|will you|you can|just|দয়া করে|প্লিজ|শোনো|আচ্ছা|নিভোরা|कृपया|प्लीज|सुनो|अच्छा|निवोरा|प्लिज|सुन|हेर|कृपया)[\s,.:;!-]+)+/iu;
const clean = (s: string) => s.replace(/^[\s,.:;!?'"“”‘’-]+|[\s,.:;!?'"“”‘’।-]+$/gu, '').replace(/\s+/g, ' ').trim();
const GENERIC_TOPIC = /^(?:it|that|this|them|those|these|everything|all|me|anything|something|সব|সবকিছু|এটা|ওটা|यह|वो|वह|सब|सबकुछ|यो|त्यो|सबै)$/iu;

const R = (s: string, f = 'iu') => new RegExp(s.normalize('NFC'), f);

const SESSION_RE = [
  R(String.raw`^(?:do ?n'?t|do not|never|no need to|you (?:do ?n'?t|do not) (?:need|have) to)\s+(?:remember|save|keep|store|record|log)\s+(?:this|any of this|all of this|this (?:chat|conversation|session|call|talk|one)|our (?:chat|conversation|session|call|talk))(?:\s+(?:please|ok(?:ay)?))?$`),
  R(String.raw`^(?:forget|delete|erase)\s+(?:about\s+)?(?:this|all of this|our)\s+(?:chat|conversation|session|call|talk)(?:\s+(?:please|ok(?:ay)?))?$`),
  R(String.raw`^(?:এই|এটা|এটি|আজকের)\s*(?:সেশন|কথোপকথন|কথা|চ্যাট|কল|আলাপ)?\s*(?:আর\s*)?(?:মনে\s*রেখো\s*না|মনে\s*রাখবে\s*না|মনে\s*রাখার\s*দরকার\s*নেই|সেভ\s*করো\s*না|জমা\s*রেখো\s*না)$`),
  R(String.raw`^(?:এই|এটা)\s*(?:সেশন|কথোপকথন|চ্যাট|কল|আলাপ)(?:টা|টি)?\s*ভুলে\s*(?:যাও|যান)$`),
  R(String.raw`^(?:इस|यह|ये)\s*(?:सत्र|सेशन|बातचीत|चैट|कॉल|बात)?\s*(?:को\s*)?(?:याद\s*(?:मत|न)\s*रख(?:ो|ना|िए|ियेगा)|सेव\s*(?:मत|न)\s*कर(?:ो|ना))$`),
  R(String.raw`^इसे\s*याद\s*(?:मत|न)\s*रख(?:ो|ना|िए)$`),
  R(String.raw`^(?:इस|यह)\s*(?:सत्र|सेशन|बातचीत|चैट|कॉल)\s*(?:को\s*)?भूल\s*(?:जाओ|जाइए|जाइये)$`),
  R(String.raw`^(?:यो|यस)\s*(?:सत्र|सेशन|कुराकानी|च्याट|कल|कुरा)?\s*(?:लाई\s*)?याद\s*(?:नगर|नराख)(?:्नु)?(?:\s*है)?$`),
  R(String.raw`^(?:यो|यस)\s*(?:सत्र|सेशन|कुराकानी|च्याट|कल)\s*(?:लाई\s*)?बिर्स(?:िदेऊ|िदिनु)$`),
];
const LAST_RE = [
  R(String.raw`^(?:forget|do ?n'?t remember)\s+(?:that|what i (?:just )?(?:said|told you|mentioned)|what i said)(?:\s+(?:please|ok(?:ay)?))?$`),
  R(String.raw`^(?:এটা|ওটা|সেটা|এইটা|ওইটা|ওই কথাটা|এই কথাটা)\s*ভুলে\s*(?:যাও|যেও|যান)$`),
  R(String.raw`^(?:আমি\s*)?(?:যা|যা কিছু)\s*(?:এইমাত্র\s*)?(?:বললাম|বলেছি)\s*(?:তা|সেটা)?\s*ভুলে\s*(?:যাও|যান)$`),
  R(String.raw`^(?:इसे|उसे|यह|वो|वह|ये)\s*(?:बात\s*)?भूल\s*(?:जाओ|जाइए|जाइये|जाना)$`),
  R(String.raw`^मैंने\s*जो\s*(?:अभी\s*)?(?:कहा|बताया)\s*(?:वो\s*|उसे\s*)?भूल\s*(?:जाओ|जाइए)$`),
  R(String.raw`^(?:यो|त्यो)\s*(?:कुरा\s*)?बिर्स(?:िदेऊ|िदिनु|नु)$`),
];
const ABOUT_RE = [
  R(String.raw`^(?:forget|delete|erase|remove|stop remembering)\s+(?:everything\s+|all\s+|what\s+)?(?:(?:that\s+)?i\s+(?:said|told you|mentioned|shared|wrote)(?:\s+to you)?\s+)?(?:about|regarding|on)\s+(.{2,80})$`),
  R(String.raw`^(.{2,80}?)\s*(?:সম্পর্কে|বিষয়ে|ব্যাপারে|নিয়ে)\s*(?:আমি\s*)?(?:যা(?:\s*কিছু)?)?\s*(?:বলেছি|বলেছিলাম|বললাম)?\s*(?:তা|সেটা|সব|সবকিছু)?\s*(?:ভুলে\s*(?:যাও|যান)|মুছে\s*(?:দাও|ফেলো|ফেল|দিন))$`),
  R(String.raw`^(.{2,80}?)\s*কথা(?:টা)?\s*ভুলে\s*(?:যাও|যান)$`),
  R(String.raw`^(.{2,80}?)\s*(?:के\s*बारे\s*में|के\s*विषय\s*में|को\s*लेकर|के\s*बारे)\s*(?:मैंने\s*)?(?:जो(?:\s*कुछ)?)?\s*(?:कहा|बताया|बोला|लिखा)?\s*(?:था|है)?\s*(?:वो|वह|उसे|सब|सबकुछ)?\s*(?:भूल\s*(?:जाओ|जाइए|जाना|जाइये)|मिटा\s*(?:दो|दीजिए)|हटा\s*(?:दो|दीजिए))$`),
  R(String.raw`^(.{2,80}?)\s*(?:की|का|के)\s*बात\s*भूल\s*(?:जाओ|जाइए)$`),
  R(String.raw`^(.{2,80}?)\s*(?:को\s*)?(?:बारेमा|बारे\s*मा|सम्बन्धमा)\s*(?:मैले\s*)?(?:जे(?:\s*कुरा)?)?\s*(?:भनेको|भनेँ|भनें)?\s*(?:कुरा\s*)?(?:सबै\s*)?(?:बिर्सिदेऊ|बिर्सिदिनु|बिर्स|मेटिदेऊ|मेटाइदेऊ|हटाइदेऊ)$`),
];
const FIRST_PERSON = /(?:\b(?:my|i|i'm|i am|i've|i'll|me|we|our|mine)\b|আমার|আমি|আমাকে|আমাদের|मेरा|मेरी|मेरे|मैं|मुझे|मैंने|हमारा|हमारी|हमारे|मेरो|मलाई|मैले|हाम्रो|(?:^|\s)म(?:\s|$))/iu;
const REMEMBER_RE = [
  R(String.raw`^(?:remember|keep in mind|make a note|take note|note)[\s,:]+(?:that\s+)?(.{6,320})$`),
  R(String.raw`^(?:মনে\s*রেখো|মনে\s*রাখো|মনে\s*রাখবে|মনে\s*রাখুন)\s*[,:]?\s*(?:যে\s*)?(.{5,320})$`),
  R(String.raw`^(?:याद\s*रख(?:ना|ो|ियेगा|िएगा)|ध्यान\s*रख(?:ना|ो))\s*[,:]?\s*(?:कि\s*)?(.{5,320})$`),
  R(String.raw`^(?:याद\s*राख(?:्नु|ू)?|ध्यान\s*राख(?:्नु)?)\s*(?:है\s*)?[,:]?\s*(?:कि\s*)?(.{5,320})$`),
];
const NOT_A_FACT = /^(?:to\b|when\b|how\b|what\b|why\b|me\b|if\b|where\b|who\b)/i;

const WRONG_MARKER = [
  R(String.raw`^(?:no[,.]?\s*|oh no[,.]?\s*|sorry[,.]?\s*)?(?:that'?s|that is|it'?s|it is|this is)\s+(?:wrong|not right|incorrect|not true|not correct)\b[\s,;.:-]*(.+)$`),
  R(String.raw`^(?:correction|actually|no,? actually|i meant|let me correct that)\b[\s,;:.-]*(.+)$`),
  R(String.raw`^(?:ভুল|ঠিক\s*না|সঠিক\s*নয়|ঠিক\s*নয়)(?:\s*(?:বলেছ|হয়েছে|হচ্ছে|কথা))?[\s,।:]*(.+)$`),
  R(String.raw`^(?:नहीं[,]?\s*)?(?:ये|यह|वो|वह|यो|त्यो)?\s*(?:गलत|ग़लत|गल्ती)(?:\s*(?:है|था|हो|छ))?[\s,।:]*(.+)$`),
];
const CORRECT_BODY = [
  R(String.raw`^(?:it was|it is|it'?s|that was|he was|she was|they were|was|is|i meant)\s+(?:my\s+)?(.+?)\s*,?\s*(?:and\s+)?not\s+(?:my\s+)?(.+)$`, 'iu'), // new, old
  R(String.raw`^(?:it (?:was|is)n'?t|it was not|not|never)\s+(?:my\s+)?(.+?)\s*[,;]\s*(?:it (?:was|is)|but|rather|actually)?\s*(?:my\s+)?(.+)$`, 'iu'), // old, new
];
const CORRECT_BODY_INDIC: { re: RegExp; oldFirst: true }[] = [
  { re: R(String.raw`^(?:ওটা\s*|সে\s*|উনি\s*)?(?:আমার\s*)?(.+?)\s*(?:না|নয়)\s*[,]?\s*(?:বরং\s*)?(?:ওটা\s*|সে\s*|উনি\s*)?(?:আমার\s*)?(.+?)(?:\s*(?:ছিল(?:েন)?|ছিলো|হবে|হয়))?$`), oldFirst: true },
  { re: R(String.raw`^(?:वो\s*|वह\s*|ये\s*|यह\s*|वे\s*)?(?:मेरे\s*|मेरी\s*|मेरा\s*)?(.+?)\s*नहीं[,]?\s*(?:बल्कि\s*)?(?:वो\s*)?(?:मेरे\s*|मेरी\s*|मेरा\s*)?(.+?)(?:\s*(?:थे|था|थी|है|हैं))?$`), oldFirst: true },
  { re: R(String.raw`^(?:त्यो\s*)?(?:मेरो\s*)?(.+?)\s*(?:होइन|हैन)[,]?\s*(?:बरु\s*)?(?:मेरो\s*)?(.+?)(?:\s*(?:हो|थिए|थियो|हुनुहुन्थ्यो))?$`), oldFirst: true },
];
const LIST_RE = [
  R(String.raw`^(?:so\s+)?(?:what|which things|how much)\s+(?:do|did|can)\s+you\s+(?:remember|know|recall)(?:\s+(?:about|of)\s+me)?$`),
  R(String.raw`^what(?:'?s| is| have you)\s+(?:you\s+)?(?:saved|stored|remembered|noted)(?:\s+about me)?$`),
  R(String.raw`^do you remember (?:anything|something) about me$`),
  R(String.raw`^(?:তুমি\s*|আপনি\s*)?আমার\s*(?:সম্পর্কে|বিষয়ে|ব্যাপারে)\s*(?:তুমি\s*|আপনি\s*)?(?:কী|কি)(?:\s*(?:কী|কি))?\s*(?:মনে\s*রেখেছ[োন]?|জানো|জানেন|মনে\s*আছে)$`),
  R(String.raw`^(?:तुम|आप|तुम्हें|आपको)?\s*(?:मेरे\s*बारे\s*में)\s*(?:तुम|आप|तुम्हें|आपको)?\s*(?:क्या(?:[\s-]*क्या)?)\s*(?:याद\s*(?:रखते|रखती|है)|जानते|जानती|पता\s*है)(?:\s*(?:हो|हैं))?$`),
  R(String.raw`^.{0,25}मेरो\s*बारेमा.{0,25}के(?:\s*के)?\s*(?:याद|थाहा)\S*(?:\s+\S+){0,2}$`),
];

/** Pure intent detection. Returns null for anything that is not clearly a memory command. */
export function parseMemoryCommand(raw: string): MemoryIntent | null {
  let t = raw.normalize('NFC').replace(/[‘’]/g, "'").trim();
  if (!t || t.length > MAX_LEN || t.includes('\n')) return null;
  t = t.replace(FILLER, '').trim();
  const core = t.replace(/[\s.!।]+$/u, '');
  if (!core) return null;
  const question = /\?\s*$/.test(core);
  const bare = core.replace(/[?]+$/, '').trim();

  if (SESSION_RE.some((r) => r.test(bare))) return { type: 'FORGET_SESSION' };
  if (LAST_RE.some((r) => r.test(bare))) return { type: 'FORGET_LAST' };
  for (const r of ABOUT_RE) {
    const m = bare.match(r);
    const topic = m?.[1] ? clean(m[1]) : '';
    if (topic && !GENERIC_TOPIC.test(topic) && contentTokens(topic).length > 0) return { type: 'FORGET_ABOUT', topic };
  }
  if (LIST_RE.some((r) => r.test(bare))) return { type: 'LIST' };
  if (question) return null; // every remaining command is a statement
  for (const r of REMEMBER_RE) {
    const fact = clean(bare.match(r)?.[1] ?? '');
    if (fact.length >= 5 && !NOT_A_FACT.test(fact) && FIRST_PERSON.test(fact)) return { type: 'REMEMBER', fact };
  }
  for (const r of WRONG_MARKER) {
    const body = clean(bare.match(r)?.[1] ?? '');
    if (!body) continue;
    for (const [i, b] of CORRECT_BODY.entries()) {
      const m = body.match(b);
      if (m) {
        const [a, c] = [clean(m[1]!), clean(m[2]!)];
        const [oldText, newText] = i === 0 ? [c, a] : [a, c];
        if (oldText && newText && oldText.toLowerCase() !== newText.toLowerCase() && oldText.length <= 60 && newText.length <= 60) return { type: 'CORRECT', oldText, newText };
      }
    }
    for (const b of CORRECT_BODY_INDIC) {
      const m = body.match(b.re);
      if (!m) continue;
      const [oldText, newText] = [clean(m[1]!), clean(m[2]!)];
      if (oldText && newText && oldText !== newText && oldText.length <= 60 && newText.length <= 60) return { type: 'CORRECT', oldText, newText };
    }
  }
  return null;
}

// ---------- replies ----------

type L = 'en' | 'bn' | 'hi' | 'ne';
const REPLIES: Record<L, {
  session: string; last: string; lastNone: string; about: (t: string) => string; aboutNone: string; remembered: string; replaced: string;
  full: string; secret: string; off: string; priv: string; corrected: string; list: (items: string[], more: number) => string; listNone: string;
}> = {
  en: {
    session: "Okay. I won't keep anything from this conversation, and I've removed what I had from it. You're in control of what I remember.",
    last: "Okay, I've let that go. I won't hold on to it.",
    lastNone: "Okay, there's nothing from before that I'm keeping.",
    about: (t) => `Done. I've removed what I had saved about "${t}", and I won't bring it up.`,
    aboutNone: "I couldn't find anything saved about that, so there's nothing to hold on to. I won't bring it up.",
    remembered: "Got it, I'll remember that. You can see or delete it anytime in your memories.",
    replaced: "Thanks, I've updated that so it's current.",
    full: "My memory space for things you ask me to keep is full. You could delete something in your memories and then tell me again.",
    secret: "I'd rather not keep passwords, card numbers or similar private details. Is there something else about you you'd like me to remember?",
    off: "Memory is switched off in your settings, so I can't keep that. If you turn it on, I'm happy to remember it.",
    priv: "This session is set to private, so I'm not keeping anything from it. Start a session with memory on if you'd like me to remember that.",
    corrected: "Thanks for telling me. I've corrected it.",
    list: (items, more) => `Here's a little of what I remember: ${items.join('; ')}.${more > 0 ? ` Plus ${more} more small things.` : ''} You can see, change or delete all of it in your memories, or just tell me to forget something.`,
    listNone: "I haven't saved anything about you yet. If you'd like me to remember something, just say \"remember that...\".",
  },
  bn: {
    session: 'ঠিক আছে। এই কথোপকথনের কিছুই আমি রাখব না, আর যা জমা ছিল তা মুছে দিয়েছি। কী মনে রাখব সেটা আপনার হাতেই।',
    last: 'ঠিক আছে, ওটা আমি ছেড়ে দিলাম। আর মনে রাখব না।',
    lastNone: 'ঠিক আছে, আগের কিছুই আমি ধরে রাখছি না।',
    about: (t) => `হয়ে গেছে। "${t}" নিয়ে যা জমা ছিল মুছে দিয়েছি, আর এ নিয়ে কিছু তুলব না।`,
    aboutNone: 'এ বিষয়ে কিছু জমা পাইনি, তাই ধরে রাখার মতো কিছু নেই। আমি এটা তুলব না।',
    remembered: 'বুঝেছি, মনে রাখব। চাইলে যেকোনো সময় স্মৃতি-তালিকায় দেখতে বা মুছতে পারবেন।',
    replaced: 'ধন্যবাদ, তথ্যটা হালনাগাদ করে নিলাম।',
    full: 'আপনার মনে রাখতে বলা কথার জায়গা ভরে গেছে। স্মৃতি-তালিকা থেকে কিছু মুছে আবার বলতে পারেন।',
    secret: 'পাসওয়ার্ড, কার্ড নম্বর বা এমন গোপন তথ্য আমি রাখতে চাই না। আপনার সম্পর্কে অন্য কিছু মনে রাখতে বলবেন?',
    off: 'সেটিংসে স্মৃতি বন্ধ আছে, তাই এটা রাখতে পারছি না। চালু করলে খুশি হয়ে মনে রাখব।',
    priv: 'এই সেশনটি ব্যক্তিগত রাখা হয়েছে, তাই এর কিছুই রাখছি না। মনে রাখতে চাইলে স্মৃতি চালু রেখে নতুন সেশন শুরু করুন।',
    corrected: 'জানানোর জন্য ধন্যবাদ। ঠিক করে নিয়েছি।',
    list: (items, more) => `আপনার সম্পর্কে অল্প কিছু মনে আছে: ${items.join('; ')}।${more > 0 ? ` এছাড়া আরও ${more}টি ছোট কথা।` : ''} সবই স্মৃতি-তালিকায় দেখতে, বদলাতে বা মুছতে পারবেন, অথবা শুধু বলুন কী ভুলে যেতে হবে।`,
    listNone: 'আপনার সম্পর্কে এখনও কিছু জমা করিনি। কিছু মনে রাখতে চাইলে বলুন, "মনে রেখো..."।',
  },
  hi: {
    session: 'ठीक है। मैं इस बातचीत की कोई बात नहीं रखूँगा, और जो जमा था उसे हटा दिया है। क्या याद रखना है, यह आपके हाथ में है।',
    last: 'ठीक है, उसे छोड़ दिया। मैं उसे याद नहीं रखूँगा।',
    lastNone: 'ठीक है, पहले की कोई बात मैं पकड़कर नहीं रख रहा।',
    about: (t) => `हो गया। "${t}" के बारे में जो जमा था उसे हटा दिया है, और मैं इसका ज़िक्र नहीं करूँगा।`,
    aboutNone: 'इस बारे में कुछ जमा नहीं मिला, इसलिए रखने जैसा कुछ नहीं है। मैं इसका ज़िक्र नहीं करूँगा।',
    remembered: 'समझ गया, मैं याद रखूँगा। आप जब चाहें अपनी यादों में देख या हटा सकते हैं।',
    replaced: 'धन्यवाद, मैंने इसे अपडेट कर लिया है।',
    full: 'आपके कहे हुए याद रखने वाली बातों की जगह भर गई है। यादों में से कुछ हटाकर फिर बताइए।',
    secret: 'मैं पासवर्ड, कार्ड नंबर या ऐसी निजी जानकारी नहीं रखना चाहता। आपके बारे में कुछ और याद रखवाना चाहेंगे?',
    off: 'सेटिंग्स में याददाश्त बंद है, इसलिए मैं इसे नहीं रख सकता। चालू करने पर खुशी से याद रखूँगा।',
    priv: 'यह सत्र निजी रखा गया है, इसलिए इसकी कोई बात नहीं रख रहा। याद रखवाना हो तो याददाश्त चालू करके नया सत्र शुरू करें।',
    corrected: 'बताने के लिए धन्यवाद। मैंने इसे ठीक कर दिया है।',
    list: (items, more) => `आपके बारे में थोड़ा-सा याद है: ${items.join('; ')}।${more > 0 ? ` इसके अलावा ${more} छोटी बातें और।` : ''} सब कुछ आप यादों में देख, बदल या हटा सकते हैं, या बस बता दीजिए कि क्या भूलना है।`,
    listNone: 'आपके बारे में अभी कुछ जमा नहीं किया है। कुछ याद रखवाना हो तो कहिए, "याद रखना कि..."।',
  },
  ne: {
    session: 'हुन्छ। म यो कुराकानीको केही पनि राख्दिनँ, र जमा भएको कुरा हटाइदिएँ। के सम्झने भन्ने तपाईंकै हातमा छ।',
    last: 'हुन्छ, त्यो छोडिदिएँ। म त्यसलाई सम्झिराख्दिनँ।',
    lastNone: 'हुन्छ, अघिको केही पनि म समातेर राखेको छैन।',
    about: (t) => `भयो। "${t}" बारे जमा भएको कुरा हटाइदिएँ, र म यसबारे उल्लेख गर्दिनँ।`,
    aboutNone: 'यसबारे केही जमा भेटिएन, त्यसैले राख्नुपर्ने केही छैन। म यसबारे उल्लेख गर्दिनँ।',
    remembered: 'बुझें, म सम्झिराख्छु। चाहेको बेला तपाईंका सम्झनाहरूमा हेर्न वा हटाउन सक्नुहुन्छ।',
    replaced: 'धन्यवाद, मैले यसलाई अद्यावधिक गरें।',
    full: 'तपाईंले सम्झन भनेका कुराहरूको ठाउँ भरिएको छ। सम्झनाहरूबाट केही हटाएर फेरि भन्नुहोस्।',
    secret: 'म पासवर्ड, कार्ड नम्बर वा यस्ता निजी जानकारी राख्न चाहन्नँ। तपाईंबारे अरू केही सम्झाउन चाहनुहुन्छ?',
    off: 'सेटिङमा सम्झना बन्द छ, त्यसैले म यो राख्न सक्दिनँ। खोलेपछि खुसीसाथ सम्झिन्छु।',
    priv: 'यो सत्र निजी राखिएको छ, त्यसैले यसको केही पनि राखिरहेको छैन। सम्झाउन चाहनुहुन्छ भने सम्झना खोलेर नयाँ सत्र सुरु गर्नुहोस्।',
    corrected: 'भनिदिनुभएकोमा धन्यवाद। मैले ठीक पारें।',
    list: (items, more) => `तपाईंबारे थोरै सम्झना छ: ${items.join('; ')}।${more > 0 ? ` यसबाहेक अरू ${more} साना कुरा।` : ''} सबै कुरा तपाईं सम्झनाहरूमा हेर्न, बदल्न वा हटाउन सक्नुहुन्छ, वा के बिर्सने भनेर भन्नुहोस्।`,
    listNone: 'तपाईंबारे अहिलेसम्म केही जमा गरेको छैन। केही सम्झाउन चाहनुहुन्छ भने भन्नुहोस्, "याद राख्नु..."।',
  },
};

/** Reply language: the script of the text wins (Bangla / Devanagari), otherwise the session language, otherwise English. */
export function commandReplyLang(lang: CommandLang, text: string): L {
  if (/[ঀ-৿]/.test(text)) return 'bn';
  if (/[ऀ-ॿ]/.test(text)) return lang === 'hi' || lang === 'ne' ? lang : devanagariLang(text);
  return lang === 'bn' || lang === 'hi' || lang === 'ne' ? lang : 'en';
}

// ---------- actions ----------

const cut = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripPossessive = (s: string) => s.replace(/^(?:my|our|the|আমার|মেরा|मेरी|मेरा|मेरे|मेरो)\s+/iu, '').trim();
const matchesTopic = (tokens: string[], text: string) => tokensMatchedIn(tokens, text) >= (tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6));
const sentences = (t: string) => t.split(/(?<=[.!?।])\s+/u);

type Ctx = { db: Db; cipher: Cipher; userId: string; sessionId: string };

async function removeTopicFromNotes(c: Ctx, tokens: string[]): Promise<number> {
  let touched = 0;
  const redactText = (t: string) => sentences(t).filter((x) => !matchesTopic(tokens, x)).join(' ');
  const notes = await c.db.sessionNote.findMany({ where: { userId: c.userId }, take: 300 });
  for (const n of notes) {
    try {
      const o = JSON.parse(c.cipher.decrypt(n.encryptedContent)) as Record<string, unknown>;
      let changed = false;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') { const r = redactText(v); if (r !== v) { o[k] = r; changed = true; } }
        else if (Array.isArray(v)) { const r = v.filter((x) => typeof x !== 'string' || !matchesTopic(tokens, x)); if (r.length !== v.length) { o[k] = r; changed = true; } }
      }
      if (changed) { await c.db.sessionNote.update({ where: { id: n.id }, data: { encryptedContent: c.cipher.encrypt(JSON.stringify(o)) } }); touched++; }
    } catch { /* unreadable note: leave it */ }
  }
  const sums = await c.db.sessionSummary.findMany({ where: { session: { userId: c.userId } }, take: 300 });
  for (const sm of sums) {
    const t = c.cipher.decrypt(sm.encryptedSummary), r = redactText(t);
    if (r !== t) { await c.db.sessionSummary.update({ where: { id: sm.id }, data: { encryptedSummary: c.cipher.encrypt(r) } }); touched++; }
  }
  const hw = await c.db.homework.findMany({ where: { userId: c.userId }, take: 300 });
  const hwIds = hw.filter((h) => matchesTopic(tokens, c.cipher.decrypt(h.titleEncrypted))).map((h) => h.id);
  if (hwIds.length) { await c.db.homework.deleteMany({ where: { userId: c.userId, id: { in: hwIds } } }); touched += hwIds.length; }
  const themes = await c.db.themeTracker.findMany({ where: { userId: c.userId }, take: 300 });
  const thIds = themes.filter((t) => matchesTopic(tokens, c.cipher.decrypt(t.labelEncrypted))).map((t) => t.id);
  if (thIds.length) { await c.db.themeTracker.deleteMany({ where: { userId: c.userId, id: { in: thIds } } }); touched += thIds.length; }
  return touched;
}

async function forgetAbout(c: Ctx, topic: string, L: (typeof REPLIES)['en']): Promise<string> {
  const tokens = contentTokens(stripPossessive(topic));
  if (!tokens.length) return L.aboutNone;
  let removed = 0;
  const mems = await listMemories(c.db, c.cipher, c.userId, { take: 1000 });
  const ids = mems.filter((m) => matchesTopic(tokens, m.text)).map((m) => m.id);
  if (ids.length) { await c.db.memory.deleteMany({ where: { userId: c.userId, id: { in: ids } } }); removed += ids.length; }
  // the life summary is rewritten without the matching sentences instead of being deleted whole
  const life = lifeSummaryOf(await listMemories(c.db, c.cipher, c.userId, { source: 'SESSION' }));
  if (life && matchesTopic(tokens, life.text)) {
    const kept = sentences(life.text).filter((x) => !matchesTopic(tokens, x)).join(' ');
    if (kept) await rewriteMemory(c.db, c.cipher, c.userId, life.id, kept);
    else await c.db.memory.deleteMany({ where: { userId: c.userId, id: life.id } });
    removed++;
  }
  removed += await removeTopicFromNotes(c, tokens);
  // what was said about it earlier in this session is dropped too, so it cannot end up in this session's note
  const msgs = await c.db.sessionMessage.findMany({ where: { sessionId: c.sessionId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const mids = msgs.filter((m) => matchesTopic(tokens, c.cipher.decrypt(m.encryptedContent))).map((m) => m.id);
  if (mids.length) { await c.db.sessionMessage.deleteMany({ where: { sessionId: c.sessionId, id: { in: mids } } }); removed += mids.length; }
  return removed ? L.about(cut(stripPossessive(topic), 60)) : L.aboutNone;
}

async function forgetLast(c: Ctx, L: (typeof REPLIES)['en']): Promise<string> {
  const last = await c.db.sessionMessage.findFirst({ where: { sessionId: c.sessionId, role: 'user' }, orderBy: { createdAt: 'desc' } });
  if (!last) return L.lastNone;
  const text = c.cipher.decrypt(last.encryptedContent);
  await c.db.sessionMessage.delete({ where: { id: last.id } });
  const mems = await listMemories(c.db, c.cipher, c.userId, { take: 1000 });
  const ids = mems.filter((m) => m.kind !== 'SUMMARY' && similarity(text, m.text) >= 0.6).map((m) => m.id);
  if (ids.length) await c.db.memory.deleteMany({ where: { userId: c.userId, id: { in: ids } } });
  return L.last;
}

async function remember(c: Ctx, fact: string, L: (typeof REPLIES)['en']): Promise<string | null> {
  if (assessSafely(fact).severity !== 'NONE') return null; // safety first: the normal pipeline handles it, nothing is stored
  if (hasSecret(fact)) return L.secret;
  const prof = await c.db.userProfile.findUnique({ where: { userId: c.userId }, select: { preferencesJson: true } });
  if ((((prof?.preferencesJson ?? {}) as Record<string, unknown>).memoryEnabled) === false) return L.off;
  const sess = await c.db.therapySession.findFirst({ where: { id: c.sessionId, userId: c.userId }, select: { rememberThis: true } });
  if (sess && !sess.rememberThis) return L.priv;
  const text = cut(fact, 300);
  const existing = await listMemories(c.db, c.cipher, c.userId, { take: 1000 });
  const similar = existing.filter((m) => m.kind !== 'SUMMARY' && similarity(text, m.text) >= 0.5);
  const sameUser = similar.find((m) => m.source === 'USER');
  if (sameUser) {
    await c.db.memory.updateMany({ where: { id: sameUser.id, userId: c.userId }, data: { encryptedContent: c.cipher.encrypt(text) } });
    const others = similar.filter((m) => m.id !== sameUser.id).map((m) => m.id);
    if (others.length) await c.db.memory.deleteMany({ where: { userId: c.userId, id: { in: others } } });
    return L.replaced;
  }
  if ((await c.db.memory.count({ where: { userId: c.userId, source: 'USER' } })) >= USER_MEMORY_LIMIT) return L.full;
  // the user's own statement supersedes older session-derived versions of the same thing
  if (similar.length) await c.db.memory.deleteMany({ where: { userId: c.userId, id: { in: similar.map((m) => m.id) } } });
  await c.db.memory.create({ data: { userId: c.userId, encryptedContent: c.cipher.encrypt(text) } });
  return L.remembered;
}

async function correct(c: Ctx, oldRaw: string, newRaw: string, L: (typeof REPLIES)['en']): Promise<string | null> {
  const from = stripPossessive(oldRaw), to = stripPossessive(newRaw);
  if (from.length < 2 || to.length < 2 || hasSecret(to)) return null;
  const re = new RegExp(escapeRe(from), 'giu');
  let changed = 0;
  for (const m of await listMemories(c.db, c.cipher, c.userId, { take: 1000 })) {
    if (!re.test(m.text)) { re.lastIndex = 0; continue; }
    re.lastIndex = 0;
    if (await rewriteMemory(c.db, c.cipher, c.userId, m.id, m.text.replace(re, to), m.source === 'SESSION')) changed++;
  }
  const fix = (v: unknown): unknown => typeof v === 'string' ? v.replace(re, to) : Array.isArray(v) ? v.map(fix) : v;
  for (const n of await c.db.sessionNote.findMany({ where: { userId: c.userId }, take: 300 })) {
    try {
      const plain = c.cipher.decrypt(n.encryptedContent);
      const o = JSON.parse(plain) as Record<string, unknown>;
      const next = JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fix(v)])));
      if (next !== JSON.stringify(o)) { await c.db.sessionNote.update({ where: { id: n.id }, data: { encryptedContent: c.cipher.encrypt(next) } }); changed++; }
    } catch { /* unreadable note: leave it */ }
  }
  return changed ? L.corrected : null; // nothing stored to fix: it is an ordinary in-conversation correction for the model
}

function list(all: MemoryView[], L: (typeof REPLIES)['en']): string {
  const life = lifeSummaryOf(all);
  const facts = all.filter((m) => m.kind !== 'SUMMARY').sort((a, b) => (b.updatedAt ?? b.createdAt).getTime() - (a.updatedAt ?? a.createdAt).getTime());
  const shown = [...(life ? [cut(life.text, 160)] : []), ...facts.slice(0, 3).map((m) => cut(m.text, 100))];
  if (!shown.length) return L.listNone;
  return L.list(shown, Math.max(0, facts.length - 3));
}

/**
 * Handles a memory command, if the text is one. Cheap (regex, no model call), never acts on ambiguous text and never throws.
 * When `handled` is true the caller must not send the text to the model and should answer with `reply`.
 */
export async function handleMemoryCommand(d: CommandDeps, i: CommandInput): Promise<CommandResult> {
  try {
    const intent = parseMemoryCommand(i.text);
    if (!intent) return { handled: false };
    const owns = await d.db.therapySession.findFirst({ where: { id: i.sessionId, userId: i.userId }, select: { id: true } });
    if (!owns) return { handled: false };
    const L = REPLIES[commandReplyLang(i.lang, i.text)];
    const c: Ctx = { db: d.db, cipher: d.cipher, userId: i.userId, sessionId: i.sessionId };
    let reply: string | null = null;
    switch (intent.type) {
      case 'FORGET_SESSION':
        await d.db.therapySession.updateMany({ where: { id: i.sessionId, userId: i.userId }, data: { rememberThis: false } });
        await retractSessionContribution(d, i.userId, i.sessionId);
        reply = L.session;
        break;
      case 'FORGET_LAST': reply = await forgetLast(c, L); break;
      case 'FORGET_ABOUT': reply = await forgetAbout(c, intent.topic, L); break;
      case 'REMEMBER': reply = await remember(c, intent.fact, L); break;
      case 'CORRECT': reply = await correct(c, intent.oldText, intent.newText, L); break;
      case 'LIST': {
        const prof = await d.db.userProfile.findUnique({ where: { userId: i.userId }, select: { preferencesJson: true } });
        reply = (((prof?.preferencesJson ?? {}) as Record<string, unknown>).memoryEnabled) === false ? L.off : list(await listMemories(d.db, d.cipher, i.userId, { take: 1000 }), L);
        break;
      }
    }
    return reply ? { handled: true, reply } : { handled: false };
  } catch {
    return { handled: false };
  }
}
