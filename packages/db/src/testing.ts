/**
 * Test utilities shared by packages that need a real database (db, api, worker).
 * Imported as '@school-erp/db/testing'. Never import from application code.
 */
import { Pool } from 'pg';
import { newId } from '@school-erp/shared';
import type { TenantContext } from '@school-erp/shared';
import { sql } from 'drizzle-orm';
import { runMigrations, setupAppRole } from './admin.js';
import type { Database } from './client.js';
import { withContext } from './tenant.js';

/**
 * Test databases:
 *  - TEST_DATABASE_URL_OWNER: owner role, direct connection (migrations, fixtures)
 *  - TEST_DATABASE_URL_APP:   erp_app role (pooled on Neon), what the application uses
 * Defaults target the docker-compose Postgres.
 */
export const OWNER_URL =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgresql://erp_owner:erp_owner@localhost:5432/school_erp_test';
export const APP_URL =
  process.env.TEST_DATABASE_URL_APP ??
  'postgresql://erp_app:erp_app_test_password_123@localhost:5432/school_erp_test';
const APP_PASSWORD = process.env.TEST_ERP_APP_PASSWORD ?? 'erp_app_test_password_123';

export const TENANT_A = newId();
export const TENANT_B = newId();

export const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: null,
  requestId: `test-${newId()}`,
});

/** Migrates, enables erp_app login, and creates probe tables that mimic real tenant tables. */
export const prepareDatabase = async (): Promise<Pool> => {
  await runMigrations(OWNER_URL);
  await setupAppRole(OWNER_URL, APP_PASSWORD);
  const owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await owner.query(`
    drop table if exists test_probe_child;
    drop table if exists test_probe_parent;
    create table test_probe_parent (
      id uuid primary key default app.uuid_v7(),
      tenant_id uuid not null,
      name text not null,
      unique (tenant_id, id)
    );
    create table test_probe_child (
      id uuid primary key default app.uuid_v7(),
      tenant_id uuid not null,
      parent_id uuid not null,
      note text,
      foreign key (tenant_id, parent_id) references test_probe_parent (tenant_id, id)
    );
    select app.enable_tenant_rls('test_probe_parent');
    select app.enable_tenant_rls('test_probe_child');
  `);
  return owner;
};

export const dropProbeTables = async (owner: Pool): Promise<void> => {
  await owner.query(
    `drop table if exists test_probe_child; drop table if exists test_probe_parent;`,
  );
};

/** Postgres SQLSTATE codes asserted by the security tests. */
export const PG = {
  /** SQLSTATE 42501 insufficient_privilege: RLS violations and missing grants alike. */
  RLS_VIOLATION: '42501',
  FOREIGN_KEY_VIOLATION: '23503',
  READ_ONLY_TRANSACTION: '25006',
} as const;

/** Drizzle wraps driver errors; match on the underlying Postgres SQLSTATE. */
export const isPgError =
  (code: string) =>
  (err: unknown): boolean => {
    let e: unknown = err;
    for (let i = 0; i < 5 && e; i++) {
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === code)
        return true;
      e = (e as { cause?: unknown }).cause;
    }
    return false;
  };

/** Owner-role pool for fixtures and assertions in tests (bypasses nothing: FORCE RLS still applies to tenant tables). */
export const openOwnerPool = (): Pool => new Pool({ connectionString: OWNER_URL, max: 2 });

/** Application-role pool for asserting what erp_app can and cannot do. */
export const openAppPool = (): Pool => new Pool({ connectionString: APP_URL, max: 1 });

/**
 * Creates a user and a provisioned school through the same definer functions the API uses.
 * Returns ids only; for tests that need tenants without going through HTTP.
 */
export const createTestTenant = async (
  db: Database,
  label: string,
): Promise<{ userId: string; tenantId: string }> => {
  const tag = `${label}-${newId().slice(-10)}`.toLowerCase();
  const userId = await withContext(db, { requestId: `fixture-${tag}` }, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      sql`select app.auth_create_user(${`${tag}@example.test`}, 'Fixture User', null) as id`,
    );
    return r.rows[0]!.id;
  });
  const tenantId = await withContext(db, { userId, requestId: `fixture-${tag}` }, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      sql`select app.tenant_provision(${userId}, ${tag}, 'Fixture School', 'MAIN', 'Main', 'CBSE', 'Asia/Kolkata', 'fixture') as id`,
    );
    return r.rows[0]!.id;
  });
  return { userId, tenantId };
};
