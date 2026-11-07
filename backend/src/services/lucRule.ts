import { copyLang, type CopyLang } from './wellnessCopy.js';

/**
 * Listen -> Understand -> Confirm -> Suggest (LUC), the one behaviour every section follows:
 *  1. LISTEN: name the feeling / need in the person's own words.
 *  2. CONFIRM: restate what was understood and ask "did I get that right?".
 *  3. SUGGEST: only after the person confirms, offer 2-3 choices (from the action menu), never orders.
 * Pure rules, no model, nothing stored. Safety overrides all of it: on any risk the stage is BYPASS and the existing crisis flow runs unchanged.
 */
export type LucStage = 'BYPASS' | 'LISTEN' | 'CONFIRM' | 'SUGGEST';

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Stage decision
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** The last assistant turn ended by asking "did I get that right?" (en / bn / hi / ne). Only the tail is checked. */
const CONFIRM_ASKED = new RegExp([
  String.raw`\b(?:did|do|have) i (?:get|understand|understood|hear|heard|got) (?:that|this|it|you|what you)\b`,
  String.raw`\bis that (?:right|correct|how it is|what you mean)\b`,
  String.raw`\bam i (?:understanding|hearing|getting) (?:that|this|you|it)\b`,
  String.raw`\bdoes that (?:sound|feel) right\b`,
  String.raw`\bis (?:this|that) (?:close|about right)\b`,
  'ঠিক (?:বুঝেছি|বুঝলাম|বুঝতে পেরেছি|বলেছি|বলছি|ধরেছি)', 'আমি কি ঠিক', 'এটাই কি ঠিক', 'কথাটা কি ঠিক', 'ঠিক ধরতে পেরেছি',
  'सही (?:समझा|समझी|कहा|सुना)', 'ठीक (?:समझा|समझी)', 'क्या (?:यह|ये|मैंने|मैं) (?:सही|ठीक)',
  'सही (?:बुझें|बुझेँ|बुझेको|भनेँ|सुनेँ)', 'ठीक (?:बुझें|बुझेँ)', 'के (?:मैले|यो) (?:सही|ठीक)',
].join('|'), 'iu');
export const askedToConfirm = (assistantText: string | undefined | null): boolean => !!assistantText && CONFIRM_ASKED.test(assistantText.slice(-300));

// Unicode-aware token edges: \b does not work for Bangla / Devanagari.
const EDGE_L = String.raw`(?:^|[\s,.!?;:।"'(])`;
const EDGE_R = String.raw`(?=$|[\s,.!?;:।"')])`;
const tok = (alts: string[]) => new RegExp(`${EDGE_L}(?:${alts.join('|')})${EDGE_R}`, 'iu');
const AFFIRM_START = new RegExp(`^\\s*(?:${[
  'yes', 'yeah', 'yep', 'yup', 'right', 'exactly', 'correct', 'true', 'precisely', "that'?s (?:right|it|true|correct)", 'that is (?:right|it|true|correct)', 'sure', 'ok', 'okay', 'mm-?hm+', 'absolutely',
  'হ্যাঁ', 'হ্যা', 'হাঁ', 'জি', 'ঠিক', 'ঠিকই', 'সঠিক', 'সত্যি', 'একদম', 'ঠিক বলেছ\\S*', 'ঠিক বুঝেছ\\S*', 'হুম', 'ওকে', 'অবশ্যই',
  'हाँ', 'हां', 'जी', 'सही', 'बिल्कुल', 'ठीक', 'ठीक है', 'सही कहा', 'हम्म',
  'हो', 'हजुर', 'हो नि', 'ठिक', 'सही हो', 'ठीक हो', 'बिल्कुल हो',
].join('|')})${EDGE_R}`, 'iu');
const NEGATION = tok([
  'no', 'nope', 'not', "n't", 'never', "isn'?t", "wasn'?t", "don'?t", "didn'?t", "doesn'?t", 'wrong',
  'না', 'নয়', 'নেই', 'ভুল', 'নাহ',
  'नहीं', 'नही', 'ना', 'गलत', 'नहि',
  'होइन', 'हैन', 'छैन', 'गलत',
]);
const NEGATION_LOOSE = /n't\b|\bnot\b/i; // "isn't", "doesn't" glued to a word
const CORRECTION = tok([
  'but', 'however', 'though', 'actually', 'although', 'except', 'more like', 'kind of', 'sort of', 'partly', 'not quite', 'not exactly',
  'কিন্তু', 'তবে', 'আসলে', 'যদিও', 'একটু', 'অনেকটা',
  'लेकिन', 'पर', 'मगर', 'दरअसल', 'असल में', 'थोड़ा',
  'तर', 'तर्', 'वास्तवमा', 'अलि',
]);
const MAX_AFFIRM_WORDS = 8;

export type ReplyKind = 'AFFIRM' | 'CORRECT' | 'OTHER';
/** A reply to "did I get that right?": a clean yes, a no / correction, or anything else. Only a clean yes counts as AFFIRM. */
export function classifyReply(text: string): ReplyKind {
  const t = text.trim();
  if (!t) return 'OTHER';
  if (NEGATION.test(t) || NEGATION_LOOSE.test(t)) return 'CORRECT';
  if (CORRECTION.test(t)) return 'CORRECT';
  const words = t.split(/\s+/).filter(Boolean).length;
  if (AFFIRM_START.test(t) && words <= MAX_AFFIRM_WORDS && !t.includes('?')) return 'AFFIRM';
  return 'OTHER';
}

export interface StageInput {
  /** True on any risk: this turn, the session flag, the person's recent state. */
  riskBypass: boolean;
  lastAssistant?: string | null;
  userText: string;
}
/**
 * LISTEN: nothing pending, so reflect + ask the confirming question. CONFIRM: a confirmation was asked and the answer is a correction or
 * anything unclear (ambiguity NEVER jumps ahead). SUGGEST: a confirmation was asked and the reply is a clean yes. BYPASS: risk.
 */
export function decideStage(i: StageInput): LucStage {
  if (i.riskBypass) return 'BYPASS';
  if (!askedToConfirm(i.lastAssistant)) return 'LISTEN';
  return classifyReply(i.userText) === 'AFFIRM' ? 'SUGGEST' : 'CONFIRM';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Prompt rules
// ---------------------------------------------------------------------------------------------------------------------------------------------

const CONFIRM_PHRASES = 'Use the person\'s language for the confirming question (e.g. "Did I get that right?", "ঠিক বুঝেছি তো?", "क्या मैंने सही समझा?", "के मैले सही बुझें?").';

/** Static rule text (for docs / evals): the whole behaviour in one place. */
export const LUC_RULE = `LISTEN, UNDERSTAND, CONFIRM, THEN SUGGEST
1) Listen: name the feeling or need in the person's own words.
2) Restate what you understood in one short line and ask once: "did I get that right?"
3) Only after they confirm, offer 2-3 gentle options as choices. Never before, never as orders.
If they correct you, take the correction, restate again and ask again. If the answer is unclear, ask again. Never jump ahead.`;

/** Per-turn block for the chat prompt. `hasMenu`: an ACTION MENU follows this block. */
export function lucBlock(stage: LucStage, hasMenu = false): string {
  switch (stage) {
    case 'LISTEN':
      return `THIS TURN (listen and confirm): first reflect the feeling or need in their own words, then restate what you understood in one short line and end with ONE question asking if you got it right. ${CONFIRM_PHRASES} Offer NO options, exercises or suggestions in this reply (if they asked directly what to do, say you would like to be sure you understood first).`;
    case 'CONFIRM':
      return `THIS TURN (confirm again): they did not clearly confirm. Take in what they just said (a correction is valuable), restate your understanding once more in one short line in their words and end with ONE question asking if that is right. ${CONFIRM_PHRASES} Offer NO options or suggestions in this reply.`;
    case 'SUGGEST':
      return hasMenu
        ? 'THIS TURN (they confirmed): thank them in a few words, then offer 2-3 gentle options in your own words as CHOICES ("if you like, we could ... or ..."), using only things from the ACTION MENU above, or simply continuing to talk. Never an order; saying no is fine. This replaces the "at most one" wording of the action rules for what you SAY, but append [[ACTION:ID]] for at most ONE of them (the one you lean towards): the app shows one suggestion card at a time.'
        : 'THIS TURN (they confirmed): thank them in a few words and ask what would feel most helpful now, offering to keep talking or to pause. No exercises or app features were listed, so name none.';
    default:
      return '';
  }
}

/** For one-shot AI text (sleep coach / night whisper / home analysis): no chance to ask, so reflect, check gently, offer a choice. */
export const LUC_SINGLE_SHOT = "Listen first: name the feeling or need in the person's own words. Present your reading as a gentle check, never as a verdict, and end it with a short tentative question such as \"does that fit?\". Anything you suggest is ONE small option phrased as a choice (\"if you like ...\"), never an order.";

// ---------------------------------------------------------------------------------------------------------------------------------------------
// "What I can do here": the short menu at the start of a section (static, no model)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const SECTIONS = ['CHAT', 'KAIZEN', 'SLEEP', 'HOME'] as const;
export type Section = (typeof SECTIONS)[number];
type L = Record<CopyLang, string>;
export interface CapabilityItem { id: string; label: string }
export interface Capabilities { section: Section; kind: string | null; title: string; items: CapabilityItem[] }

const TITLE: L = { en: 'Here is what I can do with you here', bn: 'এখানে আমি আপনার সঙ্গে যা করতে পারি', hi: 'यहाँ मैं आपके साथ यह कर सकता हूँ', ne: 'यहाँ म तपाईंसँग यो गर्न सक्छु' };

const CHAT_BASE: { id: string; label: L }[] = [
  { id: 'LISTEN', label: { en: 'Listen to whatever is on your mind', bn: 'আপনার মনে যা আছে তা মন দিয়ে শোনা', hi: 'आपके मन की बात ध्यान से सुनना', ne: 'तपाईंको मनमा जे छ ध्यान दिएर सुन्नु' } },
  { id: 'EXERCISE', label: { en: 'Try a short calming exercise together', bn: 'একসঙ্গে ছোট একটি শান্ত হওয়ার অনুশীলন করা', hi: 'साथ में एक छोटा शांत करने वाला अभ्यास करना', ne: 'सँगै एउटा छोटो शान्त पार्ने अभ्यास गर्नु' } },
  { id: 'NOTE', label: { en: 'Turn this into a private note or one tiny step', bn: 'এটাকে একটি ব্যক্তিগত নোট বা একটি ছোট পদক্ষেপে বদলানো', hi: 'इसे एक निजी नोट या एक छोटे कदम में बदलना', ne: 'यसलाई एउटा निजी नोट वा एउटा सानो कदममा बदल्नु' } },
];
const CHAT_KIND: Partial<Record<string, { id: string; label: L }>> = {
  ANXIETY: { id: 'WORRY', label: { en: 'Look gently at a worry that keeps coming back', bn: 'বারবার ফিরে আসা একটি দুশ্চিন্তাকে আলতো করে দেখা', hi: 'बार-बार लौटने वाली एक चिंता को धीरे से देखना', ne: 'बारम्बार फर्किरहने एउटा चिन्तालाई बिस्तारै हेर्नु' } },
  DEPRESSION: { id: 'SMALL_STEP', label: { en: 'Find one very small thing that feels doable today', bn: 'আজ করা সম্ভব মনে হয় এমন একটি খুব ছোট কাজ খুঁজে নেওয়া', hi: 'आज के लिए एक बहुत छोटा, करने लायक काम ढूँढना', ne: 'आजका लागि गर्न सकिने एउटा धेरै सानो काम खोज्नु' } },
  SLEEP: { id: 'WIND_DOWN', label: { en: 'Talk through what keeps you awake and a gentle wind-down', bn: 'কী আপনাকে জাগিয়ে রাখে তা নিয়ে কথা বলা এবং ধীরে শান্ত হওয়ার উপায়', hi: 'क्या आपको जगाए रखता है, इस पर बात करना और धीरे-धीरे शांत होने का तरीका', ne: 'के कुराले तपाईंलाई जगाइराख्छ त्यसबारे कुरा गर्नु र बिस्तारै शान्त हुने तरिका' } },
  ADDICTION: { id: 'URGE', label: { en: 'Talk through an urge and what helps it pass', bn: 'তাড়নার কথা বলা এবং কী সেটা কাটাতে সাহায্য করে তা দেখা', hi: 'किसी तलब पर बात करना और क्या उसे गुज़रने में मदद करता है', ne: 'कुनै तीव्र इच्छाबारे कुरा गर्नु र के कुराले त्यो बित्न मद्दत गर्छ हेर्नु' } },
  GRIEF: { id: 'REMEMBER', label: { en: 'Make room to remember someone or something you miss', bn: 'যাকে বা যা কিছু মিস করছেন তাকে স্মরণ করার জায়গা তৈরি করা', hi: 'जिसे या जिस चीज़ को आप याद करते हैं, उसे याद करने की जगह बनाना', ne: 'जसलाई वा जुन कुरालाई सम्झिरहनुभएको छ त्यसलाई सम्झने ठाउँ बनाउनु' } },
  RELATIONSHIP: { id: 'RELATING', label: { en: 'Think through a hard conversation or a relationship', bn: 'কঠিন কোনো কথোপকথন বা সম্পর্ক নিয়ে ভাবা', hi: 'किसी कठिन बातचीत या रिश्ते के बारे में सोचना', ne: 'कुनै कठिन कुराकानी वा सम्बन्धबारे सोच्नु' } },
};
const KAIZEN: { id: string; label: L }[] = [
  { id: 'SHARE_GOAL', label: { en: 'Hear a goal in your own words', bn: 'আপনার নিজের কথায় একটি লক্ষ্য শোনা', hi: 'आपके अपने शब्दों में एक लक्ष्य सुनना', ne: 'तपाईंकै शब्दमा एउटा लक्ष्य सुन्नु' } },
  { id: 'CLARIFY', label: { en: 'Ask a question or two if the goal feels fuzzy', bn: 'লক্ষ্যটা অস্পষ্ট মনে হলে এক-দুটি প্রশ্ন করা', hi: 'लक्ष्य धुंधला लगे तो एक-दो सवाल पूछना', ne: 'लक्ष्य अस्पष्ट लागे एक-दुई प्रश्न सोध्नु' } },
  { id: 'TINY_STEPS', label: { en: 'Split it into tiny steps, after you say it sounds right', bn: 'আপনি ঠিক বললে তারপর এটাকে ছোট ছোট ধাপে ভাগ করা', hi: 'आपके सही कहने के बाद इसे छोटे-छोटे कदमों में बाँटना', ne: 'तपाईंले ठिक भनेपछि यसलाई साना-साना कदममा बाँड्नु' } },
  { id: 'ADJUST', label: { en: 'Make the steps smaller if they feel too hard', bn: 'ধাপগুলো কঠিন লাগলে আরও ছোট করা', hi: 'कदम मुश्किल लगें तो उन्हें और छोटा करना', ne: 'कदमहरू गाह्रो लागे अझ सानो बनाउनु' } },
];
const SLEEP: { id: string; label: L }[] = [
  { id: 'LOG', label: { en: 'Log how you slept last night', bn: 'গত রাতে কেমন ঘুমিয়েছেন তা লিখে রাখা', hi: 'बीती रात आप कैसे सोए, यह दर्ज करना', ne: 'हिजो राति कस्तो सुत्नुभयो भनेर लेख्नु' } },
  { id: 'NIGHT_WHISPER', label: { en: 'Set down a racing thought before sleep', bn: 'ঘুমের আগে মাথায় ঘোরা একটি চিন্তা নামিয়ে রাখা', hi: 'सोने से पहले दिमाग में दौड़ते एक विचार को उतार देना', ne: 'सुत्नु अघि दौडिरहेको एउटा विचारलाई तल राख्नु' } },
  { id: 'ROUTINE', label: { en: "Look at tonight's gentle wind-down routine", bn: 'আজ রাতের ধীরে শান্ত হওয়ার রুটিন দেখা', hi: 'आज रात की धीमी विंड-डाउन दिनचर्या देखना', ne: 'आज रातको बिस्तारै शान्त हुने दिनचर्या हेर्नु' } },
  { id: 'SOUNDS', label: { en: 'Play calming sounds', bn: 'শান্ত করার শব্দ চালানো', hi: 'शांत करने वाली आवाज़ें चलाना', ne: 'शान्त पार्ने आवाजहरू बजाउनु' } },
];
const HOME: { id: string; label: L }[] = [
  { id: 'FOCUS', label: { en: "See today's one gentle focus", bn: 'আজকের একটি হালকা ফোকাস দেখা', hi: 'आज का एक हल्का फ़ोकस देखना', ne: 'आजको एउटा हल्का फोकस हेर्नु' } },
  { id: 'CHECK_IN', label: { en: 'Do a short check-in on how you feel', bn: 'আপনি কেমন বোধ করছেন তার ছোট একটি check-in করা', hi: 'आप कैसा महसूस कर रहे हैं, इसका एक छोटा चेक-इन करना', ne: 'तपाईं कस्तो महसुस गर्दै हुनुहुन्छ भनेर छोटो चेक-इन गर्नु' } },
  { id: 'TALK', label: { en: 'Talk with Nivora about your day', bn: 'আপনার দিন নিয়ে Nivora-র সঙ্গে কথা বলা', hi: 'अपने दिन के बारे में Nivora से बात करना', ne: 'आफ्नो दिनबारे Nivora सँग कुरा गर्नु' } },
  { id: 'PATTERN', label: { en: "Look at a pattern from your week, if you'd like", bn: 'চাইলে আপনার সপ্তাহের একটি প্যাটার্ন দেখা', hi: 'चाहें तो अपने हफ़्ते का एक पैटर्न देखना', ne: 'चाहनुभयो भने आफ्नो हप्ताको एउटा प्याटर्न हेर्नु' } },
];

/** The short "what I can do here" menu for the start of a section. `kind` is the topic kind for CHAT (ignored elsewhere). Static and localized. */
export function sectionCapabilities(section: Section, kind: string | null | undefined, locale?: string | null): Capabilities {
  const lg = copyLang(locale);
  const rows = section === 'KAIZEN' ? KAIZEN : section === 'SLEEP' ? SLEEP : section === 'HOME' ? HOME
    : [CHAT_BASE[0]!, ...(kind && CHAT_KIND[kind] ? [CHAT_KIND[kind]!] : []), ...CHAT_BASE.slice(1)].slice(0, 4);
  return { section, kind: section === 'CHAT' ? (kind ?? null) : null, title: TITLE[lg], items: rows.map((r) => ({ id: r.id, label: r.label[lg] })) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Kaizen: is the goal clear enough to split? (rules, no model)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const ACTION_VERB = /\b(walk|run|jog|read|write|journal|sleep|wake|drink|eat|cook|exercise|stretch|meditate|breathe|study|practi[cs]e|learn|call|text|meet|visit|clean|tidy|organi[sz]e|save|spend|quit|stop|start|cut|reduce|limit|avoid|pray|swim|cycle|bike|lift|train|play|draw|paint|sing|dance|plan|finish|submit|apply|go|get up|stand|sit|talk|speak|say|ask|thank|rest|log|track|do|make|take|try|build|create|reply|send|brush|floss|shower|stay)\b|হাঁট|দৌড়|পড়|লিখ|ঘুম|খাও|খাব|পান|ব্যায়াম|যোগ|ধ্যান|শিখ|ফোন|কথা|পরিষ্কার|ছাড়|কমাব|কমান|করব|করতে|করা|যাব|যেতে|उठ|चल|दौड़|पढ़|लिख|सो|पी|खा|व्यायाम|योग|ध्यान|सीख|फोन|बात|साफ|छोड़|कम|करना|करूँ|करूंगा|जाना|उठ्|हिँड|दौड|पढ|लेख|सुत|खान|पिउ|व्यायाम|सिक|कुरा|सफा|छोड|गर्न|गर्ने|गर्छु|जान/iu;
const MEASURE = /\d|[০-৯]|[०-९]|\b(?:once|twice|daily|every|each|per|weekly|minutes?|mins?|hours?|times|days?|weeks?|a day|a week|morning|evening|night|before|after|one|two|three|five|ten)\b|প্রতি|প্রতিদিন|মিনিট|ঘণ্টা|দিন|সপ্তাহ|সকাল|রাত|বিকেল|একবার|দুই|তিন|पाँच|हर|रोज़|रोज|मिनट|घंटे|घण्टा|दिन|हफ़्ते|हप्ता|सुबह|शाम|रात|बिहान|साँझ|प्रत्येक|हरेक|मिनेट/iu;
const VAGUE_WORD = /\b(?:more|better|healthier|happier|good|nice|improve|improving|fit|fitter|well|myself|life|stuff|things|something|anything|productive|balanced?)\b|ভালো|আরও|বেশি|উন্নতি|সুস্থ|সুখী|बेहतर|ज़्यादा|ज्यादा|अच्छा|सुधार|स्वस्थ|खुश|राम्रो|धेरै|सुधार|स्वस्थ|खुसी/iu;

export interface GoalClarity { clear: boolean; reasons: ('SHORT' | 'NO_VERB' | 'NO_MEASURE')[] }
const wordCount = (t: string) => (t.match(/\p{L}[\p{L}\p{M}'’]*|\d+/gu) ?? []).length;

/**
 * Vague when: too short (under 3 words), OR it has no action verb and nothing measurable, OR it only holds fuzzy words ("be healthier") with
 * nothing measurable. A time per day counts as measurable. Unknown scripts or odd input never make it vaguer than these rules say.
 */
export function goalClarity(title: string, opts: { timePerDayMin?: number | null } = {}): GoalClarity {
  const t = title.trim();
  const reasons: GoalClarity['reasons'] = [];
  const measurable = MEASURE.test(t) || (typeof opts.timePerDayMin === 'number' && opts.timePerDayMin > 0);
  const hasVerb = ACTION_VERB.test(t);
  if (wordCount(t) < 3) reasons.push('SHORT');
  if (!hasVerb) reasons.push('NO_VERB');
  if (!measurable) reasons.push('NO_MEASURE');
  const vagueOnly = VAGUE_WORD.test(t) && !MEASURE.test(t);
  const vague = reasons.includes('SHORT') || (!hasVerb && !measurable) || vagueOnly;
  return { clear: !vague, reasons };
}

export interface GoalCopy { questions: string[]; understood: string; confirm: string; notQuite: string; intro: string }
const Q_WHAT: L = { en: 'What would you actually do, in one short sentence? For example "walk" or "write".', bn: 'আপনি আসলে কী করবেন, এক ছোট বাক্যে বলবেন? যেমন "হাঁটব" বা "লিখব"।', hi: 'आप असल में क्या करेंगे, एक छोटे वाक्य में बताइए? जैसे "टहलना" या "लिखना"।', ne: 'तपाईं वास्तवमा के गर्नुहुन्छ, एउटा छोटो वाक्यमा भन्नुहोस्? जस्तै "हिँड्ने" वा "लेख्ने"।' };
const Q_HOW: L = { en: 'How often or for how long feels doable, even a very small amount?', bn: 'কতবার বা কতক্ষণ করা সম্ভব মনে হয়, খুব অল্প হলেও চলবে?', hi: 'कितनी बार या कितनी देर करना संभव लगता है, बहुत थोड़ा भी चलेगा?', ne: 'कति पटक वा कति बेर गर्न सकिन्छ जस्तो लाग्छ, धेरै थोरै भए पनि हुन्छ?' };
const INTRO: L = { en: 'I want to be sure I understand before we break this into steps.', bn: 'ধাপে ভাগ করার আগে আমি নিশ্চিত হতে চাই যে ঠিক বুঝেছি।', hi: 'कदमों में बाँटने से पहले मैं पक्का करना चाहता हूँ कि मैंने सही समझा।', ne: 'कदममा बाँड्नु अघि मैले सही बुझें भन्ने पक्का गर्न चाहन्छु।' };
const UNDERSTOOD: L = { en: 'Here is what I understood: you would like to work on "{goal}". Did I get that right?', bn: 'আমি যা বুঝেছি: আপনি "{goal}" নিয়ে কাজ করতে চান। ঠিক বুঝেছি তো?', hi: 'मैंने जो समझा: आप "{goal}" पर काम करना चाहते हैं। क्या मैंने सही समझा?', ne: 'मैले बुझेको: तपाईं "{goal}" मा काम गर्न चाहनुहुन्छ। के मैले सही बुझें?' };
const UNDERSTOOD_WITH: L = { en: 'Here is what I understood: you would like to work on "{goal}" ({details}). Did I get that right?', bn: 'আমি যা বুঝেছি: আপনি "{goal}" নিয়ে কাজ করতে চান ({details})। ঠিক বুঝেছি তো?', hi: 'मैंने जो समझा: आप "{goal}" पर काम करना चाहते हैं ({details})। क्या मैंने सही समझा?', ne: 'मैले बुझेको: तपाईं "{goal}" मा काम गर्न चाहनुहुन्छ ({details})। के मैले सही बुझें?' };
const CONFIRM_LABEL: L = { en: 'Yes, that is right', bn: 'হ্যাঁ, ঠিক', hi: 'हाँ, सही है', ne: 'हो, ठिक छ' };
const NOT_QUITE_LABEL: L = { en: 'Not quite, let me change it', bn: 'ঠিক নয়, বদলাতে চাই', hi: 'बिल्कुल नहीं, बदलना चाहता हूँ', ne: 'ठ्याक्कै होइन, बदल्न चाहन्छु' };

/** Copy for the Kaizen guided goal flow. Questions: 1 or 2, chosen from what is missing. `details` = the person's clarifying answers. */
export function goalCopy(locale: string | null | undefined, clarity: GoalClarity, goal: string, details: string[] = []): GoalCopy {
  const lg = copyLang(locale);
  const q: string[] = [];
  if (clarity.reasons.includes('NO_VERB') || clarity.reasons.includes('SHORT')) q.push(Q_WHAT[lg]);
  if (clarity.reasons.includes('NO_MEASURE') || !q.length) q.push(Q_HOW[lg]);
  const shown = goal.replace(/"/g, "'");
  const det = details.map((x) => x.replace(/"/g, "'")).join('; ');
  const fillText = (s: string) => s.replace('{goal}', shown).replace('{details}', det);
  return {
    intro: INTRO[lg], questions: q.slice(0, 2),
    understood: fillText(details.length ? UNDERSTOOD_WITH[lg] : UNDERSTOOD[lg]), confirm: CONFIRM_LABEL[lg], notQuite: NOT_QUITE_LABEL[lg],
  };
}
