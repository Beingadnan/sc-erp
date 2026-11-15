import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { AppError, isUuid } from '@school-erp/shared';
import type { TenantContext } from '@school-erp/shared';
import type { Database, Transaction } from './client.js';

export interface WithTenantOptions {
  readOnly?: boolean;
}

/** Context for one database transaction. Only ids from verified sources. */
export interface DbContext {
  readonly tenantId?: string | null;
  readonly userId?: string | null;
  readonly requestId: string;
}

/**
 * Sets the context for the CURRENT transaction with set_config(..., is_local = true).
 * It is cleared at COMMIT/ROLLBACK, so it is safe behind Neon's PgBouncer pooler
 * (transaction mode), where session-level SET would leak into another client's work.
 */
export const setContext = async (tx: Transaction, ctx: DbContext): Promise<void> => {
  assertValidContext(ctx);
  await tx.execute(
    sql`select
          set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
          set_config('app.user_id', ${ctx.userId ?? ''}, true),
          set_config('app.request_id', ${ctx.requestId}, true)`,
  );
};

/**
 * Runs `fn` in a transaction with the given (possibly tenant-less) context. Use for
 * authentication and other user-level work; tenant data needs withTenant.
 */
export const withContext = async <T>(
  db: Database,
  ctx: DbContext,
  fn: (tx: Transaction) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> => {
  assertValidContext(ctx);
  return db.transaction(
    async (tx) => {
      await setContext(tx, ctx);
      return fn(tx);
    },
    options.readOnly ? { accessMode: 'read only' } : undefined,
  );
};

/**
 * The ONLY way application code touches tenant data.
 *
 * Row-Level Security policies read app.current_tenant_id(); with no context set they
 * match nothing (default deny).
 */
export const withTenant = async <T>(
  db: Database,
  ctx: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> => {
  if (!ctx || !isUuid(ctx.tenantId)) {
    throw new AppError('TENANT_CONTEXT_MISSING', 'A valid tenant context is required');
  }
  return withContext(db, ctx, fn, options);
};

const assertValidContext = (ctx: DbContext): void => {
  if (!ctx) {
    throw new AppError('TENANT_CONTEXT_MISSING', 'A context is required');
  }
  if (ctx.tenantId !== null && ctx.tenantId !== undefined && !isUuid(ctx.tenantId)) {
    throw new AppError('TENANT_CONTEXT_MISSING', 'Invalid tenant id in context');
  }
  if (ctx.userId !== null && ctx.userId !== undefined && !isUuid(ctx.userId)) {
    throw new AppError('TENANT_CONTEXT_MISSING', 'Invalid user id in context');
  }
  if (!ctx.requestId || ctx.requestId.length > 128) {
    throw new AppError('TENANT_CONTEXT_MISSING', 'A request id is required');
  }
};

/**
 * Refuses to run the app with a database role that could bypass Row-Level Security.
 * Call at process start-up (API and worker).
 */
export const assertAppRoleIsSafe = async (pool: Pool): Promise<void> => {
  const { rows } = await pool.query<{
    role: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `select current_user as role, r.rolsuper, r.rolbypassrls
       from pg_roles r where r.rolname = current_user`,
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Could not inspect the current database role');
  }
  if (row.rolsuper || row.rolbypassrls) {
    throw new Error(
      `Refusing to start: database role "${row.role}" can bypass Row-Level Security. ` +
        'Connect the application with the erp_app role (see docs/architecture/multi-tenancy.md).',
    );
  }
};
