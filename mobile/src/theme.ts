import { useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
import { useSettings } from './store/settings';

/**
 * Sakura Zen design tokens. Warm ivory ground, sakura-pink accents, muted sage for secondary elements.
 * Never pure black or saturated pink. Text pairs are chosen for AA contrast.
 */
export interface Palette {
  bg: string; bgTop: string; card: string; cardAlt: string; text: string; textMuted: string; border: string;
  primary: string; onPrimary: string; accent: string; lavender: string; danger: string; onDanger: string; success: string;
  bubbleUser: string; bubbleAi: string; onBubbleUser: string;
  gradA: string; gradB: string; // primary button gradient (forest green)
  heroA: string; heroB: string; onHero: string; onHeroMuted: string; // soft blossom hero surface and the text on it
  petal: string; petalDeep: string;
  sky: string; skySoft: string;
  tint: [string, string, string, string]; // soft tinted icon backgrounds: blossom, sage, lavender, cream
  tintFg: [string, string, string, string];
}

export const light: Palette = {
  bg: '#FFFDF8', bgTop: '#F9EDF0', card: '#FFFFFF', cardAlt: '#F7F3EB', text: '#393B38', textMuted: '#6C6E69', border: '#EDE6DA',
  primary: '#5A6F5C', onPrimary: '#FFFDF8', accent: '#C88F9D', lavender: '#EAE4F1', danger: '#B3394A', onDanger: '#FFFFFF', success: '#5E8062',
  bubbleUser: '#F5DCE3', bubbleAi: '#FFFCF5', onBubbleUser: '#393B38',
  gradA: '#617762', gradB: '#526653',
  heroA: '#F9E6EC', heroB: '#EFE7F3', onHero: '#393B38', onHeroMuted: '#5D5F5A',
  petal: '#F5DCE3', petalDeep: '#E8B4C2',
  sky: '#7F9AAE', skySoft: '#E8EEF1',
  tint: ['#F9E4E9', '#E3EADF', '#EAE4F1', '#F3ECDD'], tintFg: ['#A9667A', '#566B58', '#76669A', '#86693A'],
};
export const dark: Palette = {
  bg: '#1F201E', bgTop: '#2B2427', card: '#282926', cardAlt: '#31322F', text: '#F4EFE8', textMuted: '#B5B1A8', border: '#3B3C38',
  primary: '#A8B8A0', onPrimary: '#1B231A', accent: '#D9A3B1', lavender: '#322D3B', danger: '#FF8D98', onDanger: '#3A0A14', success: '#A8B8A0',
  bubbleUser: '#5B3F49', bubbleAi: '#2B2C2A', onBubbleUser: '#F8F1EC',
  gradA: '#A8B8A0', gradB: '#93A58F',
  heroA: '#3A2C34', heroB: '#2E2C3A', onHero: '#F4EFE8', onHeroMuted: '#C8C3B9',
  petal: '#E9BCC9', petalDeep: '#D9A3B1',
  sky: '#9DB4C4', skySoft: '#25303A',
  tint: ['#42303A', '#2F3A2F', '#35303F', '#3D3626'], tintFg: ['#EBB4C3', '#BFD0B6', '#C9BDE3', '#E3C58B'],
};

/** Font families (loaded in App.tsx). Serif headings for English, Noto Sans Bengali for Bangla. */
export const fonts = {
  heading: 'NotoSerifJP_600SemiBold',
  body: { 400: 'NunitoSans_400Regular', 600: 'NunitoSans_600SemiBold', 700: 'NunitoSans_700Bold', 800: 'NunitoSans_800ExtraBold' },
  bn: { 400: 'NotoSansBengali_400Regular', 500: 'NotoSansBengali_500Medium', 700: 'NotoSansBengali_700Bold' },
};
export function fontFor(lang: 'en' | 'bn', size: number, weight: TextStyle['fontWeight']): string {
  const w = Number(weight) || 400;
  if (lang === 'bn') return w >= 700 ? fonts.bn[700] : w >= 500 ? fonts.bn[500] : fonts.bn[400];
  if (w >= 700 && size >= 19) return fonts.heading;
  return w >= 800 ? fonts.body[800] : w >= 700 ? fonts.body[700] : w >= 600 ? fonts.body[600] : fonts.body[400];
}

/** Design tokens shared by all screens. */
export const type = {
  display: { size: 30, weight: '800' as const }, title: { size: 22, weight: '800' as const }, heading: { size: 18, weight: '700' as const },
  body: { size: 16, weight: '400' as const }, caption: { size: 13, weight: '400' as const },
};
export const motion = { fast: 150, base: 250, slow: 600 };
export const layout = { maxContentWidth: 760, wideBreakpoint: 900 };

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 14, md: 18, lg: 24, xl: 32, pill: 999 };

export function useTheme() {
  const system = useColorScheme();
  const mode = useSettings((s) => s.theme);
  const scale = useSettings((s) => s.fontScale);
  const lang = useSettings((s) => s.uiLang);
  const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
  const c = isDark ? dark : light;
  // Generous line height: Bangla glyphs carry tall matras and need more vertical room than Latin text.
  const text = (size: number, weight: TextStyle['fontWeight'] = '400'): TextStyle => ({
    fontSize: Math.round(size * scale), lineHeight: Math.round(size * scale * 1.55), fontFamily: fontFor(lang, size, weight), color: c.text,
  });
  // Soft elevation (RN 0.76+ cross-platform boxShadow).
  const shadow = (strength: 'sm' | 'md' | 'lg' = 'md'): ViewStyle => ({
    boxShadow: isDark
      ? `0 2px 10px rgba(0,0,0,${strength === 'lg' ? 0.5 : 0.35})`
      : strength === 'lg' ? '0 14px 34px rgba(120,84,96,0.16)' : strength === 'sm' ? '0 1px 6px rgba(120,84,96,0.06)' : '0 6px 20px rgba(120,84,96,0.09)',
  });
  return { c, isDark, text, scale, shadow, lang };
}
