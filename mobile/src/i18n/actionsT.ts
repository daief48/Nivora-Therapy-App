import { useSettings } from '../store/settings';
import { bn, en, hi, ne } from './ext/actions';

export type ACKey = keyof typeof en;
const dict = { en, bn, hi, ne } as Record<string, Partial<Record<ACKey, string>>>;

export function translateAC(lang: string, key: ACKey, vars?: Record<string, string | number>): string {
  let s = dict[lang]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Translator for the action card and action screen strings. Self-contained, so it works whether or not the ext file is spread into i18n/index.ts. */
export function useAT() {
  const lang = useSettings((s) => s.uiLang);
  return (key: ACKey, vars?: Record<string, string | number>) => translateAC(lang, key, vars);
}
