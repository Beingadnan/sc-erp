/**
 * Domain errors carry a stable machine-readable code. The API maps them to HTTP responses
 * with the shared error envelope (see docs/api/conventions.md).
 */
export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'TENANT_CONTEXT_MISSING'
  | 'MFA_REQUIRED'
  | 'MFA_SETUP_REQUIRED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Records belonging to another tenant are reported as NOT_FOUND, never FORBIDDEN,
 * so that IDs cannot be used to probe for the existence of other schools' data.
 */
export const notFound = (entity: string): AppError =>
  new AppError('NOT_FOUND', `${entity} not found`);
