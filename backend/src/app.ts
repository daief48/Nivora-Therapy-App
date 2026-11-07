import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Db } from './config/database.js';
import type { Env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authLimiter, defaultLimits, globalLimiter, messageLimiter, ttsLimiter, type RateLimits } from './middleware/rateLimiter.js';
import { requestId } from './middleware/requestId.js';
import { authRouter } from './modules/auth/routes.js';
import { qualityRouter } from './modules/quality/routes.js';
import { therapyRouter } from './modules/therapy/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { crisisRouter } from './modules/crisis/routes.js';
import { journalAiRouter } from './modules/journalAi/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { nudgesRouter, todayRouter } from './modules/nudges/routes.js';
import { practiceRouter } from './modules/practice/routes.js';
import { wellnessProgramsRouter } from './modules/programs/wellness.js';
import { programsRouter } from './modules/programs/routes.js';
import { checkinsRouter } from './modules/checkins/routes.js';
import { insightsRouter } from './modules/insights/routes.js';
import { kaizenRouter } from './modules/kaizen/routes.js';
import { memoryRouter } from './modules/memory/routes.js';
import { sleepRouter } from './modules/sleep/routes.js';
import { goalsRouter } from './modules/goals/routes.js';
import { journalRouter } from './modules/journal/routes.js';
import { moodsRouter } from './modules/moods/routes.js';
import { assessmentsRouter } from './modules/assessments/routes.js';
import { privacyRouter } from './modules/privacy/routes.js';
import { safetyRouter } from './modules/safety/routes.js';
import { sessionsRouter } from './modules/sessions/routes.js';
import { topicsRouter } from './modules/topics/routes.js';
import { speechRouter } from './modules/speech/routes.js';
import { consentsRouter, usersRouter } from './modules/users/routes.js';
import type { Deps, Mailer } from './modules/deps.js';
import { createConversationService } from './services/conversationService.js';
import { createGlmClient, type GlmClient } from './services/glmClient.js';
import { createTtsClient, type TtsClient } from './services/ttsClient.js';
import { createSttClient, type SttClient } from './services/sttClient.js';
import { createEmbedder } from './services/knowledge/embedder.js';
import { createRetriever, type Retriever } from './services/knowledge/retriever.js';
import { loadSystemPrompt } from './services/systemPrompt.js';
import { createTelemetry, telemetrySecret } from './services/aiTelemetry.js';
import { actionsRouter } from './modules/actions/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { createCipher } from './utils/crypto.js';

export interface AppOptions {
  config: Env; db: Db; logger: Logger;
  retriever?: Retriever; glm?: GlmClient; utilityGlm?: GlmClient; tts?: TtsClient; stt?: SttClient; mailer?: Mailer; limits?: Partial<RateLimits>;
}

export function createDevMailer(logger: Logger, isProd: boolean): Mailer {
  return {
    async sendPasswordReset(email, token) {
      // No email provider is bundled (no paid APIs). Production must plug in a real SMTP mailer (see docs).
      if (isProd) logger.warn('Password reset requested but no mailer is configured');
      else logger.info({ resetToken: token, to: email }, 'DEV ONLY: password reset token (not sent by email)');
    },
  };
}

export function createApp(opts: AppOptions) {
  const { config, db, logger } = opts;
  const isProd = config.NODE_ENV === 'production';
  const limits = { ...defaultLimits, redisUrl: config.REDIS_URL, ...opts.limits };
  const cipher = createCipher(config.DATA_ENCRYPTION_KEYS);
  const useOpenAi = !!config.OPENAI_API_KEY;
  // Model tiering (OpenAI only): `glm` = session quality (user-facing replies, summaries), `utilityGlm` = cheap calls (emotion read).
  const openAiCfg = (model: string) => ({
    apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL, model, timeoutMs: config.GLM_TIMEOUT_MS,
    maxOutputTokens: config.GLM_MAX_OUTPUT_TOKENS, thinkingDisabled: false, streamUsage: true, reasoningEffort: config.OPENAI_REASONING_EFFORT || undefined,
  });
  const sessionModel = config.OPENAI_SESSION_MODEL || config.OPENAI_MODEL;
  const utilityModel = config.OPENAI_UTILITY_MODEL || config.OPENAI_MODEL;
  const glm = opts.glm ?? createGlmClient(useOpenAi
    ? openAiCfg(sessionModel)
    : { apiKey: config.GLM_API_KEY, baseUrl: config.GLM_BASE_URL, model: config.GLM_MODEL, timeoutMs: config.GLM_TIMEOUT_MS,
        maxOutputTokens: config.GLM_MAX_OUTPUT_TOKENS, thinkingDisabled: config.GLM_THINKING === 'disabled' });
  // An injected `glm` (tests) gets no separate utility client: the emotion read stays off unless one is injected too.
  const utilityGlm = opts.utilityGlm ?? (opts.glm ? undefined : useOpenAi ? createGlmClient(openAiCfg(utilityModel)) : glm);
  if (!opts.glm) logger.info({ provider: useOpenAi ? 'openai' : 'glm', sessionModel: useOpenAi ? sessionModel : config.GLM_MODEL, utilityModel: useOpenAi ? utilityModel : config.GLM_MODEL }, 'AI models configured');
  const telemetry = createTelemetry({ db, secret: telemetrySecret(config) });
  const conversation = createConversationService({
    telemetry, voiceJournal: config.VOICE_ENABLED === '1',
    db, glm, utilityGlm, cipher, systemPrompt: loadSystemPrompt(config.SYSTEM_PROMPT_FILE),
    emotionRead: { text: config.EMOTION_READ !== '0', voice: config.EMOTION_READ_VOICE === '1' }, styleGuard: config.STYLE_GUARD !== '0', luc: config.LUC_FLOW !== '0',
    log: (event, data) => logger.info(data, event),
    contextMessages: config.CONTEXT_MESSAGES, maxChars: config.MAX_MESSAGE_CHARS,
    retriever: opts.retriever ?? createRetriever({
      db, embedder: createEmbedder({ apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL }),
    }),
  });
  const deps: Deps = {
    db, glm, utilityGlm, config, logger, cipher, conversation, telemetry, mailer: opts.mailer ?? createDevMailer(logger, isProd),
    authenticate: authenticate(db, config.JWT_ACCESS_SECRET),
    authLimiter: authLimiter(limits), messageLimiter: messageLimiter(limits), ttsLimiter: ttsLimiter(limits), sttLimiter: ttsLimiter(limits),
    tts: opts.tts ?? createTtsClient({ apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL, model: config.OPENAI_TTS_MODEL, voice: config.OPENAI_TTS_VOICE, timeoutMs: config.GLM_TIMEOUT_MS }),
    stt: opts.stt ?? createSttClient({ apiKey: config.OPENAI_API_KEY, baseUrl: config.OPENAI_BASE_URL, model: config.OPENAI_STT_MODEL, timeoutMs: config.GLM_TIMEOUT_MS }),
  };

  const app = express();
  app.locals.deps = deps; // lets server.ts attach background jobs and the realtime relay
  app.disable('x-powered-by');
  if (isProd) app.set('trust proxy', 1);
  app.use(requestId);
  app.use(pinoHttp({
    logger, genReqId: (req) => (req as any).id,
    // Only method + path (no query string, headers or bodies) are logged.
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: String(r.url).split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) },
    autoLogging: { ignore: (req) => req.url === '/healthz' },
  }));
  app.use(helmet());
  const allowed = config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)) }));
  app.use(globalLimiter(limits));
  app.use(express.json({ limit: '128kb' }));

  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/readyz', async (_req, res) => {
    try { await db.$queryRaw`SELECT 1`; res.json({ status: 'ready' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter(deps));
  v1.use('/consents', consentsRouter(deps));
  v1.use('/sessions', sessionsRouter(deps));
  v1.use('/topics', topicsRouter(deps));
  v1.use('/moods', moodsRouter(deps));
  v1.use('/assessments', assessmentsRouter(deps));
  v1.use('/journal', journalRouter(deps));
  v1.use('/goals', goalsRouter(deps));
  v1.use('/checkins', checkinsRouter(deps));
  v1.use('/crisis', crisisRouter(deps));
  v1.use('/programs', wellnessProgramsRouter(deps)); // wellness courses (stress-7 ...)
  v1.use('/session-programs', programsRouter(deps)); // multi-day Sessions with daily Sittings
  v1.use('/journal-ai', journalAiRouter(deps));
  v1.use('/health', healthRouter(deps));
  v1.use('/nudges', nudgesRouter(deps));
  v1.use('/today', todayRouter(deps));
  v1.use('/practice', practiceRouter(deps));
  v1.use('/analytics', analyticsRouter(deps));
  v1.use('/therapy', therapyRouter(deps));
  v1.use('/quality', qualityRouter(deps));
  v1.use('/sleep', sleepRouter(deps));
  v1.use('/kaizen', kaizenRouter(deps));
  v1.use('/insights', insightsRouter(deps));
  v1.use('/actions', actionsRouter(deps));
  v1.use('/reports', reportsRouter(deps));
  v1.use('/memories', memoryRouter(deps));
  v1.use('/privacy', privacyRouter(deps));
  v1.use('/', speechRouter(deps)); // /speech
  v1.use('/', usersRouter(deps)); // /me
  v1.use('/', safetyRouter(deps)); // /resources/crisis, /safety/check
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(logger, isProd));
  return app;
}

