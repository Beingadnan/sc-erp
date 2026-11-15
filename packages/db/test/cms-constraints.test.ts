import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client.js';
import type { DatabaseHandle } from '../src/client.js';
import { withContext, withTenant } from '../src/tenant.js';
import { APP_URL, PG, createTestTenant, isPgError, prepareDatabase } from '../src/testing.js';

/** Phase 3b guarantees enforced by the database itself. */
describe('website and inquiry constraints (erp_app)', () => {
  let app: DatabaseHandle;
  let tenantId: string;
  let userId: string;
  let slug: string;
  let pageId: string;

  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { tenantId, userId, requestId: 'test' }, fn);

  beforeAll(async () => {
    const owner = await prepareDatabase();
    await owner.end();
    app = createDatabase({ connectionString: APP_URL, max: 1 });
    ({ tenantId, userId } = await createTestTenant(app.db, 'cms'));
    slug = await run(
      async (tx) =>
        (await tx.execute<{ slug: string }>(sql`select slug from tenants`)).rows[0]!.slug,
    );
    pageId = await run(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into cms_pages (tenant_id, slug, title) values (${tenantId}, 'home', 'Home') returning id`,
      );
      await tx.execute(
        sql`insert into cms_page_versions (tenant_id, page_id, version, title, body)
            values (${tenantId}, ${r.rows[0]!.id}, 1, 'Home', 'Hello')`,
      );
      return r.rows[0]!.id;
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('page history cannot be edited or deleted by the application', async () => {
    await expect(
      run((tx) =>
        tx.execute(sql`update cms_page_versions set body = 'rewritten' where page_id = ${pageId}`),
      ),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(
      run((tx) => tx.execute(sql`delete from cms_page_versions where page_id = ${pageId}`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
  });

  it('anonymous visitors only see published pages', async () => {
    const anon = <T>(q: ReturnType<typeof sql>) =>
      withContext(
        app.db,
        { requestId: 'anon' },
        async (tx) => (await tx.execute<{ r: T }>(q)).rows[0]!.r,
      );
    expect(await anon(sql`select app.public_page(${slug}, 'home') as r`)).toBeNull();
    // Without a tenant context the tables themselves are invisible.
    expect(await anon(sql`select count(*)::int as r from cms_pages`)).toBe(0);
    await run((tx) =>
      tx.execute(sql`update cms_pages set published_version_id =
        (select id from cms_page_versions where page_id = ${pageId}) where id = ${pageId}`),
    );
    expect(await anon(sql`select app.public_page(${slug}, 'home') as r`)).toMatchObject({
      body: 'Hello',
    });
  });

  it('inquiries keep what the parent submitted: only the status can change', async () => {
    const ok = await withContext(
      app.db,
      { requestId: 'anon' },
      async (tx) =>
        (
          await tx.execute<{ ok: boolean }>(
            sql`select app.public_inquiry_create(${slug}, null, 'Parent', '+919829012345', null, null, null, '') as ok`,
          )
        ).rows[0]!.ok,
    );
    expect(ok).toBe(true);
    await expect(
      run((tx) => tx.execute(sql`update admission_inquiries set phone = '+919999999999'`)),
    ).rejects.toSatisfy(isPgError(PG.RLS_VIOLATION));
    await expect(run((tx) => tx.execute(sql`delete from admission_inquiries`))).rejects.toSatisfy(
      isPgError(PG.RLS_VIOLATION),
    );
    await run((tx) => tx.execute(sql`update admission_inquiries set status = 'contacted'`));
  });
});
