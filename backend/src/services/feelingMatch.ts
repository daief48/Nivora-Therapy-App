/**
 * Offline feeling-word matching shared by the journal emotion fallback and the feeling -> action rules.
 * Latin patterns must use word boundaries (so "download" is not "down", "crystal" is not "cry", "standalone" is not "alone").
 * A hit that is negated ("not tired", "no stress", "ভয় লাগছে না", "डर नहीं") does not count: better no word than the wrong word.
 */
const NEG_BEFORE = /(?:\b(?:not|no|never|without|hardly|barely|neither|nor)|n't)\s+(?:\w+\s+){0,2}$/;
const NEG_AFTER = /^(?:\s*\S+){0,2}?\s*(?:না|নয়|নই|नहीं|नही|नहि|छैन|होइन)(?=\s|$|[।.,!?])/;

export function hasFeeling(re: RegExp, text: string): boolean {
  const g = new RegExp(re.source, re.flags.replace('g', '') + 'g');
  const t = text.normalize('NFKC').replace(/[’‘]/g, "'");
  for (const m of t.matchAll(g)) {
    const i = m.index ?? 0;
    const before = (t.slice(0, i).split(/[.,;:!?\n।]/).pop() ?? '').toLowerCase();
    const after = t.slice(i + m[0].length).split(/[.,;:!?\n।]/)[0] ?? '';
    if (NEG_BEFORE.test(before) || NEG_AFTER.test(after)) continue;
    return true;
  }
  return false;
}
