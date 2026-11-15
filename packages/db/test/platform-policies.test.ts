import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@school-erp/shared';
import { createDatabase } from '../src/client.js';
import type { DatabaseHandle, Transaction } from '../src/client.js';
import { setContext, withContext } from '../src/tenant.js';
import { APP_URL, PG, isPgError, prepareDatabase } from './helpers.js';

/**
 * Global tables and SECURITY DEFINER functions, tested directly as erp_app.
 * These are the paths that run before (or across) tenant context, so they get their own suite.
 */
describe('platform tables and definer functions (erp_app)', () => {
  let owner: Pool;
  let app: DatabaseHandle;
  const rid = () => `t-${newId()}`;
  const tag = newId().slice(-8);

  const createUser = async (email: string) =>
    withContext(app.db, { requestId: rid() }, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`select app.auth_create_user(${email}, 'Test User', 'hash') as id`,
      );
      return r.rows[0]!.id;
    });

  const provision = async (userId: string, slug: string) =>
    withContext(app.db, { userId, requestId: rid() }, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`select app.tenant_provision(${userId}, ${slug}, 'School', 'MAIN', 'Main', 'CBSE', 'Asia/Kolkata', 'req') as id`,
      );
      return r.rows[0]!.id;
    });

  let userA: string;
  let userB: string;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = createDatabase({ connectionString: APP_URL, max: 2 });
    userA = await createUser(`a-${tag}@example.test`);
    userB = await createUser(`b-${tag}@example.test`);
    tenantA = await provision(userA, `pa-${tag}`);
    tenantB = await provision(userB, `pb-${tag}`);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  const asUser = <T>(
    userId: string,
    tenantId: string | null,
    fn: (tx: Transaction) => Promise<T>,
  ) => withContext(app.db, { userId, tenantId, requestId: rid() }, fn);

  it('users: visible only to themselves and to members of the same school', async () => {
    const seen = await asUser(userA, tenantA, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`select id from users where id in (${userA}, ${userB})`,
      );
      return r.rows.map((x) => x.id);
    });
    expect(seen).toEqual([userA]);
    const anonymous = await withContext(
      app.db,
      { requestId: rid() },
      async (tx) => (await tx.execute(sql`select id from users`)).rows.length,
    );
    expect(anonymous).toBe(0);
  });

  it('users: secrets cannot be read, and other users cannot be updated', async () => {
    await expect(
      asUser(userA, tenantA, (tx) =>
        tx.execute(sql`select password_hash from users where id = ${userA}`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    const updated = await asUser(userA, tenantA, async (tx) => {
      const r = await tx.execute(sql`update users set full_name = 'Hijacked' where id = ${userB}`);
      return r.rowCount;
    });
    expect(updated).toBe(0);
    await expect(
      asUser(userA, tenantA, (tx) =>
        tx.execute(sql`update users set status = 'disabled' where id = ${userA}`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('tenants: only the current school is visible; none without context', async () => {
    const seen = await asUser(userA, tenantA, async (tx) =>
      (await tx.execute<{ id: string }>(sql`select id from tenants`)).rows.map((r) => r.id),
    );
    expect(seen).toEqual([tenantA]);
    await expect(
      asUser(userA, tenantA, (tx) =>
        tx.execute(sql`insert into tenants (slug, name) values ('rogue-${sql.raw(tag)}', 'Rogue')`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('function-only tables are unreadable', async () => {
    for (const table of [
      'auth_tokens',
      'platform_admins',
      'user_memberships_index',
      'outbox_pending_tenants',
    ]) {
      await expect(
        asUser(userA, tenantA, (tx) => tx.execute(sql`select * from ${sql.identifier(table)}`)),
      ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    }
  });

  it('definer functions refuse to act for anyone but the current user', async () => {
    await expect(
      asUser(userA, null, (tx) => tx.execute(sql`select * from app.user_tenants(${userB})`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      asUser(userA, null, (tx) => tx.execute(sql`select * from app.auth_user_secrets(${userB})`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      asUser(userA, null, (tx) =>
        tx.execute(
          sql`select app.tenant_provision(${userB}, ${`steal-${tag}`}, 'X', 'M', 'M', 'CBSE', 'Asia/Kolkata', 'r')`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('platform functions require a platform role', async () => {
    await expect(
      asUser(userA, null, (tx) =>
        tx.execute(sql`select * from app.platform_list_tenants(null, 10)`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      asUser(userA, null, (tx) =>
        tx.execute(
          sql`select app.platform_set_tenant_status(${tenantB}, 'suspended', 'no reason here', 'r')`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('provisioning restores the caller’s context and the tenant list comes from the index', async () => {
    const result = await asUser(userA, null, async (tx) => {
      const tenants = await tx.execute<{ tenant_id: string }>(
        sql`select tenant_id from app.user_tenants(${userA})`,
      );
      const ctx = await tx.execute<{ t: string | null }>(
        sql`select app.current_tenant_id()::text as t`,
      );
      return { tenants: tenants.rows.map((r) => r.tenant_id), ctx: ctx.rows[0]?.t ?? null };
    });
    expect(result.tenants).toEqual([tenantA]);
    expect(result.ctx).toBeNull();
  });

  it('sessions: a user sees and revokes only their own', async () => {
    const tokenHash = randomBytes(32);
    await withContext(app.db, { requestId: rid() }, async (tx) => {
      await tx.execute(sql`select app.session_create(${userB}, ${tokenHash}, ${Buffer.alloc(32, 2)},
        '1 hour'::interval, null, 'test', ${tenantB}, false)`);
    });
    const visible = await asUser(userA, null, async (tx) => {
      const r = await tx.execute(sql`select id from sessions`);
      const u = await tx.execute(sql`update sessions set revoked_at = now()`);
      return { rows: r.rows.length, updated: u.rowCount };
    });
    expect(visible).toEqual({ rows: 0, updated: 0 });
    const resolved = await withContext(
      app.db,
      { requestId: rid() },
      async (tx) =>
        (await tx.execute(sql`select * from app.session_resolve(${tokenHash}, '1 hour'::interval)`))
          .rows.length,
    );
    expect(resolved).toBe(1);
  });

  it('session_create ignores an active tenant the user does not belong to', async () => {
    const tokenHash = randomBytes(32);
    const active = await withContext(app.db, { requestId: rid() }, async (tx) => {
      await tx.execute(sql`select app.session_create(${userA}, ${tokenHash}, ${Buffer.alloc(32, 4)},
        '1 hour'::interval, null, 'test', ${tenantB}, false)`);
      const r = await tx.execute<{ active_tenant_id: string | null }>(
        sql`select active_tenant_id from app.session_resolve(${tokenHash}, '1 hour'::interval)`,
      );
      return r.rows[0]?.active_tenant_id;
    });
    expect(active).toBeNull();
  });

  it('outbox acknowledgement needs a tenant context and only touches that tenant', async () => {
    await withContext(
      app.db,
      { userId: userA, tenantId: tenantA, requestId: rid() },
      async (tx) => {
        await tx.execute(
          sql`insert into outbox_events (tenant_id, event_type, payload) values (${tenantA}, 'test', '{}')`,
        );
      },
    );
    await expect(
      withContext(app.db, { requestId: rid() }, (tx) => tx.execute(sql`select app.outbox_ack(1)`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    const pending = await withContext(app.db, { requestId: rid() }, async (tx) =>
      (await tx.execute<{ t: string }>(sql`select app.outbox_pending(100) as t`)).rows.map(
        (r) => r.t,
      ),
    );
    expect(pending).toContain(tenantA);
  });

  it('erp_app cannot create users or grant platform roles directly', async () => {
    await expect(
      withContext(app.db, { requestId: rid() }, (tx) =>
        tx.execute(
          sql`insert into users (email, full_name) values (${`x-${tag}@example.test`}, 'X')`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      asUser(userA, null, (tx) =>
        tx.execute(
          sql`insert into platform_admins (user_id, role) values (${userA}, 'super_admin')`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('owner-only maintenance functions are not callable by the app', async () => {
    await expect(
      withContext(app.db, { requestId: rid() }, (tx) =>
        tx.execute(sql`select app.sync_system_role_permissions()`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      withContext(app.db, { requestId: rid() }, async (tx) => {
        await setContext(tx, { requestId: rid() });
        return tx.execute(sql`select app.enable_tenant_rls('users')`);
      }),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });
});
