import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { assertAppRoleIsSafe } from '../src/tenant.js';

const fakePool = (row: { role: string; rolsuper: boolean; rolbypassrls: boolean }): Pool =>
  ({ query: async () => ({ rows: [row] }) }) as unknown as Pool;

describe('assertAppRoleIsSafe', () => {
  it('refuses to start with a BYPASSRLS role (e.g. a Neon console role)', async () => {
    await expect(
      assertAppRoleIsSafe(fakePool({ role: 'neondb_owner', rolsuper: false, rolbypassrls: true })),
    ).rejects.toThrow(/bypass Row-Level Security/);
  });

  it('refuses to start as a superuser', async () => {
    await expect(
      assertAppRoleIsSafe(fakePool({ role: 'postgres', rolsuper: true, rolbypassrls: false })),
    ).rejects.toThrow(/bypass Row-Level Security/);
  });

  it('accepts a normal role', async () => {
    await expect(
      assertAppRoleIsSafe(fakePool({ role: 'erp_app', rolsuper: false, rolbypassrls: false })),
    ).resolves.toBeUndefined();
  });
});
