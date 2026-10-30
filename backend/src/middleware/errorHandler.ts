import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id } });
};

export function errorHandler(logger: Logger, isProd: boolean): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let status = 500, code = 'INTERNAL', message = 'Something went wrong', details: unknown;
    if (err instanceof AppError) ({ status, code, message, details } = err);
    else if (err instanceof ZodError) {
      status = 400; code = 'VALIDATION'; message = 'Invalid request';
      details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (err?.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large'; }
    else if (err?.type === 'entity.parse.failed') { status = 400; code = 'BAD_JSON'; message = 'Malformed JSON'; }
    if (status >= 500) {
      logger.error({ requestId: req.id, err: { name: err?.name, message: err?.message, stack: isProd ? undefined : err?.stack } }, 'unhandled error');
    }
    if (res.headersSent) { res.end(); return; }
    res.status(status).json({ error: { code, message, details, requestId: req.id } });
  };
}
