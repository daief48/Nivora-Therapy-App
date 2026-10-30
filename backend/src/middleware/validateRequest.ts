import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

export function validate(schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      if (schemas.query) (req as any).validatedQuery = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (e) { next(e); }
  };
}
export const q = <T>(req: any): T => req.validatedQuery as T;

export const asyncHandler =
  (fn: (req: any, res: any, next: any) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };
