import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client.js';
import type { DatabaseHandle } from '../src/client.js';
import { assertAppRoleIsSafe, withTenant } from '../src/tenant.js';
import {
  APP_URL,
  OWNER_URL,
  PG,
  TENANT_A,
  TENANT_B,
  ctx,
  dropProbeTables,
  isPgError,
  prepareDatabase,
} from './helpers.js';

/**
 * CRITICAL SECURITY SUITE. A failure here is a tenant-isolation defect.
 * Two independent tenants (A and B) are used throughout.
 */
describe('tenant isolation (RLS via erp_app)', () => {
  let owner: Pool;
  let app: DatabaseHandle;
  let rowA: string;
  let rowB: string;

  beforeAll(async () => {
    owner = await prepareDatabase();
    // Single connection: proves context cannot leak between consecutive transactions
    // that reuse the same server connection (what PgBouncer transaction pooling does).
    app = createDatabase({ connectionString: APP_URL, max: 1 });

    rowA = await withTenant(app.db, ctx(TENANT_A), async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into test_probe_parent (tenant_id, name) values (${TENANT_A}, 'School A student') returning id`,
      );
      return r.rows[0]!.id;
    });
    rowB = await withTenant(app.db, ctx(TENANT_B), async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into test_probe_parent (tenant_id, name) values (${TENANT_B}, 'School B student') returning id`,
      );
      return r.rows[0]!.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    if (owner) {
      await dropProbeTables(owner);
      await owner.end();
    }
  });

  it('the application role cannot bypass RLS', async () => {
    await expect(assertAppRoleIsSafe(app.pool)).resolves.toBeUndefined();
    const { rows } = await app.pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('denies all rows when no tenant context is set (default deny)', async () => {
    const { rows } = await app.pool.query(`select * from test_probe_parent`);
    expect(rows).toHaveLength(0);
  });

  it('School A sees only School A rows', async () => {
    const names = await withTenant(app.db, ctx(TENANT_A), async (tx) => {
      const r = await tx.execute<{ name: string }>(sql`select name from test_probe_parent`);
      return r.rows.map((x) => x.name);
    });
    expect(names).toEqual(['School A student']);
  });

  it('School A cannot read School B rows by ID (IDOR)', async () => {
    const found = await withTenant(app.db, ctx(TENANT_A), async (tx) => {
      const r = await tx.execute(sql`select id from test_probe_parent where id = ${rowB}`);
      return r.rows.length;
    });
    expect(found).toBe(0);
  });

  it('School A cannot update or delete School B rows by ID', async () => {
    const affected = await withTenant(app.db, ctx(TENANT_A), async (tx) => {
      const u = await tx.execute(
        sql`update test_probe_parent set name = 'hacked' where id = ${rowB}`,
      );
      const d = await tx.execute(sql`delete from test_probe_parent where id = ${rowB}`);
      return (u.rowCount ?? 0) + (d.rowCount ?? 0);
    });
    expect(affected).toBe(0);
    const name = await withTenant(app.db, ctx(TENANT_B), async (tx) => {
      const r = await tx.execute<{ name: string }>(
        sql`select name from test_probe_parent where id = ${rowB}`,
      );
      return r.rows[0]?.name;
    });
    expect(name).toBe('School B student');
  });

  it('School A cannot insert rows tagged with School B tenant_id (WITH CHECK)', async () => {
    await expect(
      withTenant(app.db, ctx(TENANT_A), (tx) =>
        tx.execute(
          sql`insert into test_probe_parent (tenant_id, name) values (${TENANT_B}, 'smuggled')`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('School A cannot move its row into School B', async () => {
    await expect(
      withTenant(app.db, ctx(TENANT_A), (tx) =>
        tx.execute(sql`update test_probe_parent set tenant_id = ${TENANT_B} where id = ${rowA}`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('composite foreign keys prevent linking to another tenant’s record', async () => {
    await expect(
      withTenant(app.db, ctx(TENANT_A), (tx) =>
        tx.execute(
          sql`insert into test_probe_child (tenant_id, parent_id, note) values (${TENANT_A}, ${rowB}, 'cross link')`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.FOREIGN_KEY_VIOLATION));
  });

  it('tenant context does not survive the transaction on a reused connection', async () => {
    await withTenant(app.db, ctx(TENANT_A), (tx) => tx.execute(sql`select 1`));
    const { rows } = await app.pool.query<{ t: string | null; n: string }>(
      `select current_setting('app.tenant_id', true) as t, (select count(*) from test_probe_parent)::text as n`,
    );
    expect(rows[0]?.t ?? '').toBe('');
    expect(rows[0]?.n).toBe('0');
  });

  it('context does not leak when a transaction fails midway', async () => {
    await expect(
      withTenant(app.db, ctx(TENANT_A), async (tx) => {
        await tx.execute(sql`select 1`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rows } = await app.pool.query(`select * from test_probe_parent`);
    expect(rows).toHaveLength(0);
  });

  it('interleaved concurrent requests for A and B each see only their own data', async () => {
    const pooled = createDatabase({ connectionString: APP_URL, max: 4 });
    try {
      const runs = Array.from({ length: 24 }, (_, i) => {
        const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
        return withTenant(pooled.db, ctx(tenant), async (tx) => {
          await tx.execute(sql`select pg_sleep(${(i % 3) * 0.01})`);
          const r = await tx.execute<{ tenant_id: string }>(
            sql`select tenant_id from test_probe_parent`,
          );
          return { tenant, seen: r.rows.map((x) => x.tenant_id) };
        });
      });
      for (const { tenant, seen } of await Promise.all(runs)) {
        expect(seen).toEqual([tenant]);
      }
    } finally {
      await pooled.close();
    }
  });

  it('rejects malformed tenant ids before touching the database', async () => {
    await expect(
      withTenant(app.db, { tenantId: "' OR 1=1 --", userId: null, requestId: 'x' }, async () => 1),
    ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
    await expect(
      withTenant(app.db, { tenantId: '', userId: null, requestId: 'x' }, async () => 1),
    ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });

  it('the application role cannot disable RLS, change ownership or read migration history', async () => {
    await expect(
      app.pool.query(`alter table test_probe_parent disable row level security`),
    ).rejects.toThrow(/must be owner/);
    await expect(
      app.pool.query(`alter table test_probe_parent no force row level security`),
    ).rejects.toThrow(/must be owner/);
    await expect(
      app.pool.query(`drop policy tenant_isolation on test_probe_parent`),
    ).rejects.toThrow(/must be owner/);
    await expect(app.pool.query(`set role erp_owner`)).rejects.toThrow(/permission denied/);
    await expect(app.pool.query(`select * from drizzle.__drizzle_migrations`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.pool.query(`create table sneaky (id int)`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('read-only transactions cannot write', async () => {
    await expect(
      withTenant(
        app.db,
        ctx(TENANT_A),
        (tx) =>
          tx.execute(
            sql`insert into test_probe_parent (tenant_id, name) values (${TENANT_A}, 'x')`,
          ),
        { readOnly: true },
      ),
    ).rejects.toSatisfy(isPgError(PG.READ_ONLY_TRANSACTION));
  });

  it('uses the owner URL only for fixtures', () => {
    expect(OWNER_URL).not.toBe(APP_URL);
  });
});
