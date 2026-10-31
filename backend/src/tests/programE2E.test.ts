import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

// End to end through HTTP: a 3-day program in Asia/Dhaka, the second program stays isolated, another user is locked out.
const glm = fakeGlm();
const app = makeApp({ glm });
const at = (iso: string) => { if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
afterEach(() => { vi.useRealTimers(); });

const mkProgram = async (token: string, title: string) => {
  const r = await request(app).post('/api/v1/session-programs').set(auth(token)).send({ title, goal: `${title} goal`, plannedDays: 3, dailyMinutes: 30, kind: 'SLEEP' });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
};
const start = (token: string, pid: string) => request(app).post(`/api/v1/session-programs/${pid}/sittings`).set(auth(token)).send({});
const say = (token: string, sid: string, text: string) => request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(token)).send({ text });
const end = (token: string, sid: string) => request(app).post(`/api/v1/sessions/${sid}/end`).set(auth(token)).send({});

describe('program end to end', () => {
  it('3 local days in Asia/Dhaka complete the program with a final note; a second program and another user are isolated', async () => {
    const a = await register(app);
    await db.user.update({ where: { id: a.userId }, data: { timezone: 'Asia/Dhaka' } });
    await db.userProfile.update({ where: { userId: a.userId }, data: { preferencesJson: { continuityOptIn: true } } });
    const pid = await mkProgram(a.accessToken, 'Sleep');

    at('2025-05-01T04:00:00Z'); // 10:00 in Dhaka
    const d1 = await start(a.accessToken, pid);
    expect(d1.status).toBe(201);
    expect(d1.body.data).toMatchObject({ dayNumber: 1, isIntake: true, intakePart: 1, sessionType: 'TEXT' });
    expect((await say(a.accessToken, d1.body.data.sittingId, 'ZEBRA-SECRET phrase about my sleep')).status).toBe(201);
    expect((await end(a.accessToken, d1.body.data.sittingId)).status).toBe(200);

    at('2025-05-01T10:00:00Z'); // 16:00 same Dhaka day
    const again = await start(a.accessToken, pid);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DONE_TODAY');
    expect(again.body.error.details.nextAvailableAt).toBe('2025-05-01T18:00:00.000Z'); // midnight Dhaka

    at('2025-05-01T18:30:00Z'); // 00:30 next Dhaka day (still the same UTC day)
    const d2 = await start(a.accessToken, pid);
    expect(d2.status).toBe(201);
    expect(d2.body.data).toMatchObject({ dayNumber: 2, intakePart: 2 });
    await say(a.accessToken, d2.body.data.sittingId, 'Second day message');
    await end(a.accessToken, d2.body.data.sittingId);

    at('2025-05-02T18:30:00Z');
    const d3 = await start(a.accessToken, pid);
    expect(d3.body.data).toMatchObject({ dayNumber: 3, isIntake: false });
    await say(a.accessToken, d3.body.data.sittingId, 'Last day message');
    await end(a.accessToken, d3.body.data.sittingId);

    const view = (await request(app).get(`/api/v1/session-programs/${pid}`).set(auth(a.accessToken))).body.data;
    expect(view).toMatchObject({ status: 'COMPLETED', todayState: 'COMPLETED', completedSittings: 3, progressPct: 100 });
    expect(view.completedAt).toBeTruthy();
    expect(await db.sessionNote.findUnique({ where: { sessionId: d3.body.data.sittingId } })).not.toBeNull(); // final review note
    expect(glm.calls.some((c) => c[0]!.content.includes('FINAL sitting of a 3-day program'))).toBe(true);
    expect((await start(a.accessToken, pid)).body.error.code).toBe('PROGRAM_NOT_ACTIVE');

    // a second program of the same user sees nothing of the first
    const pid2 = await mkProgram(a.accessToken, 'Exams');
    glm.calls.length = 0;
    at('2025-05-03T04:00:00Z');
    const e1 = await start(a.accessToken, pid2);
    expect(e1.body.data.dayNumber).toBe(1);
    await say(a.accessToken, e1.body.data.sittingId, 'Hello there');
    const prompt = glm.calls.flat().map((m) => m.content).join('\n');
    expect(prompt).not.toMatch(/ZEBRA-SECRET|Second day message|Last day message/);

    // user B: 404 on everything of A
    const b = await register(app);
    expect((await request(app).get(`/api/v1/session-programs/${pid2}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await start(b.accessToken, pid2)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/session-programs/${pid2}`).set(auth(b.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/v1/session-programs/${pid2}`).set(auth(a.accessToken))).status).toBe(200);

    // /therapy/sessions exposes programId + dayNumber so the app can separate program sittings from earlier sessions
    const list = (await request(app).get('/api/v1/therapy/sessions').set(auth(a.accessToken))).body.data as any[];
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.every((s) => typeof s.programId === 'string' && typeof s.dayNumber === 'number')).toBe(true);
  });
});
