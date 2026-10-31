import { useSettings } from '../store/settings';
import { bn, en, hi, ne } from './ext/todayhealth';

export type THKey = keyof typeof en;
const dict = { en, bn, hi, ne } as Record<string, Partial<Record<THKey, string>>>;

export function translateTH(lang: string, key: THKey, vars?: Record<string, string | number>): string {
  let s = dict[lang]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Translator for the Today/health strings. Self-contained so these screens work whether or not the ext file is spread into i18n/index.ts. */
export function useTH() {
  const lang = useSettings((s) => s.uiLang);
  return (key: THKey, vars?: Record<string, string | number>) => translateTH(lang, key, vars);
}
