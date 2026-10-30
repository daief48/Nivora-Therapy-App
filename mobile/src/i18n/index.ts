import { en } from './en';
import { bn } from './bn';
import { nvBn, nvEn } from './nivora';
import { useSettings } from '../store/settings';

const enAll = { ...en, ...nvEn };
export type Strings = { [K in keyof typeof enAll]: string };
export const dictionaries: Record<'en' | 'bn', Strings> = { en: enAll, bn: { ...bn, ...nvBn } };
export type StringKey = keyof Strings;

export function translate(lang: 'en' | 'bn', key: StringKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang][key] ?? enAll[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const lang = useSettings((s) => s.uiLang);
  return (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
