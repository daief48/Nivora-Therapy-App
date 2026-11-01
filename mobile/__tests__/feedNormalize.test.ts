import { normalizeFeed } from '../src/api/today';

describe('normalizeFeed', () => {
  it('turns null, an empty object and an old cached shape into a safe feed', () => {
    for (const raw of [null, undefined, {}, { date: '2026-11-01', quietNow: false, snoozedUntil: null, plan: null, nudges: [], insights: [] }]) {
      const f = normalizeFeed(raw as never);
      expect(f.suggestions).toEqual([]);
      expect(f.nudges).toEqual([]);
      expect(f.insights).toEqual([]);
      expect(f.order).toEqual([]);
      expect(f.riskMode).toBe(false);
    }
  });

  it('keeps a full feed intact and fills nudge reasons and options', () => {
    const f = normalizeFeed({
      date: '2026-11-01', order: ['plan', 'nudge:WIND_DOWN'], resting: true, lightDay: true,
      nudges: [{ type: 'WIND_DOWN', title: 't', body: 'b', cta: 'sleep_routine' }] as never,
      suggestions: [{ id: 'BREATHING' }] as never,
    });
    expect(f.resting).toBe(true);
    expect(f.lightDay).toBe(true);
    expect(f.order).toEqual(['plan', 'nudge:WIND_DOWN']);
    expect(f.suggestions).toHaveLength(1);
    expect(f.nudges[0]).toMatchObject({ reason: null, options: [] });
  });
});
