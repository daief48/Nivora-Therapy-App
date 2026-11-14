import { en } from './en';
import { bn } from './bn';
import { nvBn, nvEn } from './nivora';
import { bn as bn_safety, en as en_safety } from './ext/safety';
import { bn as bn_programs, en as en_programs } from './ext/programs';
import { bn as bn_sounds, en as en_sounds } from './ext/sounds';
import { bn as bn_insights, en as en_insights } from './ext/insights';
import { bn as bn_journalai, en as en_journalai } from './ext/journalai';
import { bn as bn_engage, en as en_engage } from './ext/engage';
import { bn as bn_platform, en as en_platform } from './ext/platform';
import { bn as bn_nav, en as en_nav } from './ext/nav';
import { bn as bn_sessions, en as en_sessions } from './ext/sessions';
import { bn as bn_dataControl, en as en_dataControl } from './ext/dataControl';
import { bn as bn_voice, en as en_voice } from './ext/voice';
import { bn as bn_avatar, en as en_avatar } from './ext/avatar';
import { bn as bn_voicepath, en as en_voicepath } from './ext/voicepath';
import { bn as bn_memory, en as en_memory } from './ext/memory';
import { bn as bn_assessments, en as en_assessments } from './ext/assessments';
import { bn as bn_topics, en as en_topics } from './ext/topics';
import { bn as bn_auth, en as en_auth } from './ext/auth';
import { bn as bn_sp, en as en_sp, hi as hi_sp, ne as ne_sp } from './ext/sessprog';
import { bn as bn_m, en as en_m, hi as hi_m, ne as ne_m } from './ext/motion';
import { bn as bn_scope, en as en_scope, hi as hi_scope, ne as ne_scope } from './ext/scope';
import { bn as bn_cue, en as en_cue, hi as hi_cue, ne as ne_cue } from './ext/taskCue';
import { hi } from './hi';
import { ne } from './ne';
import { useSettings } from '../store/settings';

const enAll = { ...en, ...nvEn, ...en_safety, ...en_programs, ...en_sounds, ...en_insights, ...en_journalai, ...en_engage, ...en_platform, ...en_nav, ...en_sessions, ...en_dataControl, ...en_voice, ...en_avatar, ...en_voicepath, ...en_memory, ...en_topics, ...en_assessments, ...en_auth, ...en_sp, ...en_m, ...en_scope, ...en_cue };
export type Strings = { [K in keyof typeof enAll]: string };
export type UiLangCode = 'en' | 'bn' | 'hi' | 'ne';
export const dictionaries: Record<UiLangCode, Partial<Strings>> = {
  en: enAll,
  bn: { ...bn, ...nvBn, ...bn_safety, ...bn_programs, ...bn_sounds, ...bn_insights, ...bn_journalai, ...bn_engage, ...bn_platform, ...bn_nav, ...bn_sessions, ...bn_dataControl, ...bn_voice, ...bn_avatar, ...bn_voicepath, ...bn_memory, ...bn_topics, ...bn_assessments, ...bn_auth, ...bn_sp, ...bn_m, ...bn_scope, ...bn_cue },
  hi: { ...hi, ...hi_sp, ...hi_m, ...hi_scope, ...hi_cue },
  ne: { ...ne, ...ne_sp, ...ne_m, ...ne_scope, ...ne_cue },
};
export type StringKey = keyof Strings;

export function translate(lang: UiLangCode, key: StringKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang][key] ?? enAll[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const lang = useSettings((s) => s.uiLang);
  return (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
