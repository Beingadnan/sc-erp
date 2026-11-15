import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client.js';
import type { DatabaseHandle } from '../src/client.js';
import { withTenant } from '../src/tenant.js';
import { APP_URL, PG, createTestTenant, isPgError, prepareDatabase } from '../src/testing.js';

/** Phase 4a guarantees enforced by the database itself. */
describe('student constraints (erp_app)', () => {
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
    ({ tenantId, userId } = await createTestTenant(app.db, 'stu'));
    ids.campus1 = await one(sql`select id from campuses limit 1`);
    ids.campus2 = await one(
      sql`insert into campuses (tenant_id, code, name, board) values (${tenantId}, 'TWO', 'Two', 'CBSE') returning id`,
    );
    for (const c of ['1', '2'] as const) {
      const campus = ids[`campus${c}`]!;
      ids[`year${c}`] =
        await one(sql`insert into academic_years (tenant_id, campus_id, name, starts_on, ends_on)
        values (${tenantId}, ${campus}, '2026-27', '2026-04-01', '2027-03-31') returning id`);
      ids[`class${c}`] =
        await one(sql`insert into grade_levels (tenant_id, campus_id, code, name, stage)
        values (${tenantId}, ${campus}, '1', 'Class 1', 'primary') returning id`);
      ids[`section${c}`] =
        await one(sql`insert into sections (tenant_id, campus_id, academic_year_id, grade_level_id, name)
        values (${tenantId}, ${campus}, ${ids[`year${c}`]}, ${ids[`class${c}`]}, 'A') returning id`);
    }
    ids.student =
      await one(sql`insert into students (tenant_id, campus_id, admission_number, admission_date,
        first_name, date_of_birth, gender)
      values (${tenantId}, ${ids.campus1}, '0001', '2026-04-01', 'Asha', '2019-01-01', 'female') returning id`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('an enrollment must use a section of its own campus and year', async () => {
    await expect(
      run((tx) =>
        tx.execute(sql`insert into student_enrollments (tenant_id, student_id, campus_id, academic_year_id, section_id, enrolled_on)
          values (${tenantId}, ${ids.student}, ${ids.campus1}, ${ids.year1}, ${ids.section2}, '2026-04-01')`),
      ),
    ).rejects.toSatisfy(isPgError(PG.FOREIGN_KEY_VIOLATION));
    await run((tx) =>
      tx.execute(sql`insert into student_enrollments (tenant_id, student_id, campus_id, academic_year_id, section_id, enrolled_on)
        values (${tenantId}, ${ids.student}, ${ids.campus1}, ${ids.year1}, ${ids.section1}, '2026-04-01')`),
    );
  });

  it('students cannot be deleted, renumbered or moved by the application', async () => {
    await expect(
      run((tx) => tx.execute(sql`delete from students where id = ${ids.student}`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      run((tx) =>
        tx.execute(sql`update students set admission_number = '9999' where id = ${ids.student}`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      run((tx) =>
        tx.execute(sql`update students set campus_id = ${ids.campus2} where id = ${ids.student}`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('Aadhaar columns are all set or all empty, and never a bare number', async () => {
    await expect(
      run((tx) =>
        tx.execute(sql`update students set aadhaar_last4 = '1234' where id = ${ids.student}`),
      ),
    ).rejects.toSatisfy(isPgError('23514'));
  });

  it('counters only move forward and consent records cannot be changed', async () => {
    await run((tx) =>
      tx.execute(
        sql`insert into number_counters (tenant_id, counter_key, last_value) values (${tenantId}, 'admission', 5)`,
      ),
    );
    await expect(
      run((tx) =>
        tx.execute(sql`update number_counters set last_value = 2 where counter_key = 'admission'`),
      ),
    ).rejects.toSatisfy(isPgError('23514'));
    const guardian = await one(sql`insert into guardians (tenant_id, full_name, phone)
      values (${tenantId}, 'Parent', '+919829012345') returning id`);
    await run((tx) =>
      tx.execute(sql`insert into privacy_acknowledgements (tenant_id, guardian_id, student_id, notice_version, channel)
        values (${tenantId}, ${guardian}, ${ids.student}, '1.0', 'in_person')`),
    );
    await expect(
      run((tx) => tx.execute(sql`update privacy_acknowledgements set notice_version = '0.9'`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      run((tx) => tx.execute(sql`delete from privacy_acknowledgements`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });
});
