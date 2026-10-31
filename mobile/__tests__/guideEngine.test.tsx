import AsyncStorage from '@react-native-async-storage/async-storage';
import { GUIDE_FEATURES, GUIDE_IDS, REACTION_TEXT, consentGuideId, type GuideFeatureId } from '../src/guide/guideContent';
import { DAILY_CAP, isQuietNow, momentSteps, resetGuideForTests, useGuide } from '../src/guide/guideEngine';
import { en, bn, hi, ne } from '../src/i18n/ext/guide';
import { useSettings } from '../src/store/settings';

const g = () => useGuide.getState();
/** New app session: runtime counters reset, persisted ones kept. */
const newSession = () => useGuide.setState({ sessionShown: 0, current: null });

beforeEach(() => {
  jest.useRealTimers();
  resetGuideForTests();
  useSettings.setState({ quietOn: false, quietStart: 22 * 60, quietEnd: 7 * 60, uiLang: 'en' });
  
});

describe('guide content', () => {
  it('has every key in every language, and every referenced key exists', () => {
    for (const d of [bn, hi, ne]) expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
    for (const id of GUIDE_IDS) {
      const f = GUIDE_FEATURES[id];
      expect(en[f.featureKey]).toBeTruthy();
      if (f.whatsNewKey) expect(en[f.whatsNewKey]).toBeTruthy();
      expect(f.steps.length).toBeGreaterThanOrEqual(1);
      expect(f.steps.length).toBeLessThanOrEqual(id === 'tour' ? 4 : 3);
      for (const st of f.steps) { expect(en[st.textKey]).toBeTruthy(); expect(en[st.textKey].length).toBeLessThanOrEqual(110); }
    }
    for (const k of Object.values(REACTION_TEXT)) expect(en[k]).toBeTruthy();
  });
  it('covers the features the spec lists, with no guilt or streak wording', () => {
    const must: GuideFeatureId[] = ['home', 'breathe', 'journal', 'exercises', 'programs', 'garden', 'sounds', 'sessions', 'sleep', 'kaizen', 'insights', 'profile', 'actionCards', 'week', 'suggest', 'aiSees', 'why', 'invite', 'consentJournal', 'consentWellness', 'consentHealth', 'fallback'];
    for (const id of must) expect(GUIDE_FEATURES[id]).toBeTruthy();
    const all = Object.values(en).join(' ').toLowerCase();
    for (const bad of ['streak', 'you missed', 'i miss you', 'haven\'t practised', 'hurry']) expect(all.replace('no scores and no streaks', '')).not.toContain(bad);
    expect(en.gTour1).toMatch(/AI companion/);
    expect(consentGuideId('WELLNESS_AI_SHARING')).toBe('consentWellness');
    expect(consentGuideId('AGE')).toBeNull();
  });
  it('only uses existing routes for tryItRoute', () => {
    const routes = ['Exercise', 'JournalEdit', 'Wellness', 'Programs', 'Garden', 'Sounds', 'SleepDiary', 'Memory', 'Privacy', 'Reminders'];
    for (const id of GUIDE_IDS) { const r = GUIDE_FEATURES[id].tryItRoute; if (r) expect(routes).toContain(r.name); }
  });
});

describe('guide engine', () => {
  it('shows a feature intro once, and replay always works', () => {
    expect(g().request('sleep')).toBe(true);
    expect(g().current?.featureId).toBe('sleep');
    g().skip(); newSession();
    expect(g().request('sleep')).toBe(false);
    expect(g().replay('sleep')).toBe(true);
    expect(g().current?.kind).toBe('replay');
  });
  it('steps through and completes', () => {
    g().request('home');
    const n = momentSteps(g().current!).length;
    for (let i = 1; i < n; i++) { g().next(); expect(g().current?.step).toBe(i); }
    g().next();
    expect(g().current).toBeNull();
  });
  it('allows at most one moment per app session', () => {
    expect(g().request('sleep')).toBe(true); g().skip();
    expect(g().request('kaizen')).toBe(false);
  });
  it('allows at most two moments per day', () => {
    expect(DAILY_CAP).toBe(2);
    g().request('sleep'); g().skip(); newSession();
    g().request('kaizen'); g().skip(); newSession();
    expect(g().request('insights')).toBe(false);
    expect(g().replay('insights')).toBe(true); // a tap is not capped
  });
  it('does not show with level Off, and Hints only allows contextual help and what is new', () => {
    g().setLevel('Off');
    expect(g().request('sleep')).toBe(false);
    g().setLevel('Hints');
    expect(g().request('sleep')).toBe(false);
    expect(g().request('consentJournal')).toBe(true);
    g().skip(); newSession();
    expect(g().replay('sleep')).toBe(true);
  });
  it('level changes take effect and clear dismiss-forever', () => {
    g().request('sleep');
    g().dismissForever();
    expect(g().current).toBeNull(); expect(g().guideLevel).toBe('Off'); expect(g().dismissedForever).toBe(true);
    newSession();
    expect(g().request('kaizen')).toBe(false);
    g().setLevel('Full');
    expect(g().dismissedForever).toBe(false);
    expect(g().request('kaizen')).toBe(true);
  });
  it('respects snooze', () => {
    g().snooze(60_000);
    expect(g().request('sleep')).toBe(false);
    useGuide.setState({ snoozedUntil: Date.now() - 1 });
    expect(g().request('sleep')).toBe(true);
  });
  it('stays hidden in quiet mode', () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    useSettings.setState({ quietOn: true, quietStart: 11 * 60, quietEnd: 13 * 60 });
    expect(isQuietNow()).toBe(true);
    expect(g().request('sleep')).toBe(false);
    expect(g().react('breathe')).toBe(false);
    useSettings.setState({ quietOn: false });
    expect(g().request('sleep')).toBe(true);
  });
  it('is fully suppressed during risk, calls, recording and exercises, and closes what is showing', () => {
    for (const reason of ['risk', 'call', 'recording', 'exercise', 'emergency'] as const) {
      resetGuideForTests();
      expect(g().request('sleep')).toBe(true);
      g().setSuppressed(reason, true);
      expect(g().current).toBeNull();
      newSession();
      expect(g().request('kaizen')).toBe(false);
      expect(g().replay('kaizen')).toBe(false);
      expect(g().react('step')).toBe(false);
      g().setSuppressed(reason, false);
      expect(g().request('kaizen')).toBe(true);
    }
  });
  it('counts overlapping suppressors', () => {
    g().setSuppressed('exercise', true); g().setSuppressed('exercise', true); g().setSuppressed('exercise', false);
    expect(g().request('sleep')).toBe(false);
    g().setSuppressed('exercise', false);
    expect(g().request('sleep')).toBe(true);
  });
  it('never appears on its own when suggestions are set to Never, but a tap still works', () => {
    useGuide.setState({ suggestionLevel: 'NEVER' });
    expect(g().request('sleep')).toBe(false);
    expect(g().react('step')).toBe(false);
    expect(g().replay('sleep')).toBe(true);
  });
  it('shows a one-step "what is new" when a feature version moved on', () => {
    useGuide.setState({ seen: { home: 1 } });
    expect(g().request('home')).toBe(true);
    expect(g().current?.kind).toBe('whatsnew');
    expect(momentSteps(g().current!)).toHaveLength(1);
    g().skip(); newSession();
    expect(g().request('home')).toBe(false);
  });
  it('explains an AI fallback once per feature', () => {
    expect(g().requestFallback('sleepCoach')).toBe(true);
    g().skip(); newSession();
    expect(g().requestFallback('sleepCoach')).toBe(false);
    expect(g().requestFallback('weekly')).toBe(true);
  });
  it('offers the tour once and exempts it from the caps', () => {
    useGuide.setState({ sessionShown: 1, shownToday: 5, day: new Date().toDateString() });
    expect(g().request('tour', 'home')).toBe(true);
    g().skip();
    expect(g().request('tour', 'home')).toBe(false);
    expect(g().replay('tour')).toBe(true);
  });
  it('leaving the screen closes its moment', () => {
    g().request('sleep');
    g().leave('kaizen'); expect(g().current).not.toBeNull();
    g().leave('sleep'); expect(g().current).toBeNull();
  });
  it('reactions: limited per day, never while a moment shows, cleared on demand', () => {
    expect(g().react('breathe')).toBe(true);
    expect(g().reaction?.textKey).toBe('gReactBreathe');
    g().clearReaction();
    expect(g().react('step', { garden: true })).toBe(true);
    expect(g().reaction?.textKey).toBe('gReactGarden');
    g().clearReaction(); g().react('journal'); g().clearReaction();
    expect(g().react('sounds')).toBe(false);
    resetGuideForTests();
    g().replay('sleep');
    expect(g().react('breathe')).toBe(false);
  });
  it('reset tips makes intros available again', () => {
    g().request('sleep'); g().skip(); newSession();
    g().resetTips();
    expect(g().request('sleep')).toBe(true);
  });
  it('does not crash when AsyncStorage throws', async () => {
    const set = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    const get = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('nope'));
    expect(() => { g().request('sleep'); g().next(); g().setLevel('Hints'); g().setReadAloud(true); }).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    await expect(useGuide.persist.rehydrate()).resolves.not.toThrow();
    expect(g().guideLevel).toBe('Hints');
    set.mockRestore(); get.mockRestore();
  });
});
