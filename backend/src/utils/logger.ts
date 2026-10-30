import pino, { type DestinationStream, type Logger } from 'pino';

// Never log request bodies, auth headers or message/journal content. Redaction is defence-in-depth:
// code must not pass such data to the logger in the first place.
export function createLogger(level = 'info', stream?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash',
          '*.token', '*.refreshToken', '*.accessToken', '*.content', '*.note', '*.text', '*.encryptedContent',
        ],
        censor: '[REDACTED]',
      },
    },
    stream as DestinationStream,
  );
}
