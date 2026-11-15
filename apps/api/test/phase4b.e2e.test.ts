import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const HTML_AS_PDF = Buffer.from('<html><script>alert(1)</script></html>');

/** Phase 4b: applications workflow, admission from an application, documents. */
describe('Phase 4b: applications and documents (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  let year: Row;
  let class1: Row;
  let class2: Row;
  let secA: Row;
  let application: Row;

  const ack = { acknowledged: true, version: '1.0', channel: 'in_person' };
  const apply = (s: School, extra: Record<string, unknown> = {}) =>
    s.browser.post('/applications', {
      campusId: s.campusId,
      academicYearId: year.id,
      gradeLevelId: class1.id,
      firstName: 'Meera',
      lastName: 'Joshi',
      dateOfBirth: '2020-02-02',
      gender: 'female',
      guardianName: 'Kavita Joshi',
      guardianPhone: '9414012345',
      guardianRelationship: 'mother',
      ...extra,
    });

  const roleId = async (s: School, key: string) =>
    ((await s.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === key,
    )!.id;

  const staff = async (s: School, roleKey: string) => {
    const email = `${unique('staff')}@example.test`;
    await s.browser.post('/members/invite', {
      email,
      fullName: 'Staff Member',
      assignments: [{ roleId: await roleId(s, roleKey), campusId: null }],
    });
    const browser = new Browser(app);
    await browser.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
    return browser;
  };

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    year = (
      await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: '2026-27',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
      })
    ).body;
    class1 = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: 'UKG',
        name: 'UKG',
        stage: 'pre_primary',
      })
    ).body;
    class2 = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: '1',
        name: 'Class 1',
        stage: 'primary',
      })
    ).body;
    secA = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: class1.id,
        name: 'A',
      })
    ).body;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('applications', () => {
    it('creates an application from an inquiry with a numbered reference', async () => {
      const { slug } = (await A.browser.get('/tenant')).body as { slug: string };
      await new Browser(app).post(`/public/schools/${slug}/inquiries`, {
        parentName: 'Kavita Joshi',
        phone: '9414012345',
        classSought: 'UKG',
        consent: true,
      });
      const inquiry = (await A.browser.get('/inquiries')).body.data[0] as Row;
      const res = await apply(A, { inquiryId: inquiry.id });
      expect(res.status).toBe(201);
      expect(res.body.applicationNumber).toBe('APP/2026/0001');
      application = res.body;
      const detail = (await A.browser.get(`/applications/${res.body.id}`)).body;
      expect(detail).toMatchObject({
        status: 'submitted',
        source: 'website',
        className: 'UKG',
        yearName: '2026-27',
      });
      expect(detail.events.map((e: Row) => e.toStatus)).toEqual(['submitted']);
      expect(detail.nextStatuses).toEqual(['under_review', 'rejected', 'withdrawn']);
      // The inquiry moved on.
      expect(((await A.browser.get('/inquiries')).body.data[0] as Row).status).toBe('contacted');
      expect((await apply(A)).body.applicationNumber).toBe('APP/2026/0002');
    });

    it('follows the workflow and refuses invalid moves', async () => {
      const id = application.id;
      const skip = await A.browser.post(`/applications/${id}/status`, { status: 'approved' });
      expect(skip.status).toBe(409);
      expect(skip.body.error.details.reason).toBe('invalid_transition');
      expect(
        (await A.browser.post(`/applications/${id}/status`, { status: 'under_review' })).status,
      ).toBe(200);
      expect(
        (await A.browser.post(`/applications/${id}/status`, { status: 'assessment' })).status,
      ).toBe(422);
      expect(
        (
          await A.browser.post(`/applications/${id}/status`, {
            status: 'assessment',
            assessmentAt: '2026-11-20T10:00:00+05:30',
            note: 'Interaction with parents',
          })
        ).status,
      ).toBe(200);
      expect(
        (await A.browser.post(`/applications/${id}/status`, { status: 'waitlisted' })).status,
      ).toBe(422); // needs a reason
      expect(
        (
          await A.browser.post(`/applications/${id}/status`, {
            status: 'waitlisted',
            note: 'UKG A is full',
          })
        ).status,
      ).toBe(200);
      // Admitting before approval is refused.
      const early = await A.browser.post(`/applications/${id}/admit`, {
        sectionId: secA.id,
        privacyNotice: ack,
      });
      expect(early.body.error.details.reason).toBe('not_approved');
      expect(
        (await A.browser.post(`/applications/${id}/status`, { status: 'approved' })).status,
      ).toBe(200);
      const detail = (await A.browser.get(`/applications/${id}`)).body;
      expect(detail.events.map((e: Row) => e.toStatus)).toEqual([
        'submitted',
        'under_review',
        'assessment',
        'waitlisted',
        'approved',
      ]);
      expect(detail.events[3].note).toBe('UKG A is full');
    });

    it('lists, searches and summarises applications', async () => {
      const list = (await A.browser.get('/applications?q=kavita')).body.data as Row[];
      expect(list).toHaveLength(2);
      expect((await A.browser.get('/applications?status=approved')).body.data).toHaveLength(1);
      const summary = (
        await A.browser.get(
          `/applications/summary?campusId=${A.campusId}&academicYearId=${year.id}`,
        )
      ).body;
      expect(summary.byStatus).toEqual({ approved: 1, submitted: 1 });
      expect(summary.bySource).toEqual({ website: 1, walk_in: 1 });
      expect(summary.byClass).toEqual([
        { gradeLevelId: class1.id, className: 'UKG', total: 2, admitted: 0, pending: 2 },
      ]);
    });
  });

  describe('documents', () => {
    let docId: string;

    it('stores a PDF for an application and returns a short-lived link', async () => {
      const res = await A.browser.upload(
        '/documents',
        { applicationId: application.id, docType: 'birth_certificate' },
        { name: 'Birth Certificate (Meera).PDF', bytes: PDF },
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        fileName: 'Birth-Certificate-Meera.pdf',
        contentType: 'application/pdf',
      });
      docId = res.body.id;
      const list = (await A.browser.get(`/applications/${application.id}/documents`)).body as Row[];
      expect(list.map((d) => d.docType)).toEqual(['birth_certificate']);

      const link = await A.browser.post(`/documents/${docId}/link`);
      expect(link.status).toBe(200);
      const url = new URL(link.body.url, 'http://localhost');
      const file = await request(app.getHttpServer()).get(url.pathname + url.search);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(file.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.from(file.body as Buffer).equals(PDF)).toBe(true);
      // Tampered or expired links do not work.
      const tampered = url.search.replace(/sig=[^&]+/, 'sig=AAAA');
      expect((await request(app.getHttpServer()).get(url.pathname + tampered)).status).toBe(404);
      const expired = url.search.replace(/exp=\d+/, 'exp=1000');
      expect((await request(app.getHttpServer()).get(url.pathname + expired)).status).toBe(404);
    });

    it('checks the real file type and size', async () => {
      const fake = await A.browser.upload(
        '/documents',
        { applicationId: application.id, docType: 'report_card' },
        { name: 'report.pdf', bytes: HTML_AS_PDF },
      );
      expect(fake.status).toBe(422);
      const big = await A.browser.upload(
        '/documents',
        { applicationId: application.id, docType: 'report_card' },
        { name: 'big.pdf', bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) },
      );
      expect([413, 422]).toContain(big.status);
      const none = await A.browser.upload(
        '/documents',
        { applicationId: application.id, docType: 'photo' },
        null,
      );
      expect(none.status).toBe(422);
      const png = await A.browser.upload(
        '/documents',
        { applicationId: application.id, docType: 'aadhaar_card' },
        { name: 'aadhaar.jpg', bytes: PNG },
      );
      expect(png.body).toMatchObject({ fileName: 'aadhaar.png', contentType: 'image/png' });
    });

    it('limits sensitive documents to staff with the sensitive permission', async () => {
      const officer = await staff(A, 'admission_officer');
      const list = (await officer.get(`/applications/${application.id}/documents`)).body as Row[];
      const aadhaar = list.find((d) => d.docType === 'aadhaar_card')!;
      expect(aadhaar).toMatchObject({ sensitive: true, canOpen: false });
      expect((await officer.post(`/documents/${aadhaar.id}/link`)).status).toBe(403);
      expect((await officer.post(`/documents/${docId}/link`)).status).toBe(200);
      expect((await A.browser.post(`/documents/${aadhaar.id}/link`)).status).toBe(200);
      const audit = (await A.browser.get('/audit-logs?entity=admission_application&limit=50')).body
        .data as Row[];
      expect(audit.filter((e) => e.action === 'document.downloaded').length).toBeGreaterThanOrEqual(
        3,
      );
    });
  });

  describe('admission from an application', () => {
    it('creates the student with the parent and moves the documents', async () => {
      const wrongClassYear = await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: class2.id,
        name: 'A',
      });
      expect(wrongClassYear.status).toBe(201); // a different class of the same year is allowed (placement)
      const res = await A.browser.post(`/applications/${application.id}/admit`, {
        sectionId: secA.id,
        privacyNotice: ack,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ admissionNumber: '0001', rollNumber: 1 });
      const student = (await A.browser.get(`/students/${res.body.studentId}`)).body;
      expect(student).toMatchObject({
        firstName: 'Meera',
        lastName: 'Joshi',
        dateOfBirth: '2020-02-02',
      });
      expect(student.guardians[0]).toMatchObject({
        fullName: 'Kavita Joshi',
        phone: '+919414012345',
        isPrimary: true,
        isFeePayer: true,
      });
      const docs = (await A.browser.get(`/students/${res.body.studentId}/documents`)).body as Row[];
      expect(docs.map((d) => d.docType).sort()).toEqual(['aadhaar_card', 'birth_certificate']);
      const detail = (await A.browser.get(`/applications/${application.id}`)).body;
      expect(detail).toMatchObject({
        status: 'admitted',
        admissionNumber: '0001',
        nextStatuses: [],
      });
      // Inquiry closed; application is final.
      expect(
        ((await A.browser.get('/inquiries')).body.data as Row[]).find(
          (i) => i.parentName === 'Kavita Joshi',
        )!.status,
      ).toBe('closed');
      expect(
        (
          await A.browser.post(`/applications/${application.id}/status`, {
            status: 'withdrawn',
            note: 'test',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await A.browser.post(`/applications/${application.id}/admit`, {
            sectionId: secA.id,
            privacyNotice: ack,
          })
        ).status,
      ).toBe(409);
      expect(
        (await A.browser.patch(`/applications/${application.id}`, { notes: 'x' })).status,
      ).toBe(409);
    });

    it('removes a document: record kept, file gone', async () => {
      const student = ((await A.browser.get('/students?limit=1')).body.data as Row[])[0]!;
      const docs = (await A.browser.get(`/students/${student.id}/documents`)).body as Row[];
      const doc = docs.find((d) => d.docType === 'birth_certificate')!;
      const link = (await A.browser.post(`/documents/${doc.id}/link`)).body.url as string;
      expect((await A.browser.delete(`/documents/${doc.id}`)).status).toBe(204);
      expect((await A.browser.post(`/documents/${doc.id}/link`)).status).toBe(404);
      expect((await request(app.getHttpServer()).get(link)).status).toBe(404); // file deleted
      const after = (await A.browser.get(`/students/${student.id}/documents`)).body as Row[];
      expect(after.map((d) => d.docType)).toEqual(['aadhaar_card']);
    });
  });

  describe('isolation', () => {
    it('school B cannot see or touch school A’s applications and documents', async () => {
      const appA = ((await A.browser.get('/applications?status=submitted')).body.data as Row[])[0]!;
      const docA = (
        (await A.browser.get(`/applications/${application.id}/documents`)).body as Row[]
      )[0]!;
      const statuses = {
        get: (await B.browser.get(`/applications/${appA.id}`)).status,
        list: (await B.browser.get('/applications')).body.data.length,
        update: (await B.browser.patch(`/applications/${appA.id}`, { notes: 'x' })).status,
        move: (await B.browser.post(`/applications/${appA.id}/status`, { status: 'under_review' }))
          .status,
        docs: (await B.browser.get(`/applications/${appA.id}/documents`)).status,
        link: (await B.browser.post(`/documents/${docA.id}/link`)).status,
        remove: (await B.browser.delete(`/documents/${docA.id}`)).status,
        upload: (
          await B.browser.upload(
            '/documents',
            { applicationId: appA.id, docType: 'other' },
            { name: 'x.pdf', bytes: PDF },
          )
        ).status,
        createInA: (await apply(B)).status,
        summary: (
          await B.browser.get(
            `/applications/summary?campusId=${A.campusId}&academicYearId=${year.id}`,
          )
        ).status,
      };
      expect(statuses).toEqual({
        get: 404,
        list: 0,
        update: 404,
        move: 404,
        docs: 404,
        link: 404,
        remove: 404,
        upload: 404,
        createInA: 404,
        summary: 404,
      });
    });
  });
});
