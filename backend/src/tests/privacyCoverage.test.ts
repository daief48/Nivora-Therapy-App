import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { EXPORT_COVERED_MODELS, EXPORT_EXCLUDED_MODELS } from '../modules/privacy/routes.js';
import { packTopic } from '../services/topicService.js';
import { createCipher } from '../utils/crypto.js';
import { auth, config, db, makeApp, PASSWORD, register } from './helpers.js';

const app = makeApp();
const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
const enc = (s: string) => cipher.encrypt(s);

interface ModelInfo { name: string; userRelations: { field: string; onDelete: string | null }[] }
function parseSchema(): ModelInfo[] {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const out: ModelInfo[] = [];
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const rels = [...m[2].matchAll(/^\s*(\w+)\s+User\??\s+@relation\(([^)]*)\)/gm)].map((r) => ({ field: r[1], onDelete: /onDelete:\s*(\w+)/.exec(r[2])?.[1] ?? null }));
    out.push({ name: m[1], userRelations: rels });
  }
  return out;
}
// SetNull is only acceptable where the row is content-free and deliberately outlives the account.
const ALLOWED_SETNULL: Record<string, string> = { SafetyEvent: 'content-free safety audit rows (severity/category/action only) are retained by design' };

describe('privacy coverage: every user-owned model is exported or explicitly excluded', () => {
  const models = parseSchema();
  const owned = models.filter((m) => m.userRelations.length > 0 || m.name === 'User');
  it('parses the schema', () => { expect(owned.length).toBeGreaterThan(30); });
  it('each user-owned model is covered by the export or has a documented exclusion', () => {
    const covered = new Set<string>(EXPORT_COVERED_MODELS);
    const missing = owned.map((m) => m.name).filter((n) => !covered.has(n) && !(n in EXPORT_EXCLUDED_MODELS));
    expect(missing, `Add to EXPORT_COVERED_MODELS (and export it) or EXPORT_EXCLUDED_MODELS with a reason: ${missing.join(', ')}`).toEqual([]);
    for (const [n, why] of Object.entries(EXPORT_EXCLUDED_MODELS)) { expect(why.length, n).toBeGreaterThan(10); expect(covered.has(n), n).toBe(false); }
    const names = new Set(models.map((m) => m.name));
    for (const n of [...covered, ...Object.keys(EXPORT_EXCLUDED_MODELS)]) expect(names.has(n), `stale entry ${n}`).toBe(true);
  });
  it('account deletion: every User relation cascades (SetNull only where allowed)', () => {
    for (const m of owned.filter((x) => x.name !== 'User')) {
      for (const r of m.userRelations) {
        if (r.onDelete === 'Cascade') continue;
        expect(r.onDelete === 'SetNull' && m.name in ALLOWED_SETNULL, `${m.name}.${r.field} onDelete=${r.onDelete}`).toBe(true);
      }
    }
  });
});

describe('privacy: export covers newer models; deletion removes them', () => {
  it('exports and then deletes rows across models', async () => {
    const a = await register(app), b = await register(app);
    const uid = a.userId;
    const topic = await db.topic.create({ data: { userId: uid, encryptedContent: packTopic(cipher, { kind: 'ANXIETY' as any, label: 'my-secret-label' }) } });
    const prog = await db.sessionProgram.create({ data: { userId: uid, topicId: topic.id, titleEncrypted: enc('prog-title-x'), goalEncrypted: enc('prog-goal-x'), plannedDays: 7, dailyMinutes: 30 } });
    const sess = await db.therapySession.create({ data: { userId: uid, topicId: topic.id, programId: prog.id, dayNumber: 1 } });
    await db.sessionNote.create({ data: { userId: uid, sessionId: sess.id, encryptedContent: enc(JSON.stringify({ summary: 'note-summary-x' })) } });
    await db.treatmentPlan.create({ data: { userId: uid, version: 1, encryptedContent: enc(JSON.stringify({ focus: 'plan-focus-x' })) } });
    await db.homework.create({ data: { userId: uid, sessionId: sess.id, titleEncrypted: enc('hw-title-x') } });
    await db.themeTracker.create({ data: { userId: uid, themeKey: 'k1', labelEncrypted: enc('theme-label-x') } });
    await db.sessionSchedule.create({ data: { userId: uid, weekdays: [1, 3] } });
    await db.qualityReviewSample.create({ data: { userId: uid, encryptedContent: enc('qr-excerpt-x') } });
    await db.trustedContact.create({ data: { userId: uid, nameEncrypted: enc('contact-name-x'), phoneEncrypted: enc('+8801000000000') } });
    await db.safetyPlan.create({ data: { userId: uid, encryptedContent: enc(JSON.stringify({ warningSigns: ['plan-sign-x'] })) } });
    await db.programEnrollment.create({ data: { userId: uid, programId: 'stress-7' } });
    await db.safetyEvent.create({ data: { userId: uid, sessionId: sess.id, severity: 'HIGH', category: 'SELF_HARM', actionTaken: 'SHOWN_RESOURCES' } });
    await db.userGoal.create({ data: { userId: uid, titleEnc: enc('ug-title-x'), tasksJson: '[]', anchorEnc: enc('ug-anchor-x'), timePerDayMin: 17, reminderMin: 421, difficultyJson: '[{"taskId":"t","difficulty":"HARD"}]', milestonesJson: '["50"]' } });
    await db.therapySession.update({ where: { id: sess.id }, data: { scopeChoice: 'OFFERED', scopeChoiceTurn: 4 } });
    await db.homework.create({ data: { userId: b.userId, titleEncrypted: enc('other-hw-x') } });

    const ex = await request(app).post('/api/v1/privacy/export').set(auth(a.accessToken));
    expect(ex.status).toBe(200);
    const body = ex.body.data, s = JSON.stringify(body);
    for (const t of ['my-secret-label', 'prog-title-x', 'prog-goal-x', 'note-summary-x', 'plan-focus-x', 'hw-title-x', 'theme-label-x', 'qr-excerpt-x', 'contact-name-x', '+8801000000000', 'plan-sign-x', 'stress-7']) expect(s, t).toContain(t);
    expect(s).not.toContain('other-hw-x');
    expect(body.userGoals[0]).toMatchObject({ title: 'ug-title-x', anchor: 'ug-anchor-x', timePerDayMin: 17, reminderMin: 421, milestones: ['50'] });
    expect(body.userGoals[0].difficulty[0].difficulty).toBe('HARD');
    expect(body.sessions.find((x: any) => x.id === sess.id).scopeChoiceTurn).toBe(4);
    expect(body.sessions.find((x: any) => x.id === sess.id)).toMatchObject({ topicId: topic.id, programId: prog.id });
    expect(body.safetyEvents).toHaveLength(1);
    expect(Object.keys(body.safetyEvents[0]).sort()).toEqual(['actionTaken', 'category', 'createdAt', 'sessionId', 'severity']);
    expect(await db.auditLog.count({ where: { actorId: uid, action: 'DATA_EXPORT' } })).toBe(1);

    await request(app).delete('/api/v1/privacy/account').set(auth(a.accessToken)).send({ password: PASSWORD }).expect(204);
    for (const t of ['topic', 'sessionProgram', 'therapySession', 'sessionNote', 'treatmentPlan', 'homework', 'themeTracker', 'sessionSchedule', 'qualityReviewSample', 'trustedContact', 'safetyPlan', 'programEnrollment']) {
      expect(await (db as any)[t].count({ where: { userId: uid } }), t).toBe(0);
    }
    expect(await db.safetyEvent.count({ where: { userId: uid } })).toBe(0); // SetNull: detached, not owned
    expect(await db.safetyEvent.count({ where: { sessionId: sess.id } })).toBe(1); // retained content-free
    expect(await db.homework.count({ where: { userId: b.userId } })).toBe(1);
  });
});
