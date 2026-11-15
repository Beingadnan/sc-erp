import { z } from 'zod';
import { withTenant } from '@school-erp/db';
import type { Database, Transaction } from '@school-erp/db';
import { AppError } from '@school-erp/shared';
import type { TenantContext } from '@school-erp/shared';

/**
 * Every background job carries the tenant it belongs to in a fixed envelope.
 * The envelope is built from a verified TenantContext at enqueue time (never from
 * client input) and re-validated by the worker before any data is touched.
 */
export const tenantJobEnvelope = z.object({
  tenantId: z.uuid(),
  userId: z.uuid().nullable(),
  requestId: z.string().min(1).max(128),
  payload: z.unknown(),
});
export type TenantJobData = z.infer<typeof tenantJobEnvelope>;

export interface TenantJobDefinition<P, R> {
  /** Queue job name, e.g. "attendance.monthly-summary". */
  readonly name: string;
  /** Strict schema for the job-specific payload. Must not contain tenant ids. */
  readonly payload: z.ZodType<P>;
  readonly handle: (tx: Transaction, payload: P, ctx: TenantContext) => Promise<R>;
}

export const defineTenantJob = <P, R>(def: TenantJobDefinition<P, R>): TenantJobDefinition<P, R> =>
  def;

/** Builds job data from a verified context. Use for every enqueue. */
export const buildTenantJobData = <P>(
  def: TenantJobDefinition<P, unknown>,
  ctx: TenantContext,
  payload: P,
): TenantJobData => ({
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  requestId: ctx.requestId,
  payload: def.payload.parse(payload),
});

/**
 * Validates the envelope and payload, then runs the handler inside withTenant so
 * Row-Level Security limits it to exactly one tenant's rows.
 */
export const runTenantJob = async <P, R>(
  db: Database,
  def: TenantJobDefinition<P, R>,
  rawData: unknown,
): Promise<R> => {
  const envelope = tenantJobEnvelope.safeParse(rawData);
  if (!envelope.success) {
    throw new AppError('TENANT_CONTEXT_MISSING', `Job ${def.name} has an invalid tenant envelope`);
  }
  const payload = def.payload.safeParse(envelope.data.payload);
  if (!payload.success) {
    throw new AppError('VALIDATION_FAILED', `Job ${def.name} has an invalid payload`);
  }
  const ctx: TenantContext = {
    tenantId: envelope.data.tenantId,
    userId: envelope.data.userId,
    requestId: envelope.data.requestId,
  };
  return withTenant(db, ctx, (tx) => def.handle(tx, payload.data, ctx));
};
