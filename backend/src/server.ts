import { createApp } from './app.js';
import { getPrisma } from './config/database.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './utils/logger.js';

const config = loadEnv();
const logger = createLogger(config.LOG_LEVEL);
const db = getPrisma();

const provider = config.OPENAI_API_KEY ? 'openai' : 'glm';
if (provider === 'glm' && (!config.GLM_API_KEY || !config.GLM_MODEL)) {
  logger.warn('No OPENAI_API_KEY and no GLM_API_KEY/GLM_MODEL: AI chat will return AI_NOT_CONFIGURED until configured');
}
logger.info({ provider }, 'AI provider selected');

const server = createApp({ config, db, logger }).listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => logger.error({ err: String(e) }, 'unhandled rejection'));
