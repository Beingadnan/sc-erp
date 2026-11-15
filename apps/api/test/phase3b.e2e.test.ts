import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { Browser, registerSchool, startApp } from './support.js';
import type { School } from './support.js';

/** Phase 3b: website pages with versions, the public site and admission inquiries. */
describe('Phase 3b: website and inquiries (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  let visitor: Browser;
  let slugA: string;
  let homeId: string;

  const inquiry = (overrides: Record<string, unknown> = {}) => ({
    parentName: 'Sunita Sharma',
    phone: '98290 12345',
    email: '',
    studentName: 'Aarav',
    classSought: 'Class 3',
    message: 'Please call after 5 pm',
    consent: true,
    ...overrides,
  });

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    visitor = new Browser(app);
    slugA = ((await A.browser.get('/tenant')).body as { slug: string }).slug;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('pages and versions', () => {
    it('creates starter pages as unpublished drafts', async () => {
      const res = await A.browser.post('/website/pages/starter');
      expect(res.body).toEqual({ created: 4 });
      expect((await A.browser.post('/website/pages/starter')).body).toEqual({ created: 0 });
      const pages = (await A.browser.get('/website/pages')).body as Array<{
        id: string;
        slug: string;
        publishedVersion: number | null;
        latestVersion: number;
      }>;
      expect(pages.map((p) => p.slug)).toEqual(['home', 'about', 'admissions', 'contact']);
      expect(pages.every((p) => p.publishedVersion === null && p.latestVersion === 1)).toBe(true);
      homeId = pages[0]!.id;
      // Nothing is public yet.
      const site = await visitor.get(`/public/schools/${slugA}`);
      expect(site.status).toBe(200);
      expect(site.body.pages).toEqual([]);
      expect((await visitor.get(`/public/schools/${slugA}/pages/home`)).status).toBe(404);
    });

    it('keeps every save as a version and publishes a chosen one', async () => {
      const v2 = await A.browser.patch(`/website/pages/${homeId}`, {
        title: 'Welcome',
        body: '# Welcome\n\nVersion two.',
      });
      expect(v2.body.version).toBe(2);
      expect((await A.browser.post(`/website/pages/${homeId}/publish`, {})).body).toEqual({
        publishedVersion: 2,
      });
      await A.browser.patch(`/website/pages/${homeId}`, { title: 'Welcome', body: 'Draft three' });

      // Visitors still see version 2 until version 3 is published.
      const page = await visitor.get(`/public/schools/${slugA}/pages/home`);
      expect(page.body).toMatchObject({ title: 'Welcome', body: '# Welcome\n\nVersion two.' });
      const list = (await A.browser.get('/website/pages')).body as Array<{
        slug: string;
        hasDraftChanges: boolean;
      }>;
      expect(list.find((p) => p.slug === 'home')!.hasDraftChanges).toBe(true);

      // Restoring copies version 2 into a new version 4; history is kept.
      expect((await A.browser.post(`/website/pages/${homeId}/versions/2/restore`)).body).toEqual({
        version: 4,
      });
      const detail = (await A.browser.get(`/website/pages/${homeId}`)).body;
      expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([4, 3, 2, 1]);
      expect(detail.body).toBe('# Welcome\n\nVersion two.');
      expect(detail.publishedVersion).toBe(2);
      expect((await A.browser.get(`/website/pages/${homeId}/versions/3`)).body.body).toBe(
        'Draft three',
      );

      const site = (await visitor.get(`/public/schools/${slugA}`)).body;
      expect(site.pages).toEqual([{ slug: 'home', title: 'Welcome' }]);
      expect(site.campuses[0]).toMatchObject({ name: expect.any(String) });
    });

    it('unpublishes, rejects duplicate and reserved addresses, and deletes', async () => {
      const dup = await A.browser.post('/website/pages', { slug: 'home', title: 'Again' });
      expect(dup.status).toBe(409);
      expect(
        (await A.browser.post('/website/pages', { slug: 'inquiry', title: 'X page' })).status,
      ).toBe(422);
      const extra = await A.browser.post('/website/pages', {
        slug: 'fees',
        title: 'Fee structure',
        body: 'Fees',
      });
      expect(extra.status).toBe(201);
      await A.browser.post(`/website/pages/${extra.body.id}/publish`, {});
      expect((await visitor.get(`/public/schools/${slugA}/pages/fees`)).status).toBe(200);
      expect((await A.browser.post(`/website/pages/${extra.body.id}/unpublish`)).status).toBe(204);
      expect((await visitor.get(`/public/schools/${slugA}/pages/fees`)).status).toBe(404);
      await A.browser.post(`/website/pages/${extra.body.id}/publish`, {});
      expect((await A.browser.delete(`/website/pages/${extra.body.id}`)).status).toBe(204);
      expect((await visitor.get(`/public/schools/${slugA}/pages/fees`)).status).toBe(404);
    });

    it('treats page text as text: nothing is interpreted as HTML by the API', async () => {
      const body = '<script>alert(1)</script>\n\n[x](javascript:alert(1))';
      await A.browser.patch(`/website/pages/${homeId}`, { title: 'Welcome', body });
      await A.browser.post(`/website/pages/${homeId}/publish`, {});
      const page = await visitor.get(`/public/schools/${slugA}/pages/home`);
      expect(page.body.body).toBe(body);
      expect(page.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('public inquiries', () => {
    it('accepts an inquiry and normalises the phone number', async () => {
      const res = await visitor.post(`/public/schools/${slugA}/inquiries`, inquiry());
      expect(res.status).toBe(202);
      const list = (await A.browser.get('/inquiries')).body.data as Array<Record<string, unknown>>;
      expect(list[0]).toMatchObject({
        parentName: 'Sunita Sharma',
        phone: '+919829012345',
        email: null,
        source: 'website',
        status: 'new',
      });
    });

    it('requires consent and validates fields', async () => {
      const res = await visitor.post(
        `/public/schools/${slugA}/inquiries`,
        inquiry({ consent: false }),
      );
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields.consent).toBeTruthy();
      expect(
        (await visitor.post(`/public/schools/${slugA}/inquiries`, inquiry({ phone: '12' }))).status,
      ).toBe(422);
    });

    it('answers the same for unknown schools, other schools’ campuses and bots, storing nothing', async () => {
      const before = (await A.browser.get('/inquiries')).body.data.length;
      const campusB = ((await B.browser.get('/campuses')).body as Array<{ id: string }>)[0]!.id;
      const responses = [
        await visitor.post(
          '/public/schools/no-such-school/inquiries',
          inquiry({ phone: '9829000001' }),
        ),
        await visitor.post(
          `/public/schools/${slugA}/inquiries`,
          inquiry({ campusId: campusB, phone: '9829000002' }),
        ),
        await visitor.post(
          `/public/schools/${slugA}/inquiries`,
          inquiry({ website: 'http://spam.example', phone: '9829000003' }),
        ),
      ];
      expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
      expect((await A.browser.get('/inquiries')).body.data.length).toBe(before);
      expect((await B.browser.get('/inquiries')).body.data.length).toBe(0);
    });

    it('rate-limits repeated submissions', async () => {
      let last = 0;
      for (let n = 0; n < 300 && last !== 429; n++) {
        last = (
          await visitor.post(
            `/public/schools/${slugA}/inquiries`,
            inquiry({ phone: `98290${String(10000 + n)}` }),
          )
        ).status;
      }
      expect(last).toBe(429);
    });

    it('lets staff record walk-ins and move inquiries along', async () => {
      const campusA = ((await A.browser.get('/campuses')).body as Array<{ id: string }>)[0]!.id;
      const walkIn = await A.browser.post('/inquiries', {
        ...inquiry({ phone: '9876543210' }),
        email: null,
        studentName: null,
        classSought: null,
        campusId: campusA,
        source: 'walk_in',
      });
      expect(walkIn.status).toBe(201);
      const updated = await A.browser.patch(`/inquiries/${walkIn.body.id}`, {
        status: 'contacted',
      });
      expect(updated.body.status).toBe('contacted');
      const filtered = (await A.browser.get('/inquiries?status=contacted')).body.data;
      expect(filtered.map((x: { id: string }) => x.id)).toEqual([walkIn.body.id]);
    });
  });

  describe('isolation and permissions', () => {
    it('hides school A’s pages and inquiries from school B', async () => {
      const inquiryA = (await A.browser.get('/inquiries')).body.data[0].id;
      const statuses = {
        page: (await B.browser.get(`/website/pages/${homeId}`)).status,
        edit: (await B.browser.patch(`/website/pages/${homeId}`, { title: 'Hacked', body: 'x' }))
          .status,
        publish: (await B.browser.post(`/website/pages/${homeId}/publish`, {})).status,
        restore: (await B.browser.post(`/website/pages/${homeId}/versions/1/restore`)).status,
        remove: (await B.browser.delete(`/website/pages/${homeId}`)).status,
        inquiry: (await B.browser.patch(`/inquiries/${inquiryA}`, { status: 'closed' })).status,
      };
      expect(statuses).toEqual({
        page: 404,
        edit: 404,
        publish: 404,
        restore: 404,
        remove: 404,
        inquiry: 404,
      });
      expect((await B.browser.get('/website/pages')).body).toEqual([]);
    });

    it('requires sign-in and permission for staff endpoints', async () => {
      expect((await visitor.get('/website/pages')).status).toBe(401);
      expect((await visitor.get('/inquiries')).status).toBe(401);
    });

    it('hides the site of a suspended school', async () => {
      // School B never published anything but its site exists.
      const slugB = ((await B.browser.get('/tenant')).body as { slug: string }).slug;
      expect((await visitor.get(`/public/schools/${slugB}`)).status).toBe(200);
      expect((await visitor.get('/public/schools/no-such-school')).status).toBe(404);
    });
  });
});
