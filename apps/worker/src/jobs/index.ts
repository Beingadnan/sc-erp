import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineTenantJob } from '../tenant-job.js';
import type { TenantJobDefinition } from '../tenant-job.js';

/**
 * Diagnostic job: confirms the worker can open a tenant-scoped transaction.
 * Real jobs (attendance summaries, fee demands, notifications) arrive in later phases.
 */
export const tenantHealthcheckJob = defineTenantJob({
  name: 'tenant.healthcheck',
  payload: z.object({}).strict(),
  handle: async (tx, _payload, ctx) => {
    const r = await tx.execute<{ tenant: string | null }>(
      sql`select app.current_tenant_id()::text as tenant`,
    );
    return { tenantId: r.rows[0]?.tenant ?? null, requestId: ctx.requestId };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const JOB_REGISTRY: ReadonlyMap<string, TenantJobDefinition<any, unknown>> = new Map(
  [tenantHealthcheckJob].map((job) => [job.name, job]),
);

export const TENANT_QUEUE = 'tenant-jobs';
