import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDatabase, withTenant } from '@school-erp/db';
import type { DatabaseHandle } from '@school-erp/db';
import {
  APP_URL,
  TENANT_A,
  TENANT_B,
  ctx,
  dropProbeTables,
  prepareDatabase,
} from '@school-erp/db/testing';
import { tenantHealthcheckJob } from '../src/jobs/index.js';
import { buildTenantJobData, defineTenantJob, runTenantJob } from '../src/tenant-job.js';

/** "Background jobs cannot accidentally process another tenant's data." */
describe('tenant-scoped background jobs', () => {
  let owner: Pool;
  let app: DatabaseHandle;

  const listNamesJob = defineTenantJob({
    name: 'test.list-names',
    payload: z.object({}).strict(),
    handle: async (tx) => {
      const r = await tx.execute<{ name: string; tenant_id: string }>(
        sql`select name, tenant_id from test_probe_parent order by name`,
      );
      return r.rows;
    },
  });

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = createDatabase({ connectionString: APP_URL, max: 2 });
    for (const [tenant, name] of [
      [TENANT_A, 'A1'],
      [TENANT_A, 'A2'],
      [TENANT_B, 'B1'],
    ] as const) {
      await withTenant(app.db, ctx(tenant), (tx) =>
        tx.execute(
          sql`insert into test_probe_parent (tenant_id, name) values (${tenant}, ${name})`,
        ),
      );
    }
  });

  afterAll(async () => {
    await app?.close();
    if (owner) {
      await dropProbeTables(owner);
      await owner.end();
    }
  });

  it('a job for School A only sees School A rows', async () => {
    const rows = await runTenantJob(
      app.db,
      listNamesJob,
      buildTenantJobData(listNamesJob, ctx(TENANT_A), {}),
    );
    expect(rows.map((r) => r.name)).toEqual(['A1', 'A2']);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([TENANT_A]));
  });

  it('a job for School B only sees School B rows', async () => {
    const rows = await runTenantJob(
      app.db,
      listNamesJob,
      buildTenantJobData(listNamesJob, ctx(TENANT_B), {}),
    );
    expect(rows.map((r) => r.name)).toEqual(['B1']);
  });

  it('rejects jobs without a valid tenant envelope and never runs the handler', async () => {
    const handle = vi.fn();
    const job = defineTenantJob({ name: 'test.spy', payload: z.object({}).strict(), handle });
    for (const bad of [
      {},
      { payload: {} },
      { tenantId: 'not-a-uuid', userId: null, requestId: 'r', payload: {} },
      { tenantId: TENANT_A, userId: null, requestId: '', payload: {} },
    ]) {
      await expect(runTenantJob(app.db, job, bad)).rejects.toMatchObject({
        code: 'TENANT_CONTEXT_MISSING',
      });
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('a payload cannot smuggle in another tenant id', async () => {
    const data = {
      ...buildTenantJobData(listNamesJob, ctx(TENANT_A), {}),
      payload: { tenantId: TENANT_B },
    };
    await expect(runTenantJob(app.db, listNamesJob, data)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('the diagnostic job runs inside the right tenant context', async () => {
    const result = await runTenantJob(
      app.db,
      tenantHealthcheckJob,
      buildTenantJobData(tenantHealthcheckJob, ctx(TENANT_B), {}),
    );
    expect(result.tenantId).toBe(TENANT_B);
  });
});
