import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  DATA_ENCRYPTION_KEYS: z.string().min(1),
  // If OPENAI_API_KEY is set the OpenAI provider is used, otherwise GLM. Only the backend ever holds these.
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  // Model tiering: replies the user reads or hears (chat, sessions, calls) vs. cheap utility calls (emotion read, clean-up).
  // Unset utility model falls back to OPENAI_MODEL.
  OPENAI_SESSION_MODEL: z.string().default('gpt-4.1'),
  OPENAI_UTILITY_MODEL: z.string().default(''),
  // reasoning_effort for reasoning models (gpt-5 / o-series) only; ignored for other models. Empty = omit.
  OPENAI_REASONING_EFFORT: z.string().default('low'),
  // Emotion read before each reply: on for text chat, off for voice calls (latency) unless EMOTION_READ_VOICE=1. EMOTION_READ=0 disables it.
  EMOTION_READ: z.string().default('1'),
  EMOTION_READ_VOICE: z.string().default('0'),
  // Deterministic style check of text-chat replies with one corrective regeneration. STYLE_GUARD=0 disables it.
  STYLE_GUARD: z.string().default('1'),
  // Natural voice for calls. gpt-4o-mini-tts + instructions gave ~0-2% Bangla character error in a round-trip test (tts-1: 15-50%).
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  OPENAI_STT_MODEL: z.string().default('gpt-transcribe'),
  OPENAI_TTS_VOICE: z.string().default('marin'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  GLM_API_KEY: z.string().default(''),
  GLM_BASE_URL: z.string().url().default('https://api.z.ai/api/paas/v4'),
  GLM_MODEL: z.string().default(''),
  // 'disabled' sends thinking:{type:'disabled'} (GLM-4.6+) for lower latency; 'default' omits the field.
  GLM_THINKING: z.enum(['disabled', 'default']).default('disabled'),
  GLM_TIMEOUT_MS: z.coerce.number().default(45000),
  GLM_MAX_OUTPUT_TOKENS: z.coerce.number().default(600),
  MAX_MESSAGE_CHARS: z.coerce.number().default(4000),
  CONTEXT_MESSAGES: z.coerce.number().default(20),
  SYSTEM_PROMPT_FILE: z.string().optional(),
  // Optional: shared cache + rate-limit counters. Unset (or unreachable) = in-memory.
  REDIS_URL: z.string().optional(),
  // Optional: HMAC secret for the daily-rotating analytics id. Falls back to a value derived from JWT_ACCESS_SECRET.
  ANALYTICS_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  // A sitting can be done in text, voice or video (video = voice call + avatar on the client). Ops can switch a mode off with '0'.
  // VIDEO also needs VOICE_ENABLED='1'.
  VOICE_ENABLED: z.string().default('1'),
  VIDEO_ENABLED: z.string().default('1'),
  // '1' = POST /sessions without a program still works (legacy standalone sessions). Default: every sitting belongs to a program.
  ALLOW_STANDALONE_SESSIONS: z.string().default('0'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.CORS_ORIGINS === '*') {
    throw new Error('CORS_ORIGINS must be an explicit allowlist in production');
  }
  return parsed.data;
}
