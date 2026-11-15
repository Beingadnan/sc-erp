import { AppError } from '@school-erp/shared';

interface PgError {
  code?: string;
  constraint?: string;
}

/** Drizzle wraps driver errors; find the underlying Postgres error. */
export const pgErrorOf = (err: unknown): PgError | null => {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === 'object' && e !== null && typeof (e as PgError).code === 'string') {
      const code = (e as PgError).code!;
      if (/^[0-9A-Z]{5}$/.test(code)) return e as PgError;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
};

/**
 * Converts unique-constraint (23505) and foreign-key (23503: row still in use) violations
 * into CONFLICT errors with a stable reason.
 * Anything else is rethrown unchanged.
 */
export const rethrowConflicts = (err: unknown, reasons: Record<string, string>): never => {
  const pg = pgErrorOf(err);
  if ((pg?.code === '23505' || pg?.code === '23503') && pg.constraint && reasons[pg.constraint]) {
    throw new AppError('CONFLICT', reasons[pg.constraint]!, { reason: pg.constraint });
  }
  throw err;
};
