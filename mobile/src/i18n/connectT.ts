import { useSettings } from '../store/settings';
import { bn, en, hi, ne } from './ext/connect';

export type CnKey = keyof typeof en;
const dict = { en, bn, hi, ne } as Record<string, Partial<Record<CnKey, string>>>;

export function translateCn(lang: string, key: CnKey, vars?: Record<string, string | number>): string {
  let s = dict[lang]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Looks up a server key (data key, feature key...) under a prefix, e.g. ('cnData_', 'JOURNAL_TEXT'). Null when there is no line for it. */
export function cnKeyFor(prefix: string, serverKey: string): CnKey | null {
  const k = `${prefix}${serverKey}`;
  return k in en ? (k as CnKey) : null;
}

/** Translator for the connected-features strings. Self-contained like useTH, so it works without touching i18n/index.ts. */
export function useCn() {
  const lang = useSettings((s) => s.uiLang);
  return (key: CnKey, vars?: Record<string, string | number>) => translateCn(lang, key, vars);
}
