import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GLOBAL_TABLES } from '../src/global-tables.js';
import { findRlsViolations } from '../src/rls-check.js';
import { dropProbeTables, prepareDatabase } from './helpers.js';

describe('RLS coverage checker', () => {
  let owner: Pool;

  beforeAll(async () => {
    owner = await prepareDatabase();
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query(`drop table if exists test_bad_child, test_bad_no_rls, test_unclassified`);
    await dropProbeTables(owner);
    await owner.end();
  });

  it('passes for correctly protected tenant tables', async () => {
    expect(await findRlsViolations(owner)).toEqual([]);
  });

  it('flags a tenant table without RLS, without FORCE and without a policy', async () => {
    await owner.query(
      `create table test_bad_no_rls (id uuid primary key, tenant_id uuid not null)`,
    );
    const kinds = (await findRlsViolations(owner))
      .filter((v) => v.table === 'test_bad_no_rls')
      .map((v) => v.kind)
      .sort();
    expect(kinds).toEqual(['MISSING_TENANT_POLICY', 'RLS_NOT_ENABLED', 'RLS_NOT_FORCED']);
    await owner.query(`drop table test_bad_no_rls`);
  });

  it('flags catalogue tables the app role can write to', async () => {
    await owner.query(`grant insert on permissions to erp_app`);
    try {
      const v = await findRlsViolations(owner);
      expect(v).toContainEqual(
        expect.objectContaining({ kind: 'CATALOGUE_WRITABLE_BY_APP', table: 'permissions' }),
      );
    } finally {
      await owner.query(`revoke insert on permissions from erp_app`);
    }
  });

  it('flags RLS enabled but not forced', async () => {
    await owner.query(`
      create table test_bad_no_rls (id uuid primary key, tenant_id uuid not null);
      select app.enable_tenant_rls('test_bad_no_rls');
      alter table test_bad_no_rls no force row level security;`);
    const kinds = (await findRlsViolations(owner))
      .filter((v) => v.table === 'test_bad_no_rls')
      .map((v) => v.kind);
    expect(kinds).toEqual(['RLS_NOT_FORCED']);
    await owner.query(`drop table test_bad_no_rls`);
  });

  it('flags tables without tenant_id that are not declared global', async () => {
    await owner.query(`create table test_unclassified (id int primary key)`);
    const v = await findRlsViolations(owner);
    expect(v).toContainEqual(
      expect.objectContaining({ kind: 'UNCLASSIFIED_TABLE', table: 'test_unclassified' }),
    );
    const declared = { ...GLOBAL_TABLES, test_unclassified: { reason: 'test' } };
    expect(
      (await findRlsViolations(owner, { globalTables: declared })).filter(
        (x) => x.table === 'test_unclassified',
      ),
    ).toEqual([expect.objectContaining({ kind: 'GLOBAL_TABLE_WITHOUT_RLS' })]);
    await owner.query(`alter table test_unclassified enable row level security`);
    expect(await findRlsViolations(owner, { globalTables: declared })).toEqual([]);
    await owner.query(`drop table test_unclassified`);
  });

  it('flags foreign keys between tenant tables that skip tenant_id', async () => {
    await owner.query(`
      create table test_bad_child (
        id uuid primary key, tenant_id uuid not null,
        parent_id uuid references test_probe_parent (id));
      select app.enable_tenant_rls('test_bad_child');`);
    const v = await findRlsViolations(owner);
    expect(v).toContainEqual(
      expect.objectContaining({ kind: 'FK_WITHOUT_TENANT_ID', table: 'test_bad_child' }),
    );
    await owner.query(`drop table test_bad_child`);
  });
});
