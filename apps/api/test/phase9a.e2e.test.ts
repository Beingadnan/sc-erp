import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { todayIn } from '../src/attendance/attendance.service.js';
import { Browser, registerSchool, startApp } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

const workbook = async (sheets: Record<string, string[][]>) => {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

/** Phase 9a: the school setup workbook — preview, import, re-import and undo. */
describe('Phase 9a: school setup workbook (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  let yearId: string;
  const today = todayIn('Asia/Kolkata');
  const y0 =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const n = String(Date.now()).slice(-8);
  const hindiPhone = `90${n}`;
  const mathsPhone = `91${n}`;
  let firstImport: string;
  let hindiLink: string;

  const good = () =>
    workbook({
      Classes: [
        ['Class', 'Section', 'Class teacher'],
        ['LKG', 'A', ''],
        ['Class 1', 'A', 'Sushma Rao'],
        ['I', 'B', mathsPhone],
        ['11 Science', 'A', ''],
      ],
      Subjects: [
        ['Code', 'Subject', 'Classes'],
        ['HIN', 'Hindi', 'All'],
        ['', 'Mathematics', '1, LKG'],
        ['PHY', 'Physics', '11 Science'],
      ],
      Staff: [
        ['Name', 'Mobile', 'Email', 'Designation', 'Role', 'Employee code'],
        ['Sushma Rao', hindiPhone, '', 'PRT Hindi', 'Teacher', 'T-1'],
        ['Ravi Kumar', mathsPhone, '', 'PRT Maths', 'teacher', 'T-2'],
        ['Neha Jain', '', `neha${n}@example.test`, 'Accountant', 'Accountant', ''],
      ],
      Teaching: [
        ['Class', 'Section', 'Subject', 'Teacher'],
        ['1', 'A', 'Hindi', hindiPhone],
        ['1', 'B', 'HIN', 'Sushma Rao'],
        ['1', 'A', 'Mathematics', mathsPhone],
        ['LKG', 'A', 'Hindi', 'sushma rao'],
      ],
    });

  const upload = (s: School, bytes: Buffer, name = 'setup.xlsx') =>
    s.browser.upload(`/setup-imports?campusId=${s.campusId}`, {}, { name, bytes });

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    const year = (
      await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: `${y0}-${(y0 + 1) % 100}`,
        startsOn: `${y0}-04-01`,
        endsOn: `${y0 + 1}-03-31`,
      })
    ).body;
    yearId = year.id;
    await A.browser.post(`/academic-years/${year.id}/make-current`, {});
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('gives a template workbook with the four sheets and help', async () => {
    const res = await A.browser
      .get('/setup-imports/template')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Read me',
      'Classes',
      'Subjects',
      'Staff',
      'Teaching',
    ]);
  });

  it('marks every problem and refuses to import until they are fixed', async () => {
    const bad = await workbook({
      Classes: [
        ['Class', 'Section', 'Class teacher'],
        ['Hostel', 'A', ''],
        ['1', 'A', 'Nobody Known'],
        ['1', 'A', ''],
      ],
      Staff: [
        ['Name', 'Mobile', 'Role'],
        ['X', '12345', 'Teacher'],
        ['Pooja', '9876543210', 'Wizard'],
      ],
      Teaching: [
        ['Class', 'Section', 'Subject', 'Teacher'],
        ['1', 'C', 'Hindi', '9876543210'],
      ],
    });
    const res = await upload(A, bad);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const msgs = res.body.problems.map((p: Row) => `${p.sheet}:${p.row}:${p.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Classes:2:"Hostel" is not a class/),
        expect.stringMatching(/^Classes:3:Class teacher "Nobody Known"/),
        expect.stringMatching(/^Classes:4:Class 1 A is listed twice/),
        expect.stringMatching(/^Staff:2:Name is empty|^Staff:2:"12345"/),
        expect.stringMatching(/^Staff:3:Unknown role "Wizard"/),
        expect.stringMatching(/^Teaching:2:Class 1 C is not/),
      ]),
    );
    expect((await A.browser.post(`/setup-imports/${res.body.id}/apply`, {})).status).toBe(409);
    expect((await A.browser.post(`/setup-imports/${res.body.id}/cancel`, {})).status).toBe(200);
    expect((await upload(A, Buffer.from('not excel'), 'x.csv')).status).toBe(422);
  });

  it('previews a clean workbook: what is new and what already exists', async () => {
    const res = await upload(A, await good());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.problemCount, JSON.stringify(res.body.problems)).toBe(0);
    expect(res.body.summary).toMatchObject({
      newClasses: 3,
      newSections: 4,
      newSubjects: 3,
      newStaff: 3,
      classTeachers: 2,
      teaching: 4,
    });
    expect(res.body.plan.subjects.find((s: Row) => s.name === 'Mathematics')).toMatchObject({
      code: 'MATHEMAT',
      classes: ['Class 1', 'LKG'],
    });
    firstImport = res.body.id;
  });

  it('only school managers can import; other schools cannot touch it', async () => {
    expect((await B.browser.post(`/setup-imports/${firstImport}/apply`, {})).status).toBe(404);
  });

  it('imports everything in one go and returns the staff WhatsApp links', async () => {
    const res = await A.browser.post(`/setup-imports/${firstImport}/apply`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.added).toMatchObject({
      gradeLevels: 3,
      sections: 4,
      subjects: 3,
      memberships: 3,
      teaching: 4,
    });
    expect(res.body.added.classTeachers).toBe(2);
    expect(res.body.staffLinks.map((l: Row) => l.fullName).sort()).toEqual([
      'Ravi Kumar',
      'Sushma Rao',
    ]);
    hindiLink = res.body.staffLinks.find((l: Row) => l.fullName === 'Sushma Rao').url;
    expect((await A.browser.post(`/setup-imports/${firstImport}/apply`, {})).status).toBe(409);

    const grid = (
      await A.browser.get(`/teaching/grid?campusId=${A.campusId}&academicYearId=${yearId}`)
    ).body;
    expect(grid.classes.map((c: Row) => c.name)).toEqual(['LKG', 'Class 1', 'Class 11 Science']);
    expect(grid.assignments).toHaveLength(4);
    const teacher = new Browser(app);
    await teacher.post('/auth/invite/accept', {
      token: tokenOf(hindiLink),
      password: 'sushma teaches 1',
    });
    const mine = (await teacher.get('/teaching/mine')).body.sections;
    expect(mine.map((s: Row) => `${s.className} ${s.sectionName}`)).toEqual([
      'Class 1 A',
      'LKG A',
      'Class 1 B',
    ]);
    expect(mine[0].isClassTeacher).toBe(true);
  });

  it('uploading the same workbook again adds nothing new', async () => {
    const res = await upload(A, await good());
    expect(res.body.summary).toMatchObject({
      newClasses: 0,
      newSections: 0,
      newSubjects: 0,
      newStaff: 0,
      existingStaff: 3,
    });
    const applied = await A.browser.post(`/setup-imports/${res.body.id}/apply`, {});
    expect(applied.body.added).toMatchObject({
      gradeLevels: 0,
      sections: 0,
      memberships: 0,
      teaching: 0,
      classTeachers: 0,
    });
  });

  it('undo removes what the import added; staff who signed in stay', async () => {
    const res = await A.browser.post(`/setup-imports/${firstImport}/undo`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.keptStaff).toBe(1);
    const grid = (
      await A.browser.get(`/teaching/grid?campusId=${A.campusId}&academicYearId=${yearId}`)
    ).body;
    expect(grid.classes).toEqual([]);
    const staff = ((await A.browser.get('/members')).body as Row[]).map((m) => m.fullName);
    expect(staff).toContain('Sushma Rao');
    expect(staff).not.toContain('Ravi Kumar');
    expect((await A.browser.post(`/setup-imports/${firstImport}/undo`, {})).status).toBe(409);
    const list = (await A.browser.get(`/setup-imports?campusId=${A.campusId}`)).body.items.map(
      (i: Row) => i.status,
    );
    expect(list).toEqual(expect.arrayContaining(['undone', 'applied', 'cancelled']));
  });

  it('undo is refused once students are in the imported classes', async () => {
    const res = await upload(A, await good());
    const applied = await A.browser.post(`/setup-imports/${res.body.id}/apply`, {});
    expect(applied.status).toBe(200);
    const sec = (
      await A.browser.get(`/teaching/grid?campusId=${A.campusId}&academicYearId=${yearId}`)
    ).body.classes[0].sections[0];
    const st = await A.browser.post('/students', {
      firstName: 'Meera',
      lastName: 'Patel',
      dateOfBirth: '2021-01-01',
      gender: 'female',
      sectionId: sec.id,
      admissionDate: `${y0}-04-01`,
      guardians: [{ fullName: 'Parent', phone: `97${n}`, relationship: 'mother', isPrimary: true }],
      privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
    });
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    const undo = await A.browser.post(`/setup-imports/${res.body.id}/undo`, {});
    expect(undo.status).toBe(409);
    expect(undo.body.error.message).toMatch(/Students have been added/);
  });
});
