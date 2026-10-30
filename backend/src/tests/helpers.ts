import { PassThrough } from 'node:stream';
import request from 'supertest';
import { createApp } from '../app.js';
import { getPrisma } from '../config/database.js';
import { loadEnv } from '../config/env.js';
import type { Mailer } from '../modules/deps.js';
import type { GlmClient } from '../services/glmClient.js';
import { createLogger } from '../utils/logger.js';

export const db = getPrisma();
export const config = loadEnv();

export interface FakeGlm extends GlmClient { calls: { role: string; content: string }[][]; reply: string | Error; streamParts?: string[] }

/** Mocked GLM client: no network, no real crisis content is ever sent to an external API from tests. */
export function fakeGlm(reply: string | Error = 'I hear you. What feels hardest right now?'): FakeGlm {
  const g: FakeGlm = {
    calls: [], reply,
    async chat(messages) {
      g.calls.push(messages as any);
      if (g.reply instanceof Error) throw g.reply;
      return { content: g.reply, inputTokens: 11, outputTokens: 7 };
    },
    async stream(messages, onDelta) {
      g.calls.push(messages as any);
      if (g.reply instanceof Error) throw g.reply;
      for (const p of g.streamParts ?? [g.reply]) onDelta(p);
      return { content: (g.streamParts ?? [g.reply]).join(''), inputTokens: 11, outputTokens: 7 };
    },
  };
  return g;
}

export function makeApp(opts: { glm?: GlmClient; limits?: any; logStream?: NodeJS.WritableStream; mailer?: Mailer } = {}) {
  const logger = opts.logStream ? createLogger('trace', opts.logStream as any) : createLogger('silent');
  return createApp({ config, db, logger, glm: opts.glm ?? fakeGlm(), limits: { global: 10_000, auth: 10_000, messages: 10_000, ...opts.limits }, mailer: opts.mailer });
}
export type TestApp = ReturnType<typeof makeApp>;

let n = 0;
export const PASSWORD = 'correct-horse-9';
export async function register(app: TestApp, overrides: Record<string, unknown> = {}) {
  const email = `user${Date.now()}_${n++}@example.com`;
  const res = await request(app).post('/api/v1/auth/register').send({
    email, password: PASSWORD, displayName: 'Test', locale: 'en', countryCode: 'BD',
    consents: { age18Plus: true, aiDisclosure: true, privacy: true }, ...overrides,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, ...res.body.data as { userId: string; accessToken: string; refreshToken: string } };
}
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

export function captureLogs() {
  const stream = new PassThrough();
  let out = '';
  stream.on('data', (c) => (out += c.toString()));
  return { stream, text: () => out };
}
