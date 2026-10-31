import { useSettings } from '../store/settings';
import { bn, en, hi, ne } from './ext/crisisshape';

export type CsKey = keyof typeof en;
const dict = { en, bn, hi, ne } as Record<string, Partial<Record<CsKey, string>>>;

/** Translator for the crisis-shape notice strings. Self-contained (does not rely on i18n/index.ts spreading the ext file). */
export function useCs() {
  const lang = useSettings((s) => s.uiLang);
  return (key: CsKey) => dict[lang]?.[key] ?? en[key];
}
