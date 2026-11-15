import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client.js';
import type { DatabaseHandle } from '../src/client.js';
import { withTenant } from '../src/tenant.js';
import { APP_URL, PG, createTestTenant, isPgError, prepareDatabase } from '../src/testing.js';

/**
 * Phase 3a database guarantees that do not depend on API code: campus consistency of
 * sections, one current year per campus, and immutable ownership columns.
 */
describe('academic structure constraints (erp_app)', () => {
  let app: DatabaseHandle;
  let tenantId: string;
  let userId: string;
  const ids: Record<string, string> = {};

  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { tenantId, userId, requestId: 'test' }, fn);

  const one = async (q: ReturnType<typeof sql>) =>
    run(async (tx) => (await tx.execute<{ id: string }>(q)).rows[0]!.id);

  beforeAll(async () => {
    const owner = await prepareDatabase();
    await owner.end();
    app = createDatabase({ connectionString: APP_URL, max: 1 });
    ({ tenantId, userId } = await createTestTenant(app.db, 'acad'));
    ids.campus1 = await one(sql`select id from campuses limit 1`);
    ids.campus2 = await one(
      sql`insert into campuses (tenant_id, code, name, board) values (${tenantId}, 'TWO', 'Two', 'CBSE') returning id`,
    );
    ids.year1 = await one(
      sql`insert into academic_years (tenant_id, campus_id, name, starts_on, ends_on)
          values (${tenantId}, ${ids.campus1}, '2026-27', '2026-04-01', '2027-03-31') returning id`,
    );
    ids.class2 = await one(
      sql`insert into grade_levels (tenant_id, campus_id, code, name, stage)
          values (${tenantId}, ${ids.campus2}, '1', 'Class 1', 'primary') returning id`,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a section cannot join a year of one campus with a class of another', async () => {
    for (const campus of [ids.campus1, ids.campus2]) {
      await expect(
        run((tx) =>
          tx.execute(sql`insert into sections (tenant_id, campus_id, academic_year_id, grade_level_id, name)
                         values (${tenantId}, ${campus}, ${ids.year1}, ${ids.class2}, 'A')`),
        ),
      ).rejects.toSatisfy(isPgError(PG.FOREIGN_KEY_VIOLATION));
    }
  });

  it('allows only one current year per campus', async () => {
    const second = await one(
      sql`insert into academic_years (tenant_id, campus_id, name, starts_on, ends_on)
          values (${tenantId}, ${ids.campus1}, '2027-28', '2027-04-01', '2028-03-31') returning id`,
    );
    await run((tx) =>
      tx.execute(sql`update academic_years set is_current = true where id = ${ids.year1}`),
    );
    await expect(
      run((tx) =>
        tx.execute(sql`update academic_years set is_current = true where id = ${second}`),
      ),
    ).rejects.toSatisfy(isPgError('23505'));
  });

  it('the application cannot move rows to another campus or year', async () => {
    await expect(
      run((tx) =>
        tx.execute(
          sql`update academic_years set campus_id = ${ids.campus2} where id = ${ids.year1}`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      run((tx) =>
        tx.execute(
          sql`update grade_levels set campus_id = ${ids.campus1} where id = ${ids.class2}`,
        ),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('rejects impossible dates and band ranges', async () => {
    await expect(
      run((tx) =>
        tx.execute(sql`insert into academic_years (tenant_id, campus_id, name, starts_on, ends_on)
                       values (${tenantId}, ${ids.campus2}, 'Bad', '2026-04-01', '2026-03-01')`),
      ),
    ).rejects.toSatisfy(isPgError('23514'));
    const scale = await one(
      sql`insert into grading_scales (tenant_id, name) values (${tenantId}, 'S') returning id`,
    );
    await expect(
      run((tx) =>
        tx.execute(sql`insert into grading_bands (tenant_id, scale_id, label, min_percent, max_percent)
                       values (${tenantId}, ${scale}, 'X', 80, 120)`),
      ),
    ).rejects.toSatisfy(isPgError('23514'));
  });
});
