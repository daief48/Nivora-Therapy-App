import { easeLevel, orbTarget } from '../src/utils/orbLevel';

describe('orbLevel', () => {
  const base = { active: true, speaking: false, listening: false, thinking: false };
  it('is calm when idle and livelier while speaking', () => {
    expect(orbTarget({ ...base, active: false })).toBeLessThan(0.2);
    expect(orbTarget({ ...base, speaking: true })).toBeGreaterThan(orbTarget({ ...base, listening: true }));
    expect(orbTarget({ ...base, listening: true })).toBeGreaterThan(orbTarget({ ...base, thinking: true }));
  });
  it('uses real playback energy when present and clamps to 1', () => {
    expect(orbTarget({ ...base, speaking: true, energy: 0.2 })).toBeLessThan(orbTarget({ ...base, speaking: true, energy: 0.6 }));
    expect(orbTarget({ ...base, speaking: true, energy: 5 })).toBe(1);
  });
  it('eases toward the target and settles', () => {
    let l = 0.1;
    for (let i = 0; i < 40; i++) l = easeLevel(l, 0.7);
    expect(l).toBe(0.7);
    expect(easeLevel(0.1, 0.7)).toBeGreaterThan(0.1);
    expect(easeLevel(0.1, 0.7)).toBeLessThan(0.7);
  });
});
