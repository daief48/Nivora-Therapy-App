import type { Logger } from 'pino';
import type { Db } from '../config/database.js';
import type { Env } from '../config/env.js';
import type { ConversationService } from '../services/conversationService.js';
import type { Cipher } from '../utils/crypto.js';
import type { TtsClient } from '../services/ttsClient.js';
import type { SttClient } from '../services/sttClient.js';
import type { RequestHandler } from 'express';
import type { GlmClient } from '../services/glmClient.js';

export interface Mailer { sendPasswordReset(email: string, token: string): Promise<void> }

export interface Deps {
  db: Db; glm: GlmClient; config: Env; logger: Logger; cipher: Cipher;
  conversation: ConversationService; mailer: Mailer;
  authenticate: RequestHandler; authLimiter: RequestHandler; messageLimiter: RequestHandler; ttsLimiter: RequestHandler; sttLimiter: RequestHandler; tts: TtsClient; stt: SttClient;
}

