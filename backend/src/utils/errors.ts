export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (m = 'Invalid request', d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Not allowed', code = 'FORBIDDEN') => new AppError(403, code, m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m = 'Conflict') => new AppError(409, 'CONFLICT', m);
/** `details.consentType` names the (first) missing consent so the client can route the user to the right opt-in. */
export const consentRequired = (m = 'Required consent is missing', details?: { consentType: string; missing?: string[] }) => new AppError(403, 'CONSENT_REQUIRED', m, details);
export const providerError = (m = 'The AI service is temporarily unavailable', code = 'AI_UNAVAILABLE', status = 503) =>
  new AppError(status, code, m);
