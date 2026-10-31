import { useT, type StringKey } from '../../i18n';
import { bn, en, hi, ne } from '../../i18n/ext/practice';
import { useSettings } from '../../store/settings';

export type PracticeKey = keyof typeof en;
const DICT: Record<string, Partial<Record<PracticeKey, string>>> = { en, bn, hi, ne };

/** Translator for the practice flows. Reads the practice strings directly (so it works before they are merged into the global dictionaries) and falls back to the global one. */
export function usePT() {
  const lang = useSettings((s) => s.uiLang);
  const t = useT();
  return (key: PracticeKey | StringKey, vars?: Record<string, string | number>): string => {
    if (!(key in en)) return t(key as StringKey, vars);
    let s = DICT[lang]?.[key as PracticeKey] ?? en[key as PracticeKey];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
