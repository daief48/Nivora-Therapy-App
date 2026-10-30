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
import { hi } from './hi';
import { ne } from './ne';
import { useSettings } from '../store/settings';

const enAll = { ...en, ...nvEn, ...en_safety, ...en_programs, ...en_sounds, ...en_insights, ...en_journalai, ...en_engage, ...en_platform, ...en_nav };
export type Strings = { [K in keyof typeof enAll]: string };
export type UiLangCode = 'en' | 'bn' | 'hi' | 'ne';
export const dictionaries: Record<UiLangCode, Partial<Strings>> = {
  en: enAll,
  bn: { ...bn, ...nvBn, ...bn_safety, ...bn_programs, ...bn_sounds, ...bn_insights, ...bn_journalai, ...bn_engage, ...bn_platform, ...bn_nav },
  hi,
  ne,
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
