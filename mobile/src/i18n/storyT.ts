import { useSettings } from '../store/settings';
import { bn, en, hi, ne } from './ext/story';

export type StoryKey = keyof typeof en;
const dict: Record<string, Partial<Record<StoryKey, string>>> = { en, bn, hi, ne };

/** Translator for the story/garden strings. Reads ext/story directly, so it works whether or not the lead has merged it into the main dictionary. */
export function useStoryT() {
  const lang = useSettings((s) => s.uiLang);
  return (key: StoryKey, vars?: Record<string, string | number>) => {
    let s = dict[lang]?.[key] ?? en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
