import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PROGRAMS } from '../services/programContent.js';
import { auth, db, makeApp, register } from './helpers.js';

const app = makeApp();

describe('Programs', () => {
  it('content is complete and bilingual for every programme', () => {
    for (const p of Object.values(PROGRAMS)) {
      expect(p.content).toHaveLength(p.days);
      for (const c of p.content) {
        for (const b of [c.title, c.lesson, c.reflection, c.practice]) { expect(b.en.length).toBeGreaterThan(5); expect(b.bn.length).toBeGreaterThan(5); }
        expect(c.practice.minutes).toBeLessThanOrEqual(6);
      }
      expect(p.safety.en).toMatch(/not/i);
    }
  });

  it('lists, enrolls, reveals only unlocked days and completes idempotently', async () => {
    const u = await register(app);
    const list = await request(app).get('/api/v1/programs').set(auth(u.accessToken));
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data[0].enrolled).toBe(false);

    const enr = await request(app).post('/api/v1/programs/stress-7/enroll').set(auth(u.accessToken));
    expect(enr.status).toBe(201);
    expect(enr.body.data.unlockedDay).toBe(1);

    const det = await request(app).get('/api/v1/programs/stress-7').set(auth(u.accessToken));
    expect(det.body.data.content).toHaveLength(7);
    expect(det.body.data.content[0].lesson).toBeTruthy();
    expect(det.body.data.content[1].locked).toBe(true);
    expect(det.body.data.content[1].lesson).toBeUndefined();

    const early = await request(app).post('/api/v1/programs/stress-7/days/2/complete').set(auth(u.accessToken));
    expect(early.status).toBe(409);

    const c1 = await request(app).post('/api/v1/programs/stress-7/days/1/complete').set(auth(u.accessToken));
    expect(c1.status).toBe(200);
    expect(c1.body.data.completedDays).toEqual([1]);
    const c1b = await request(app).post('/api/v1/programs/stress-7/days/1/complete').set(auth(u.accessToken));
    expect(c1b.body.data.completedDays).toEqual([1]);
  });

  it('unlocks the next day on a later calendar day, tolerates gaps and completes the programme', async () => {
    const u = await register(app);
    await request(app).post('/api/v1/programs/stress-7/enroll').set(auth(u.accessToken));
    // Pretend the user started 10 days ago: all days open, no penalty for the gap.
    await db.programEnrollment.updateMany({ where: { userId: u.userId, programId: 'stress-7' }, data: { startedAt: new Date(Date.now() - 10 * 86_400_000) } });
    const det = await request(app).get('/api/v1/programs/stress-7').set(auth(u.accessToken));
    expect(det.body.data.unlockedDay).toBe(7);
    for (let n = 1; n <= 7; n++) {
      const r = await request(app).post(`/api/v1/programs/stress-7/days/${n}/complete`).set(auth(u.accessToken));
      expect(r.status).toBe(200);
      if (n === 1) expect(r.body.data.unlockedDay).toBe(1); // re-anchored: day 2 opens tomorrow
      if (n === 1) {
        const blocked = await request(app).post('/api/v1/programs/stress-7/days/2/complete').set(auth(u.accessToken));
        expect(blocked.status).toBe(409);
        await db.programEnrollment.updateMany({ where: { userId: u.userId, programId: 'stress-7' }, data: { startedAt: new Date(Date.now() - 10 * 86_400_000) } });
      }
      if (n > 1) await db.programEnrollment.updateMany({ where: { userId: u.userId, programId: 'stress-7' }, data: { startedAt: new Date(Date.now() - 10 * 86_400_000) } });
    }
    const fin = await request(app).get('/api/v1/programs/stress-7').set(auth(u.accessToken));
    expect(fin.body.data.status).toBe('COMPLETED');
  });

  it('pauses, resumes and follows the user locale', async () => {
    const u = await register(app, { locale: 'bn' });
    await request(app).post('/api/v1/programs/cbti-21/enroll').set(auth(u.accessToken));
    const p = await request(app).post('/api/v1/programs/cbti-21/pause').set(auth(u.accessToken));
    expect(p.body.data.status).toBe('PAUSED');
    const blocked = await request(app).post('/api/v1/programs/cbti-21/days/1/complete').set(auth(u.accessToken));
    expect(blocked.status).toBe(409);
    const back = await request(app).post('/api/v1/programs/cbti-21/enroll').set(auth(u.accessToken));
    expect(back.body.data.status).toBe('ACTIVE');
    const det = await request(app).get('/api/v1/programs/cbti-21').set(auth(u.accessToken));
    expect(/[ঀ-৿]/.test(det.body.data.title)).toBe(true);
    const bad = await request(app).get('/api/v1/programs/nope').set(auth(u.accessToken));
    expect(bad.status).toBe(400);
    const none = await request(app).post('/api/v1/programs/anxiety-14/pause').set(auth(u.accessToken));
    expect(none.status).toBe(404);
  });
});
