import { useSettings } from '../store/settings';
import { bn, en, hi, ne } from './ext/feed';

export type FeedKey = keyof typeof en;
const dict = { en, bn, hi, ne } as Record<string, Partial<Record<FeedKey, string>>>;

export function translateFeed(lang: string, key: FeedKey, vars?: Record<string, string | number>): string {
  let s = dict[lang]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Translator for the Today "why", practice, weekly report and Kaizen extras strings. Self-contained like useTH. */
export function useFeedT() {
  const lang = useSettings((s) => s.uiLang);
  return (key: FeedKey, vars?: Record<string, string | number>) => translateFeed(lang, key, vars);
}
