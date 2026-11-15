import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { verhoeffValid } from '@school-erp/validation';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };

const aadhaar = (eleven: string) => {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(eleven + d)) return eleven + d;
  throw new Error('unreachable');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Phase 4c: custom fields, promotion, withdrawal + TC, export, import. */
describe('Phase 4c: student records lifecycle (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  const y: Record<string, Row> = {};
  const c: Record<string, Row> = {};
  const s: Record<string, Row> = {};
  let phoneSeq = 0;

  const ack = { acknowledged: true, version: '1.0', channel: 'in_person' };
  const admit = (sectionId: string, extra: Record<string, unknown> = {}) =>
    A.browser.post('/students', {
      firstName: 'Kid',
      lastName: unique('x').slice(-5),
      dateOfBirth: '2018-05-10',
      gender: 'female',
      sectionId,
      guardians: [
        {
          fullName: 'Parent',
          phone: `97${String(10000000 + ++phoneSeq).slice(-8)}`,
          relationship: 'mother',
          isPrimary: true,
        },
      ],
      privacyNotice: ack,
      customFields: { house: 'Red' },
      ...extra,
    });

  const staff = async (roleKey: string) => {
    const roles = (await A.browser.get('/roles')).body as Array<{ key: string; id: string }>;
    const email = `${unique('staff')}@example.test`;
    await A.browser.post('/members/invite', {
      email,
      fullName: 'Staff',
      assignments: [{ roleId: roles.find((r) => r.key === roleKey)!.id, campusId: null }],
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
    for (const [k, start] of [
      ['y1', 2026],
      ['y2', 2027],
    ] as const) {
      y[k] = (
        await A.browser.post('/academic-years', {
          campusId: A.campusId,
          name: `${start}-${(start + 1) % 100}`,
          startsOn: `${start}-04-01`,
          endsOn: `${start + 1}-03-31`,
        })
      ).body;
    }
    c.c1 = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: '1',
        name: 'Class 1',
        stage: 'primary',
        sortOrder: 11,
      })
    ).body;
    c.c2 = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: '2',
        name: 'Class 2',
        stage: 'primary',
        sortOrder: 12,
      })
    ).body;
    s.y1c1A = (
      await A.browser.post('/sections', {
        academicYearId: y.y1!.id,
        gradeLevelId: c.c1!.id,
        name: 'A',
      })
    ).body;
    s.y2c1A = (
      await A.browser.post('/sections', {
        academicYearId: y.y2!.id,
        gradeLevelId: c.c1!.id,
        name: 'A',
      })
    ).body;
    s.y2c2A = (
      await A.browser.post('/sections', {
        academicYearId: y.y2!.id,
        gradeLevelId: c.c2!.id,
        name: 'A',
        capacity: 40,
      })
    ).body;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('custom fields', () => {
    it('lets admins define fields and enforces them on admission', async () => {
      const house = await A.browser.post('/custom-fields', {
        entity: 'student',
        key: 'house',
        label: 'House',
        fieldType: 'select',
        options: ['Red', 'Blue', 'Green'],
        required: true,
      });
      expect(house.status).toBe(201);
      expect(
        (
          await A.browser.post('/custom-fields', {
            entity: 'student',
            key: 'house',
            label: 'Dup',
            fieldType: 'text',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await A.browser.post('/custom-fields', {
            entity: 'student',
            key: 'bad',
            label: 'Bad',
            fieldType: 'select',
          })
        ).status,
      ).toBe(422);
      await A.browser.post('/custom-fields', {
        entity: 'student',
        key: 'bus_route',
        label: 'Bus route',
        fieldType: 'text',
      });

      const missing = await admit(s.y1c1A!.id, { customFields: {} });
      expect(missing.status).toBe(422);
      expect(missing.body.error.details.fields['customFields.house']).toBe('House is required');
      const wrong = await admit(s.y1c1A!.id, { customFields: { house: 'Purple', unknown_key: 1 } });
      expect(Object.keys(wrong.body.error.details.fields).sort()).toEqual([
        'customFields.house',
        'customFields.unknown_key',
      ]);

      const ok = await admit(s.y1c1A!.id, { customFields: { house: 'Blue', bus_route: 'R7' } });
      expect(ok.status).toBe(201);
      const st = (await A.browser.get(`/students/${ok.body.id}`)).body;
      expect(st.customFields).toEqual({ house: 'Blue', bus_route: 'R7' });
      await A.browser.patch(`/students/${ok.body.id}`, { customFields: { bus_route: '' } });
      expect((await A.browser.get(`/students/${ok.body.id}`)).body.customFields).toEqual({
        house: 'Blue',
      });
      // Teachers can read definitions (forms need them) but not change them.
      const teacher = await staff('teacher');
      expect((await teacher.get('/custom-fields')).body.student.map((f: Row) => f.key)).toEqual([
        'bus_route',
        'house',
      ]);
      expect(
        (
          await teacher.post('/custom-fields', {
            entity: 'student',
            key: 'x1',
            label: 'X',
            fieldType: 'text',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('year-end promotion', () => {
    it('suggests the next class and moves students on', async () => {
      await admit(s.y1c1A!.id);
      await admit(s.y1c1A!.id);
      const preview = (
        await A.browser.get(
          `/promotions/preview?fromSectionId=${s.y1c1A!.id}&toAcademicYearId=${y.y2!.id}`,
        )
      ).body;
      expect(preview.students).toHaveLength(3);
      expect(preview.sections.find((x: Row) => x.isNextClass).id).toBe(s.y2c2A!.id);
      const [a, b, c3] = preview.students as Array<{ enrollmentId: string; studentId: string }>;

      const lower = await A.browser.post('/promotions', {
        fromSectionId: s.y1c1A!.id,
        toAcademicYearId: y.y2!.id,
        items: [{ enrollmentId: a!.enrollmentId, action: 'promote', toSectionId: s.y2c1A!.id }],
      });
      expect(lower.status).toBe(422);

      const res = await A.browser.post('/promotions', {
        fromSectionId: s.y1c1A!.id,
        toAcademicYearId: y.y2!.id,
        items: [
          { enrollmentId: a!.enrollmentId, action: 'promote', toSectionId: s.y2c2A!.id },
          { enrollmentId: b!.enrollmentId, action: 'retain', toSectionId: s.y2c1A!.id },
          { enrollmentId: c3!.enrollmentId, action: 'complete' },
        ],
      });
      expect(res.body).toEqual({ promoted: 1, retained: 1, completed: 1, skipped: 0 });
      const sa = (await A.browser.get(`/students/${a!.studentId}`)).body;
      expect(sa.enrollments.map((e: Row) => [e.yearName, e.className, e.status])).toEqual([
        ['2027-28', 'Class 2', 'active'],
        ['2026-27', 'Class 1', 'promoted'],
      ]);
      expect((await A.browser.get(`/students/${c3!.studentId}`)).body.status).toBe('alumni');
      // Running it again is refused.
      const again = await A.browser.post('/promotions', {
        fromSectionId: s.y1c1A!.id,
        toAcademicYearId: y.y2!.id,
        items: [{ enrollmentId: a!.enrollmentId, action: 'promote', toSectionId: s.y2c2A!.id }],
      });
      expect(again.body.error.details.reason).toBe('already_promoted');
    });
  });

  describe('withdrawal and transfer certificates', () => {
    let studentId: string;
    let tcId: string;

    it('withdraws a student and issues a numbered TC with a PDF', async () => {
      const admitted = await admit(s.y2c2A!.id, {
        firstName: 'Ishaan',
        lastName: 'Verma',
        guardians: [
          { fullName: 'Rohit Verma', phone: '9001112223', relationship: 'father', isPrimary: true },
          { fullName: 'Neha Verma', phone: '9001112224', relationship: 'mother', isPrimary: false },
        ],
      });
      studentId = admitted.body.id;
      const res = await A.browser.post(`/students/${studentId}/withdraw`, {
        leftOn: '2027-06-30',
        reason: 'Family moving to Pune',
      });
      expect(res.status).toBe(200);
      expect(res.body.certificate.tcNumber).toBe('TC/2027/0001');
      tcId = res.body.certificate.id;
      const st = (await A.browser.get(`/students/${studentId}`)).body;
      expect(st.status).toBe('withdrawn');
      expect(st.enrollments[0]).toMatchObject({ status: 'withdrawn', leftOn: '2027-06-30' });

      const pdf = await A.browser.get(`/transfer-certificates/${tcId}/pdf`).buffer(true);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(
        Buffer.from(pdf.body as Buffer)
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');

      expect(
        (
          await A.browser.post(`/students/${studentId}/withdraw`, {
            leftOn: '2027-07-01',
            reason: 'Again',
          })
        ).status,
      ).toBe(409);
      const second = await A.browser.post(`/students/${studentId}/transfer-certificates`, {
        leftOn: '2027-06-30',
        reason: 'Copy',
      });
      expect(second.status).toBe(409);
    });

    it('cancels a TC with a reason and issues a new number', async () => {
      expect(
        (
          await A.browser.post(`/transfer-certificates/${tcId}/cancel`, {
            reason: 'Wrong leaving date',
          })
        ).status,
      ).toBe(204);
      const re = await A.browser.post(`/students/${studentId}/transfer-certificates`, {
        leftOn: '2027-07-15',
        reason: 'Family moving to Pune',
      });
      expect(re.body.tcNumber).toBe('TC/2027/0002');
      const list = (await A.browser.get(`/students/${studentId}/transfer-certificates`))
        .body as Row[];
      expect(list.map((t) => [t.tcNumber, t.status])).toEqual([
        ['TC/2027/0002', 'issued'],
        ['TC/2027/0001', 'cancelled'],
      ]);
      expect((await A.browser.get(`/transfer-certificates/${tcId}/pdf`)).status).toBe(200);
    });

    it('limits who can withdraw and print', async () => {
      const officer = await staff('admission_officer');
      const kid = (await admit(s.y2c2A!.id)).body;
      expect(
        (
          await officer.post(`/students/${kid.id}/withdraw`, {
            leftOn: '2027-06-30',
            reason: 'Moving',
          })
        ).status,
      ).toBe(403);
      expect((await B.browser.get(`/transfer-certificates/${tcId}/pdf`)).status).toBe(404);
      expect(
        (await B.browser.post(`/transfer-certificates/${tcId}/cancel`, { reason: 'Hacking' }))
          .status,
      ).toBe(404);
      expect(
        (
          await B.browser.post(`/students/${studentId}/withdraw`, {
            leftOn: '2027-06-30',
            reason: 'x x x',
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('export', () => {
    it('exports CSV with masked Aadhaar, neutralised formulas, and is logged', async () => {
      const number = aadhaar('34567890123');
      await admit(s.y2c2A!.id, { firstName: '=HYPERLINK("http://evil")', aadhaar: number });
      const res = await A.browser.get(`/students/export?academicYearId=${y.y2!.id}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const text = res.text;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text.split('\r\n')[0]).toContain('admission_number,first_name,last_name');
      expect(text).toContain('cf_house');
      expect(text).toContain(`XXXX XXXX ${number.slice(-4)}`);
      expect(text).not.toContain(number);
      expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
      const audit = (await A.browser.get('/audit-logs?entity=student&limit=100')).body
        .data as Row[];
      expect(audit.some((e) => e.action === 'students.exported')).toBe(true);
      const officer = await staff('admission_officer');
      expect((await officer.get('/students/export')).status).toBe(403);
      expect((await B.browser.get('/students/export')).text).not.toContain('Ishaan');
    });
  });

  describe('import', () => {
    const poll = async (browser: Browser, id: string) => {
      for (let i = 0; i < 50; i++) {
        const job = (await browser.get(`/imports/${id}`)).body;
        if (job.status !== 'processing') return job;
        await sleep(100);
      }
      throw new Error('import did not finish');
    };

    it('previews, reports row problems, imports valid rows and links siblings', async () => {
      const template = await A.browser.get('/students/import/template');
      expect(template.text).toContain('cf_house');
      const csv = [
        'Adm No,First Name,Last Name,DOB,Gender,Class,Section,Father Name,Mobile,parent_relationship,cf_house',
        'OLD-101,Riya,Gupta,05/08/2018,F,Class 2,A,Anil Gupta,9811100001,father,Green',
        ',Kabir,Singh,2018-01-20,Boy,2,A,Harpreet Singh,9811100002,father,Red',
        ',Bad,Date,31/02/2018,M,Class 2,A,X Y,9811100003,father,Red',
        ',Nope,Class,2018-01-01,M,Class 9,A,X Y,9811100004,father,Red',
        ',Ishaan,Verma,2018-05-10,M,Class 2,A,Rohit Verma,9001112223,father,Red', // same as existing student
        ',Riya,Gupta,05-08-2018,F,Class 2,A,Anil Gupta,9811100001,father,Green', // duplicate row
        ',Tara,Verma,2019-03-03,F,Class 2,A,Rohit Verma,9001112223,father,Blue', // sibling of Ishaan
      ].join('\n');
      const res = await A.browser.upload(
        '/imports/students',
        { campusId: A.campusId, academicYearId: y.y2!.id },
        { name: 'students.csv', bytes: Buffer.from(csv) },
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ totalRows: 7, validRows: 3 });
      const problems = res.body.problems as Array<{ row: number; field: string; message: string }>;
      expect(problems.map((p) => [p.row, p.field])).toEqual([
        [4, 'date_of_birth'],
        [5, 'section'],
        [6, 'first_name'],
        [7, 'first_name'],
      ]);
      expect(problems[2]!.message).toContain('existing student');
      expect(problems[3]!.message).toBe('Same name and date of birth as row 2');

      expect((await A.browser.post(`/imports/${res.body.jobId}/confirm`, {})).status).toBe(422); // privacy confirmation
      expect(
        (await A.browser.post(`/imports/${res.body.jobId}/confirm`, { privacyNoticeGiven: true }))
          .status,
      ).toBe(202);
      const job = await poll(A.browser, res.body.jobId);
      expect(job).toMatchObject({ status: 'completed', created: 3, failed: 0 });
      expect((job.report as Row[]).find((r) => r.row === 2)!.admissionNumber).toBe('OLD-101');

      const tara = ((await A.browser.get('/students?q=tara')).body.data as Row[])[0]!;
      const detail = (await A.browser.get(`/students/${tara.id}`)).body;
      expect(detail.customFields).toEqual({ house: 'Blue' });
      const parents = (await A.browser.get('/guardians?phone=9001112223')).body as Array<{
        children: Row[];
      }>;
      expect(parents).toHaveLength(1); // linked, not duplicated
      expect(parents[0]!.children.map((ch) => ch.name).sort()).toEqual([
        'Ishaan Verma',
        'Tara Verma',
      ]);
      expect(
        (await A.browser.post(`/imports/${res.body.jobId}/confirm`, { privacyNoticeGiven: true }))
          .status,
      ).toBe(409);
    });

    it('reads Excel files too', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Students');
      ws.addRow([
        'first_name',
        'date_of_birth',
        'gender',
        'class',
        'section',
        'parent_name',
        'parent_phone',
        'cf_house',
      ]);
      ws.addRow([
        'Zoya',
        new Date(Date.UTC(2018, 10, 9)),
        'F',
        'Class 2',
        'A',
        'Imran Khan',
        '9822200001',
        'Red',
      ]);
      const bytes = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await A.browser.upload(
        '/imports/students',
        { campusId: A.campusId, academicYearId: y.y2!.id },
        { name: 'students.xlsx', bytes },
      );
      expect(res.body).toMatchObject({ totalRows: 1, validRows: 1 });
      expect(res.body.sample[0]).toMatchObject({ name: 'Zoya', dateOfBirth: '2018-11-09' });
    });

    it('keeps imports private to the school', async () => {
      const jobs = (await A.browser.get('/imports')).body as Row[];
      expect((await B.browser.get(`/imports/${jobs[0]!.id}`)).status).toBe(404);
      expect(
        (await B.browser.post(`/imports/${jobs[0]!.id}/confirm`, { privacyNoticeGiven: true }))
          .status,
      ).toBe(404);
      expect((await B.browser.get('/imports')).body).toEqual([]);
      const intoA = await B.browser.upload(
        '/imports/students',
        { campusId: A.campusId, academicYearId: y.y2!.id },
        { name: 'x.csv', bytes: Buffer.from('first_name\nX') },
      );
      expect(intoA.status).toBe(404);
    });
  });
});
