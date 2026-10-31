import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { INSTRUMENT_DEFS } from '../services/assessmentContent.js';
import { assessmentContextBlock, scoreAssessment, trendOf } from '../services/assessmentService.js';
import { auth, config, db, makeApp, register } from './helpers.js';
import { createCipher } from '../utils/crypto.js';

const app = makeApp();
/** Answers whose values sum to `total` using the first item option values as a greedy filler. */
function answersFor(inst: 'PHQ9' | 'GAD7' | 'AUDIT', total: number): number[] {
  const items = INSTRUMENT_DEFS[inst].items;
  let left = total;
  return items.map((i) => {
    const vals = i.options.map((o) => o.value).sort((a, b) => b - a);
    const v = vals.find((x) => x <= left) ?? 0;
    left -= v;
    return v;
  });
}
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('scoring', () => {
  it('PHQ-9 band edges', () => {
    for (const [t, band] of [[0, 'minimal'], [4, 'minimal'], [5, 'mild'], [9, 'mild'], [10, 'moderate'], [14, 'moderate'], [15, 'moderately_severe'], [19, 'moderately_severe'], [20, 'severe'], [27, 'severe']] as const) {
      const a = answersFor('PHQ9', t);
      expect(sum(a)).toBe(t);
      expect(scoreAssessment('PHQ9', a)).toMatchObject({ total: t, severity: band });
    }
  });
  it('GAD-7 band edges', () => {
    for (const [t, band] of [[4, 'minimal'], [5, 'mild'], [9, 'mild'], [10, 'moderate'], [14, 'moderate'], [15, 'severe'], [21, 'severe']] as const) {
      expect(scoreAssessment('GAD7', answersFor('GAD7', t))).toMatchObject({ total: t, severity: band });
    }
  });
  it('AUDIT scoring and band edges, items 9-10 are 0/2/4', () => {
    for (const [t, band] of [[0, 'low_risk'], [7, 'low_risk'], [8, 'hazardous'], [15, 'hazardous'], [16, 'harmful'], [19, 'harmful'], [20, 'possible_dependence'], [40, 'possible_dependence']] as const) {
      expect(scoreAssessment('AUDIT', answersFor('AUDIT', t))).toMatchObject({ total: t, severity: band });
    }
    const a = Array(10).fill(0); a[8] = 4; a[9] = 2;
    expect(scoreAssessment('AUDIT', a).total).toBe(6);
    a[8] = 1;
    expect(() => scoreAssessment('AUDIT', a)).toThrow();
  });
  it('reports item9 for PHQ-9 only', () => {
    const a = Array(9).fill(0); a[8] = 2;
    expect(scoreAssessment('PHQ9', a).item9).toBe(2);
    expect(scoreAssessment('GAD7', Array(7).fill(0)).item9).toBeUndefined();
  });
  it('rejects invalid input', () => {
    expect(() => scoreAssessment('PHQ9', Array(8).fill(0))).toThrow();
    expect(() => scoreAssessment('PHQ9', Array(9).fill(4))).toThrow();
    expect(() => scoreAssessment('PHQ9', Array(9).fill(-1))).toThrow();
    expect(() => scoreAssessment('PHQ9', Array(9).fill(1.5))).toThrow();
    expect(() => scoreAssessment('PHQ9', Array(9).fill('1'))).toThrow();
    expect(() => scoreAssessment('PHQ9', null)).toThrow();
    expect(() => scoreAssessment('XYZ', [])).toThrow();
  });
  it('trend direction', () => {
    expect(trendOf([5])).toBe('first');
    expect(trendOf([5, 10])).toBe('improving');
    expect(trendOf([10, 5])).toBe('worsening');
    expect(trendOf([10, 9])).toBe('steady');
  });
});

describe('assessments API', () => {
  it('create, list, ownership, delete, encrypted at rest', async () => {
    const a = await register(app), b = await register(app);
    const created = await request(app).post('/api/v1/assessments').set(auth(a.accessToken)).send({ instrument: 'GAD7', answers: [1, 1, 1, 1, 1, 1, 1] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ instrument: 'GAD7', total: 7, severity: 'mild', item9Flag: false });
    expect(created.body.data.answers).toBeUndefined();
    const raw = await db.assessment.findUnique({ where: { id: created.body.data.id } });
    expect(raw!.encryptedContent).not.toContain('answers');
    expect((await request(app).post('/api/v1/assessments').set(auth(a.accessToken)).send({ instrument: 'GAD7', answers: [1, 2] })).status).toBe(400);
    expect((await request(app).post('/api/v1/assessments').set(auth(a.accessToken)).send({ instrument: 'NOPE', answers: [] })).status).toBe(400);
    const list = await request(app).get('/api/v1/assessments?instrument=GAD7').set(auth(a.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/assessments').set(auth(b.accessToken))).body.data).toHaveLength(0);
    const inst = await request(app).get('/api/v1/assessments/instruments').set(auth(a.accessToken));
    expect(inst.body.data.map((i: any) => i.id)).toEqual(['PHQ9', 'GAD7', 'AUDIT']);
    expect((await request(app).get('/api/v1/assessments/latest').set(auth(a.accessToken))).body.data[0]).toMatchObject({ instrument: 'GAD7', trend: 'first' });
    expect((await request(app).delete(`/api/v1/assessments/${created.body.data.id}`).set(auth(b.accessToken))).status).toBe(404);
    await request(app).delete(`/api/v1/assessments/${created.body.data.id}`).set(auth(a.accessToken)).expect(204);
    expect((await request(app).get('/api/v1/assessments')).status).toBe(401);
  });

  it('PHQ-9 item 9 > 0 flags, returns resources, writes a content-free SafetyEvent; context block has no raw answers', async () => {
    const a = await register(app);
    const ok = await request(app).post('/api/v1/assessments').set(auth(a.accessToken)).send({ instrument: 'PHQ9', answers: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(ok.body.data.item9Flag).toBe(false);
    expect(await db.safetyEvent.count({ where: { userId: a.userId } })).toBe(0);
    const res = await request(app).post('/api/v1/assessments').set(auth(a.accessToken)).send({ instrument: 'PHQ9', answers: [1, 1, 1, 1, 1, 1, 1, 1, 1] });
    expect(res.body.data).toMatchObject({ item9Flag: true, total: 9, severity: 'mild' });
    expect(Array.isArray(res.body.data.resources)).toBe(true);
    const ev = await db.safetyEvent.findMany({ where: { userId: a.userId } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ severity: 'ELEVATED', category: 'SELF_HARM', actionTaken: 'ASSESSMENT_ITEM9', sessionId: null });
    const block = await assessmentContextBlock(db, createCipher(config.DATA_ENCRYPTION_KEYS), a.userId);
    expect(block).toContain('PHQ-9');
    expect(block).toContain('(');
    expect(block).not.toMatch(/total|score: \d/i);
  });
});
