import type { GKey } from '../i18n/guideT';

/** Avatar expression the guide uses for a step. Mapped onto Avatar props by avatarPropsFor (see GuideBubble). */
export type GuideMood = 'warm' | 'curious' | 'proud' | 'calm';
export interface GuideStep { textKey: GKey; mood: GuideMood; /** id registered with useGuideTarget; falls back to a centred bubble when it cannot be measured. */ targetRef?: string }
export interface GuideRoute { name: string; params?: Record<string, unknown> }

export type GuideFeatureId =
  | 'tour' | 'home' | 'breathe' | 'journal' | 'exercises' | 'programs' | 'garden' | 'sounds'
  | 'sessions' | 'chat' | 'actionCards' | 'sleep' | 'kaizen' | 'insights' | 'week'
  | 'profile' | 'suggest' | 'aiSees' | 'invite' | 'why'
  | 'consentJournal' | 'consentWellness' | 'consentHealth' | 'fallback';

export interface GuideFeature {
  id: GuideFeatureId;
  /** Title key (also used for the "What is this?" chip label). */
  featureKey: GKey;
  /** Bump when the feature changes: a user who saw an older version gets the one-step whatsNewKey instead of the full intro. */
  version: number;
  steps: GuideStep[];
  whatsNewKey?: GKey;
  /** Existing route that is safe to open (no params needed, nothing is sent or started). */
  tryItRoute?: GuideRoute;
  /** Help that explains something on screen (consent prompt, fallback). Allowed at level Hints; plain intros are Full only. */
  contextual?: boolean;
  /** Where the integrator calls useGuideFeature (documentation only). */
  screen: string;
}

const s = (textKey: GKey, mood: GuideMood, targetRef?: string): GuideStep => ({ textKey, mood, ...(targetRef ? { targetRef } : {}) });

export const GUIDE_FEATURES: Record<GuideFeatureId, GuideFeature> = {
  tour: { id: 'tour', featureKey: 'gTitleTour', version: 1, screen: 'HomeScreen (first run, handled inside useGuideFeature("home"))', steps: [s('gTour1', 'warm'), s('gTour2', 'curious'), s('gTour3', 'calm'), s('gTour4', 'calm')] },
  home: { id: 'home', featureKey: 'gTitleHome', version: 2, whatsNewKey: 'gHomeNew', screen: 'HomeScreen', steps: [s('gHome1', 'curious', 'home.checkin'), s('gHome2', 'warm', 'home.today'), s('gHome3', 'proud', 'home.step')] },
  breathe: { id: 'breathe', featureKey: 'gTitleBreathe', version: 1, screen: 'ExerciseScreen (kind=breathing)', tryItRoute: { name: 'Exercise', params: { kind: 'breathing' } }, steps: [s('gBreathe1', 'calm'), s('gBreathe2', 'proud')] },
  journal: { id: 'journal', featureKey: 'gTitleJournal', version: 2, whatsNewKey: 'gJournalNew', screen: 'JournalScreen (journal list) or JournalEditScreen', tryItRoute: { name: 'JournalEdit' }, steps: [s('gJournal1', 'warm'), s('gJournal2', 'curious'), s('gJournal3', 'calm')] },
  exercises: { id: 'exercises', featureKey: 'gTitleExercises', version: 1, screen: 'ActivitiesScreen (Wellness route)', tryItRoute: { name: 'Wellness' }, steps: [s('gExercises1', 'warm'), s('gExercises2', 'curious'), s('gExercises3', 'calm')] },
  programs: { id: 'programs', featureKey: 'gTitlePrograms', version: 1, screen: 'ProgramsScreen', tryItRoute: { name: 'Programs' }, steps: [s('gPrograms1', 'warm'), s('gPrograms2', 'calm')] },
  garden: { id: 'garden', featureKey: 'gTitleGarden', version: 1, screen: 'GardenScreen', tryItRoute: { name: 'Garden' }, steps: [s('gGarden1', 'proud'), s('gGarden2', 'calm')] },
  sounds: { id: 'sounds', featureKey: 'gTitleSounds', version: 1, screen: 'SoundsScreen', tryItRoute: { name: 'Sounds' }, steps: [s('gSounds1', 'calm'), s('gSounds2', 'warm')] },
  sessions: { id: 'sessions', featureKey: 'gTitleSessions', version: 1, screen: 'SessionProgramsListScreen (SessionsTab)', steps: [s('gSessions1', 'curious'), s('gSessions2', 'warm'), s('gSessions3', 'calm')] },
  chat: { id: 'chat', featureKey: 'gTitleChat', version: 1, screen: 'ChatScreen', steps: [s('gChat1', 'warm'), s('gChat2', 'calm')] },
  actionCards: { id: 'actionCards', featureKey: 'gTitleActionCards', version: 1, screen: 'ActionCard component (first time a card is shown in chat)', steps: [s('gCards1', 'warm'), s('gCards2', 'calm'), s('gCards3', 'curious')] },
  sleep: { id: 'sleep', featureKey: 'gTitleSleep', version: 1, screen: 'SleepScreen (SleepTab)', tryItRoute: { name: 'SleepDiary' }, steps: [s('gSleep1', 'calm'), s('gSleep2', 'warm'), s('gSleep3', 'curious')] },
  kaizen: { id: 'kaizen', featureKey: 'gTitleKaizen', version: 1, screen: 'KaizenScreen (KaizenTab)', steps: [s('gKaizen1', 'warm'), s('gKaizen2', 'calm'), s('gKaizen3', 'curious')] },
  insights: { id: 'insights', featureKey: 'gTitleInsights', version: 2, whatsNewKey: 'gInsightsNew', screen: 'InsightsScreen (InsightsTab)', steps: [s('gInsights1', 'curious'), s('gInsights2', 'calm'), s('gInsights3', 'calm')] },
  week: { id: 'week', featureKey: 'gTitleWeek', version: 1, screen: 'the "Your week" card (Insights or Kaizen, wherever it is mounted)', steps: [s('gWeek1', 'warm'), s('gWeek2', 'calm'), s('gWeek3', 'warm')] },
  profile: { id: 'profile', featureKey: 'gTitleProfile', version: 2, whatsNewKey: 'gProfileNew', screen: 'SettingsScreen (ProfileTab)', tryItRoute: { name: 'Memory' }, steps: [s('gProfile1', 'warm'), s('gProfile2', 'calm'), s('gProfile3', 'curious')] },
  suggest: { id: 'suggest', featureKey: 'gTitleSuggest', version: 1, screen: 'SettingsScreen, next to the "How much should Nivora suggest?" control', steps: [s('gSuggest1', 'curious'), s('gSuggest2', 'calm')] },
  aiSees: { id: 'aiSees', featureKey: 'gTitleAiSees', version: 1, screen: 'the "What the AI sees" screen', tryItRoute: { name: 'Privacy' }, steps: [s('gAiSees1', 'calm'), s('gAiSees2', 'warm')] },
  invite: { id: 'invite', featureKey: 'gTitleInvite', version: 1, contextual: true, screen: 'TodayFeed, first time a SESSION_INVITE card shows', tryItRoute: { name: 'Reminders' }, steps: [s('gInvite1', 'warm'), s('gInvite2', 'calm')] },
  why: { id: 'why', featureKey: 'gTitleWhy', version: 1, contextual: true, screen: 'TodayFeed / ActionCard, first time a "why" line shows', steps: [s('gWhy1', 'curious'), s('gWhy2', 'warm')] },
  consentJournal: { id: 'consentJournal', featureKey: 'gTitleConsent', version: 1, contextual: true, screen: 'wherever ConsentRequiredPrompt shows for JOURNAL_AI_SHARING', steps: [s('gConsentJournal', 'calm')] },
  consentWellness: { id: 'consentWellness', featureKey: 'gTitleConsent', version: 1, contextual: true, screen: 'wherever ConsentRequiredPrompt shows for WELLNESS_AI_SHARING', steps: [s('gConsentWellness', 'calm')] },
  consentHealth: { id: 'consentHealth', featureKey: 'gTitleConsent', version: 1, contextual: true, screen: 'wherever ConsentRequiredPrompt shows for HEALTH_IMPORT', steps: [s('gConsentHealth', 'calm')] },
  fallback: { id: 'fallback', featureKey: 'gTitleFallback', version: 1, contextual: true, screen: 'any AI result with ai:false (useGuideFallback)', steps: [s('gFallback1', 'calm')] },
};

export const GUIDE_IDS = Object.keys(GUIDE_FEATURES) as GuideFeatureId[];
export const getFeature = (id: string): GuideFeature | undefined => (GUIDE_FEATURES as Record<string, GuideFeature>)[id];

/** Maps a consent type (see consentTypeOf in ConsentRequired) to its guide entry, or null for consents the guide does not explain. */
export function consentGuideId(consentType: string | null | undefined): GuideFeatureId | null {
  return consentType === 'JOURNAL_AI_SHARING' ? 'consentJournal' : consentType === 'WELLNESS_AI_SHARING' ? 'consentWellness' : consentType === 'HEALTH_IMPORT' ? 'consentHealth' : null;
}

export type ReactionKind = 'breathe' | 'grounding' | 'thought' | 'journal' | 'step' | 'sounds';
export const REACTION_TEXT: Record<ReactionKind, GKey> = {
  breathe: 'gReactBreathe', grounding: 'gReactGrounding', thought: 'gReactThought', journal: 'gReactJournal', step: 'gReactStep', sounds: 'gReactSounds',
};
