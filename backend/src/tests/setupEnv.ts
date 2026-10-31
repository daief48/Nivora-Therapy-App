// Deterministic test environment (no real secrets). Runs before each test file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5440/therapy_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.DATA_ENCRYPTION_KEYS = `t1:${Buffer.alloc(32, 7).toString('base64')}`;
process.env.GLM_API_KEY = 'test-key';
process.env.GLM_MODEL = 'test-model';
process.env.LOG_LEVEL = 'silent';
process.env.ALLOW_STANDALONE_SESSIONS = '1'; // the pre-program suites create standalone sessions
process.env.VOICE_ENABLED = '1'; // and voice sessions; programs.test flips these off per app
