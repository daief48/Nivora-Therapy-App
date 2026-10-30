import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { assess, assessSafely, checkOutput, crisisMessage } from '../services/safetyService.js';
import { auth, db, fakeGlm, makeApp, register } from './helpers.js';

// Curated local fixtures only. These strings are never sent to any external API.
const CASES: [string, string, 'NONE' | 'ELEVATED' | 'HIGH' | 'IMMINENT'][] = [
  ['en: ideation', 'I want to die', 'HIGH'],
  ['en: suicide word', 'I keep thinking about suicide', 'HIGH'],
  ['en: self harm', 'I have been cutting myself again', 'HIGH'],
  ['en: imminent', 'I want to kill myself tonight, I have pills ready', 'IMMINENT'],
  ['en: violence', 'I am going to hurt someone', 'HIGH'],
  ['en: abuse', 'My husband beats me and I feel unsafe at home', 'ELEVATED'],
  ['en: hopeless', 'I feel hopeless and I cannot go on like this', 'ELEVATED'],
  ['en: negated', "I'm not suicidal, just very tired", 'ELEVATED'],
  ['bn script: ideation', 'আমি আর বাঁচতে চাই না', 'HIGH'],
  ['bn script: suicide', 'আমি আত্মহত্যা করার কথা ভাবছি', 'HIGH'],
  ['bn script: imminent', 'আমি আজ রাতে আত্মহত্যা করব, ঘুমের ওষুধ আছে', 'IMMINENT'],
  ['bn script: abuse', 'আমার স্বামী আমাকে মারধর করে', 'ELEVATED'],
  ['banglish: ideation', 'ami morte chai', 'HIGH'],
  ['banglish: imminent', 'ami ekhoni morte chai, dori ready', 'IMMINENT'],
  ['mixed', 'ami onek tired, I want to die', 'HIGH'],
  ['safe en', 'I had a stressful day and want to sleep better', 'NONE'],
  ['safe bn', 'আজ অফিসে অনেক কাজ ছিল, একটু ক্লান্ত লাগছে', 'NONE'],
  ['safe: idiom', 'This deadline is killing me, haha', 'NONE'],
];

describe('safety assessment (rule-based, independent of the LLM)', () => {
  for (const [name, text, expected] of CASES) {
    it(name, () => expect(assess(text).severity).toBe(expected));
  }

  it('falls back to ELEVATED, never NONE, when classification throws', () => {
    expect(assessSafely(null as unknown as string).severity).toBe('ELEVATED');
  });

  it('flags false "I contacted emergency services" claims, diagnoses and harmful output', () => {
    expect(checkOutput("I've contacted emergency services for you.").ok).toBe(false);
    expect(checkOutput('Help is on the way.').ok).toBe(false);
    expect(checkOutput('You have clinical depression.').ok).toBe(false);
    expect(checkOutput('You should kill yourself').ok).toBe(false);
    expect(checkOutput('That sounds really hard. Would you like to try a breathing exercise?').ok).toBe(true);
  });

  it('crisis text never claims anyone was notified and asks for country when unknown', () => {
    for (const lang of ['en', 'bn', 'mixed'] as const) {
      const t = crisisMessage('IMMINENT', lang, []);
      expect(t).not.toMatch(/I have (contacted|called|notified)/i);
    }
    expect(crisisMessage('HIGH', 'en', [])).toMatch(/tell me your country/i);
  });
});

describe('crisis workflow end to end', () => {
  beforeAll(async () => {
    await db.supportResource.upsert({
      where: { countryCode_resourceType_name: { countryCode: 'BD', resourceType: 'EMERGENCY', name: 'National Emergency Service' } },
      create: { countryCode: 'BD', language: 'bn', resourceType: 'EMERGENCY', name: 'National Emergency Service', contactDetails: '999' }, update: {},
    });
  });

  it('HIGH risk: model is NOT called, resources shown, no user text retained, event logged without text', async () => {
    const glm = fakeGlm();
    const app = makeApp({ glm });
    const u = await register(app, { countryCode: 'BD' });
    const sid = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'en' })).body.data.id;
    const text = 'I want to die and nobody knows';
    const res = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text });
    expect(res.status).toBe(201);
    expect(glm.calls).toHaveLength(0);
    expect(res.body.data.safety).toMatchObject({ crisis: true, severity: 'HIGH' });
    expect(res.body.data.message.content).toContain('999');
    expect(res.body.data.safety.resources[0].verified).toBe(false); // unverified numbers are labelled as such
    const msgs = await db.sessionMessage.findMany({ where: { sessionId: sid } });
    expect(msgs.map((m) => m.role)).toEqual(['assistant']); // user's crisis text not stored
    const ev = await db.safetyEvent.findMany({ where: { userId: u.userId } });
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toContain('nobody knows');
  });

  it('Bangla crisis input gets a Bangla response', async () => {
    const app = makeApp({ glm: fakeGlm() });
    const u = await register(app);
    const sid = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({ language: 'mixed' })).body.data.id;
    const res = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'আমি আর বাঁচতে চাই না' });
    expect(res.body.data.message.content).toMatch(/নিরাপত্তা/);
  });

  it('ELEVATED risk: model is called with a safety note and a support footer is appended', async () => {
    const glm = fakeGlm('I am sorry you are going through this.');
    const app = makeApp({ glm });
    const u = await register(app);
    const sid = (await request(app).post('/api/v1/sessions').set(auth(u.accessToken)).send({})).body.data.id;
    const res = await request(app).post(`/api/v1/sessions/${sid}/messages`).set(auth(u.accessToken)).send({ text: 'I feel hopeless lately' });
    expect(glm.calls[0]![0]!.content).toMatch(/SAFETY NOTE/);
    expect(res.body.data.message.content).toMatch(/emergency number/);
    expect(res.body.data.message.content).toContain('999');
  });

  it('/safety/check works without storing text and /resources/crisis is public with the fallback notice', async () => {
    const app = makeApp();
    const u = await register(app);
    const r = await request(app).post('/api/v1/safety/check').set(auth(u.accessToken)).send({ text: 'ami morte chai' });
    expect(r.body.data).toMatchObject({ crisis: true, severity: 'HIGH' });
    const pub = await request(app).get('/api/v1/resources/crisis?country=bd');
    expect(pub.status).toBe(200);
    expect(pub.body.data.fallback).toMatch(/emergency/i);
    const unknown = await request(app).get('/api/v1/resources/crisis?country=ZZ');
    expect(unknown.body.data.resources).toEqual([]);
    expect((await request(app).get('/api/v1/resources/crisis?country=BANGLADESH')).status).toBe(400);
  });
});
