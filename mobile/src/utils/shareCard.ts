import type { Season, ShareData } from '../api/monthly';

/** Fixed (theme-independent) season palettes so a shared card looks the same everywhere. Also used for the Garden. */
export const SEASON_PALETTE: Record<Season, { bg: string; bgDark: string; petal: string; petalDeep: string; leaf: string; ink: string }> = {
  SPRING: { bg: '#FFF6F8', bgDark: '#2E2429', petal: '#F5DCE3', petalDeep: '#E8B4C2', leaf: '#A9BFA3', ink: '#5A4A50' },
  SUMMER: { bg: '#F7FAF1', bgDark: '#232A22', petal: '#F3D9C4', petalDeep: '#E5B98F', leaf: '#8FB08A', ink: '#4A5547' },
  AUTUMN: { bg: '#FBF3E8', bgDark: '#2C2620', petal: '#EBC9A4', petalDeep: '#D69A6A', leaf: '#C08A58', ink: '#5A4A3A' },
  WINTER: { bg: '#F2F5F8', bgDark: '#232830', petal: '#DCE4EC', petalDeep: '#B4C4D4', leaf: '#9AAFC0', ink: '#454F5A' },
};
export const SEASONS: Season[] = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
export const asSeason = (s: unknown): Season => (SEASONS.includes(s as Season) ? (s as Season) : 'SPRING');

export type Shape = { kind: 'circle'; cx: number; cy: number; r: number; fill: string; opacity: number } | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; opacity: number; rotate: number };
export const CARD = 320;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Abstract shapes for the share card. Reads ONLY the aggregate fields of ShareData (days logged, averages, Kaizen count,
 * season, strongest-pattern direction); no text from the person can reach it.
 * Ring of petals = days checked in; centre glow = average mood; inner dots = Kaizen steps; arc of leaves = sleep.
 */
export function shareShapes(share: Pick<ShareData, 'periodDays' | 'daysLogged' | 'avgMood' | 'avgSleepScore' | 'kaizenDone' | 'season' | 'strongestPattern'>): Shape[] {
  const p = SEASON_PALETTE[asSeason(share.season)];
  const out: Shape[] = [];
  const mid = CARD / 2;
  const moodK = share.avgMood == null ? 0.5 : clamp((share.avgMood - 1) / 4, 0, 1);
  out.push({ kind: 'circle', cx: mid, cy: mid, r: 52 + moodK * 40, fill: p.petal, opacity: 0.55 });
  out.push({ kind: 'circle', cx: mid, cy: mid, r: 26 + moodK * 20, fill: p.petalDeep, opacity: 0.6 });
  const n = clamp(Math.round(share.daysLogged), 0, 60);
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, share.periodDays)) * Math.PI * 2;
    out.push({ kind: 'ellipse', cx: mid + Math.sin(a) * 112, cy: mid - Math.cos(a) * 112, rx: 7, ry: 13, fill: i % 2 ? p.petalDeep : p.petal, opacity: 0.9, rotate: (a * 180) / Math.PI });
  }
  const leaves = Math.round(clamp((share.avgSleepScore ?? 0) / 100, 0, 1) * 8);
  for (let i = 0; i < leaves; i++) {
    const a = Math.PI * (0.55 + i * 0.1);
    out.push({ kind: 'ellipse', cx: mid + Math.sin(a) * 74, cy: mid - Math.cos(a) * 74, rx: 4, ry: 9, fill: p.leaf, opacity: 0.8, rotate: (a * 180) / Math.PI });
  }
  const dots = clamp(Math.round(share.kaizenDone), 0, 30);
  for (let i = 0; i < dots; i++) {
    const a = i * 2.4; const r = 8 + Math.sqrt(i) * 7;
    out.push({ kind: 'circle', cx: mid + Math.sin(a) * r, cy: mid - Math.cos(a) * r, r: 2.6, fill: p.leaf, opacity: 0.95 });
  }
  if (share.strongestPattern) out.push({ kind: 'circle', cx: mid + (share.strongestPattern.direction === 'together' ? 14 : -14), cy: mid, r: 4, fill: p.ink, opacity: 0.35 });
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** Standalone SVG markup of the card. `caption` and `title` are app-provided strings, never user text. */
export function shareCardSvg(share: Parameters<typeof shareShapes>[0], caption: { title: string; sub: string }): string {
  const p = SEASON_PALETTE[asSeason(share.season)];
  const body = shareShapes(share).map((s) => (s.kind === 'circle'
    ? `<circle cx="${s.cx.toFixed(1)}" cy="${s.cy.toFixed(1)}" r="${s.r.toFixed(1)}" fill="${s.fill}" opacity="${s.opacity}"/>`
    : `<ellipse cx="${s.cx.toFixed(1)}" cy="${s.cy.toFixed(1)}" rx="${s.rx}" ry="${s.ry}" fill="${s.fill}" opacity="${s.opacity}" transform="rotate(${s.rotate.toFixed(1)} ${s.cx.toFixed(1)} ${s.cy.toFixed(1)})"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD}" height="${CARD + 60}" viewBox="0 0 ${CARD} ${CARD + 60}"><rect width="${CARD}" height="${CARD + 60}" rx="28" fill="${p.bg}"/>${body}`
    + `<text x="${CARD / 2}" y="${CARD + 8}" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="${p.ink}">${esc(caption.title)}</text>`
    + `<text x="${CARD / 2}" y="${CARD + 34}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="${p.ink}" opacity="0.7">${esc(caption.sub)}</text></svg>`;
}

export const shareCardHtml = (share: Parameters<typeof shareShapes>[0], caption: { title: string; sub: string }) =>
  `<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head><body style="margin:0;display:flex;align-items:center;justify-content:center">${shareCardSvg(share, caption)}</body></html>`;
