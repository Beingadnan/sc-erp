import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openOwnerPool, prepareDatabase } from '@school-erp/db/testing';
import { verhoeffValid } from '@school-erp/validation';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };

const aadhaar = (eleven: string) => {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(eleven + d)) return eleven + d;
  throw new Error('unreachable');
};

/** Phase 4a: students, guardians, enrollments, admission numbers, Aadhaar protection. */
describe('Phase 4a: students (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  let yearA: Row;
  let sec1A: Row;
  let sec1B: Row;
  let campus2: string;
  let sec2: Row; // section on campus 2
  let firstStudent: { id: string; admissionNumber: string };

  const ack = { acknowledged: true, version: '2026-1', channel: 'in_person' };
  let phoneSeq = 0;
  const phone = () => `98${String(10000000 + ++phoneSeq).slice(-8)}`;
  const admit = (s: School, sectionId: string, extra: Record<string, unknown> = {}) =>
    s.browser.post('/students', {
      firstName: 'Student',
      lastName: unique('x').slice(-6),
      dateOfBirth: '2019-05-10',
      gender: 'female',
      sectionId,
      guardians: [
        { fullName: 'Parent One', phone: phone(), relationship: 'mother', isPrimary: true },
      ],
      privacyNotice: ack,
      ...extra,
    });

  const roleId = async (s: School, key: string) =>
    ((await s.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === key,
    )!.id;

  const staff = async (s: School, roleKey: string, campusId: string | null) => {
    const email = `${unique('staff')}@example.test`;
    const res = await s.browser.post('/members/invite', {
      email,
      fullName: 'Staff Member',
      assignments: [{ roleId: await roleId(s, roleKey), campusId }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const browser = new Browser(app);
    await browser.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
    return { browser, membershipId: res.body.id as string };
  };

  const setupSchool = async (s: School, campusId: string) => {
    const year = await s.browser.post('/academic-years', {
      campusId,
      name: '2026-27',
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
    });
    const cls = await s.browser.post('/classes', {
      campusId,
      code: '1',
      name: 'Class 1',
      stage: 'primary',
    });
    const a = await s.browser.post('/sections', {
      academicYearId: year.body.id,
      gradeLevelId: cls.body.id,
      name: 'A',
      capacity: 3,
    });
    const b = await s.browser.post('/sections', {
      academicYearId: year.body.id,
      gradeLevelId: cls.body.id,
      name: 'B',
    });
    return { year: year.body as Row, cls: cls.body as Row, a: a.body as Row, b: b.body as Row };
  };

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    ({ year: yearA, a: sec1A, b: sec1B } = await setupSchool(A, A.campusId));
    const c2 = await A.browser.post('/campuses', {
      code: 'C2',
      name: 'Second Campus',
      board: 'CBSE',
    });
    campus2 = c2.body.id;
    ({ a: sec2 } = await setupSchool(A, campus2));
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('admission', () => {
    it('admits a student with guardian, enrollment, roll number and privacy acknowledgement', async () => {
      const res = await admit(A, sec1A.id, {
        firstName: 'Aarav',
        lastName: 'Sharma',
        nameLocal: 'आरव शर्मा',
        bloodGroup: 'B+',
        pen: '12345678901',
        guardians: [
          {
            fullName: 'Sunita Sharma',
            phone: '98290 12345',
            relationship: 'mother',
            isPrimary: true,
            isFeePayer: true,
          },
          {
            fullName: 'Rakesh Sharma',
            phone: '9829054321',
            relationship: 'father',
            isPrimary: false,
          },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ admissionNumber: '0001', rollNumber: 1 });
      firstStudent = res.body;
      const s = (await A.browser.get(`/students/${res.body.id}`)).body;
      expect(s).toMatchObject({
        firstName: 'Aarav',
        nameLocal: 'आरव शर्मा',
        status: 'active',
        aadhaarMasked: null,
        permissions: { manage: true, viewSensitive: true },
      });
      expect(s.guardians.map((g: Row) => [g.fullName, g.isPrimary, g.phone])).toEqual([
        ['Sunita Sharma', true, '+919829012345'],
        ['Rakesh Sharma', false, '+919829054321'],
      ]);
      expect(s.enrollments[0]).toMatchObject({
        yearName: '2026-27',
        className: 'Class 1',
        sectionName: 'A',
        rollNumber: 1,
      });
      expect(s.acknowledgements[0]).toMatchObject({
        noticeVersion: '2026-1',
        channel: 'in_person',
      });
    });

    it('numbers admissions without gaps, even when an admission fails', async () => {
      const bad = await admit(A, sec1A.id, { pen: '12345678901' }); // duplicate PEN → fails
      expect(bad.status).toBe(409);
      const next = await admit(A, sec1A.id);
      expect(next.body.admissionNumber).toBe('0002');
      expect(next.body.rollNumber).toBe(2);
    });

    it('allocates unique numbers under concurrent admissions', async () => {
      const results = await Promise.all([
        admit(A, sec1B.id),
        admit(A, sec1B.id),
        admit(A, sec1B.id),
        admit(A, sec1B.id),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      const numbers = results.map((r) => r.body.admissionNumber as string).sort();
      expect(numbers).toEqual(['0003', '0004', '0005', '0006']);
      const rolls = results.map((r) => r.body.rollNumber as number).sort();
      expect(new Set(rolls).size).toBe(4);
    });

    it('enforces section capacity and closed years', async () => {
      await admit(A, sec1A.id); // 3rd seat
      const full = await admit(A, sec1A.id);
      expect(full.status).toBe(409);
      expect(full.body.error.details.reason).toBe('section_full');
      await A.browser.post(`/academic-years/${yearA.id}/make-current`);
      await A.browser.post(`/academic-years/${yearA.id}/status`, { status: 'closed' });
      expect((await admit(A, sec1B.id)).body.error.details.reason).toBe('year_closed');
      await A.browser.post(`/academic-years/${yearA.id}/status`, { status: 'active' });
    });

    it('uses the configured pattern with campus code and year', async () => {
      const bad = await A.browser.put('/settings/admission-numbers', {
        pattern: '{SEQ:4}',
        perCampus: true,
        yearlyReset: false,
      });
      expect(bad.status).toBe(422);
      expect(
        (
          await A.browser.put('/settings/admission-numbers', {
            pattern: '{CAMPUS}/{YYYY}/{SEQ:3}',
            perCampus: true,
            yearlyReset: true,
          })
        ).status,
      ).toBe(200);
      const preview = (await A.browser.get(`/settings/admission-numbers?sectionId=${sec2.id}`))
        .body;
      expect(preview.next).toBe('C2/2026/001');
      const res = await admit(A, sec2.id);
      expect(res.body.admissionNumber).toBe('C2/2026/001');
      // School B has its own counter and settings.
      const b = await setupSchool(B, B.campusId);
      expect((await admit(B, b.a.id)).body.admissionNumber).toBe('0001');
    });
  });

  describe('Aadhaar protection', () => {
    const number = aadhaar('23456789012');

    it('stores Aadhaar encrypted, shows it masked and logs every reveal', async () => {
      const res = await admit(A, sec1B.id, {
        aadhaar: `${number.slice(0, 4)} ${number.slice(4, 8)} ${number.slice(8)}`,
      });
      expect(res.status).toBe(201);
      const s = (await A.browser.get(`/students/${res.body.id}`)).body;
      expect(s.aadhaarMasked).toBe(`XXXX XXXX ${number.slice(-4)}`);
      expect(JSON.stringify(s)).not.toContain(number);

      const reveal = await A.browser.post(`/students/${res.body.id}/aadhaar/reveal`);
      expect(reveal.body).toEqual({ aadhaar: number });
      const audit = (await A.browser.get('/audit-logs?entity=student&limit=50')).body
        .data as Array<{
        action: string;
        entityId: string;
        diff: unknown;
      }>;
      expect(
        audit.some((e) => e.action === 'student.aadhaar_viewed' && e.entityId === res.body.id),
      ).toBe(true);
      expect(JSON.stringify(audit)).not.toContain(number);

      // Never in clear text in the database.
      const owner = openOwnerPool();
      try {
        await owner.query(`select set_config('app.tenant_id', $1, false)`, [A.tenantId]);
        const { rows } = await owner.query(
          `select row_to_json(s)::text as j from students s where id = $1`,
          [res.body.id],
        );
        expect(rows[0].j).not.toContain(number);
      } finally {
        await owner.end();
      }
    });

    it('rejects invalid and duplicate Aadhaar numbers', async () => {
      const wrong = number.slice(0, 11) + ((Number(number[11]) + 1) % 10);
      expect((await admit(A, sec1B.id, { aadhaar: wrong })).status).toBe(422);
      const dup = await admit(A, sec1B.id, { aadhaar: number });
      expect(dup.status).toBe(409);
      expect(dup.body.error.details.reason).toBe('aadhaar_exists');
      // The same number in another school is a separate matter (separate index).
      const b = (await B.browser.get(`/students?limit=1`)).body.data[0];
      expect(b).toBeTruthy();
    });

    it('does not reveal Aadhaar without the sensitive permission', async () => {
      const officer = await staff(A, 'admission_officer', null);
      const list = (await officer.browser.get('/students?limit=50')).body.data as Row[];
      const withAadhaar = list.find((s) => s.lastName && true)!;
      expect(
        (await officer.browser.post(`/students/${withAadhaar.id}/aadhaar/reveal`)).status,
      ).toBe(403);
    });
  });

  describe('guardians and siblings', () => {
    it('finds a guardian by phone and links a sibling to them', async () => {
      const found = (await A.browser.get('/guardians?phone=9829012345')).body as Array<{
        id: string;
        children: Array<{ name: string }>;
      }>;
      expect(found).toHaveLength(1);
      expect(found[0]!.children.map((c) => c.name)).toEqual(['Aarav Sharma']);
      const sibling = await admit(A, sec1B.id, {
        firstName: 'Anaya',
        lastName: 'Sharma',
        guardians: [{ guardianId: found[0]!.id, relationship: 'mother', isPrimary: true }],
      });
      expect(sibling.status).toBe(201);
      const again = (await A.browser.get('/guardians?phone=9829012345')).body;
      expect(again[0].children.map((c: { name: string }) => c.name).sort()).toEqual([
        'Aarav Sharma',
        'Anaya Sharma',
      ]);
    });

    it('keeps exactly one primary guardian and at least one guardian', async () => {
      const s = (await A.browser.get(`/students/${firstStudent.id}`)).body;
      const mother = s.guardians.find((g: Row) => g.relationship === 'mother');
      const father = s.guardians.find((g: Row) => g.relationship === 'father');
      expect(
        (await A.browser.delete(`/students/${firstStudent.id}/guardians/${mother.id}`)).status,
      ).toBe(409);
      expect(
        (
          await A.browser.patch(`/students/${firstStudent.id}/guardians/${father.id}`, {
            isPrimary: true,
          })
        ).status,
      ).toBe(204);
      const after = (await A.browser.get(`/students/${firstStudent.id}`)).body;
      expect(
        after.guardians.filter((g: Row) => g.isPrimary).map((g: Row) => g.relationship),
      ).toEqual(['father']);
      expect(
        (await A.browser.delete(`/students/${firstStudent.id}/guardians/${mother.id}`)).status,
      ).toBe(204);
      expect(
        (await A.browser.delete(`/students/${firstStudent.id}/guardians/${father.id}`)).status,
      ).toBe(409);
    });

    it('records further privacy acknowledgements as new entries', async () => {
      const s = (await A.browser.get(`/students/${firstStudent.id}`)).body;
      const res = await A.browser.post(
        `/students/${firstStudent.id}/guardians/${s.guardians[0].id}/privacy-acknowledgements`,
        { version: '2027-1', channel: 'web' },
      );
      expect(res.status).toBe(204);
      const after = (await A.browser.get(`/students/${firstStudent.id}`)).body;
      expect(after.acknowledgements.map((a: Row) => a.noticeVersion)).toEqual(['2027-1', '2026-1']);
    });
  });

  describe('class lists and moves', () => {
    it('lists a section by roll number, moves a student and renumbers by name', async () => {
      const roster = (await A.browser.get(`/students?sectionId=${sec1B.id}`)).body.data as Row[];
      expect(roster.length).toBeGreaterThan(3);
      const rolls = roster.map((r) => r.rollNumber as number);
      expect(rolls).toEqual([...rolls].sort((a, b) => a - b));
      // Section A is full: moving into it is refused.
      const move = await A.browser.patch(`/enrollments/${roster[0]!.enrollmentId}`, {
        sectionId: sec1A.id,
      });
      expect(move.status).toBe(409);
      await A.browser.patch(`/sections/${sec1A.id}`, { capacity: 10 });
      const ok = await A.browser.patch(`/enrollments/${roster[0]!.enrollmentId}`, {
        sectionId: sec1A.id,
      });
      expect(ok.status).toBe(200);
      // Other campus's section is refused.
      expect(
        (await A.browser.patch(`/enrollments/${roster[1]!.enrollmentId}`, { sectionId: sec2.id }))
          .status,
      ).toBe(422);
      // Duplicate roll number is refused.
      const r1 = roster[1]!.rollNumber as number;
      expect(
        (await A.browser.patch(`/enrollments/${roster[2]!.enrollmentId}`, { rollNumber: r1 }))
          .status,
      ).toBe(409);

      expect(
        (await A.browser.post(`/sections/${sec1B.id}/renumber`, { order: 'name' })).status,
      ).toBe(200);
      const renumbered = (await A.browser.get(`/students?sectionId=${sec1B.id}`)).body
        .data as Row[];
      expect(renumbered.map((r) => r.rollNumber)).toEqual(renumbered.map((_, i) => i + 1));
      const names = renumbered.map((r) => `${r.firstName} ${r.lastName}`);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    });

    it('searches by name, admission number and guardian phone', async () => {
      const byName = (await A.browser.get('/students?q=aarav')).body.data as Row[];
      expect(byName.map((s) => s.firstName)).toEqual(['Aarav']);
      const byNumber = (await A.browser.get('/students?q=0002')).body.data as Row[];
      expect(byNumber.map((s) => s.admissionNumber)).toContain('0002');
      const byPhone = (await A.browser.get('/students?q=98290-12345')).body.data as Row[];
      expect(byPhone.map((s) => s.firstName).sort()).toEqual(['Anaya']); // Aarav's mother was unlinked
    });
  });

  describe('who can see which students', () => {
    it('a class teacher sees only students of their own section', async () => {
      const teacher = await staff(A, 'teacher', A.campusId);
      await A.browser.patch(`/sections/${sec1A.id}`, {
        classTeacherMembershipId: teacher.membershipId,
      });
      const list = (await teacher.browser.get('/students?limit=100')).body.data as Row[];
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((s) => s.sectionId === sec1A.id)).toBe(true);
      const other = (await A.browser.get(`/students?sectionId=${sec1B.id}`)).body.data[0] as Row;
      expect((await teacher.browser.get(`/students/${other.id}`)).status).toBe(404);
      expect(
        (await teacher.browser.patch(`/students/${list[0]!.id}`, { firstName: 'X' })).status,
      ).toBe(403);
      expect((await teacher.browser.post(`/students/${list[0]!.id}/aadhaar/reveal`)).status).toBe(
        403,
      );
    });

    it('campus-scoped staff see and admit only on their campus', async () => {
      const officer = await staff(A, 'admission_officer', campus2);
      const list = (await officer.browser.get('/students?limit=100')).body.data as Row[];
      expect(list.length).toBe(1);
      expect(list[0]!.campusId).toBe(campus2);
      expect((await admit(officer as unknown as School, sec1A.id)).status).toBe(404);
      expect((await admit(officer as unknown as School, sec2.id)).status).toBe(201);
      expect((await officer.browser.get(`/students/${firstStudent.id}`)).status).toBe(404);
    });

    it('school B cannot see or touch school A’s students', async () => {
      const s = (await A.browser.get(`/students/${firstStudent.id}`)).body;
      const gid = s.guardians[0].id;
      const enrollmentId = s.enrollments[0].id;
      const statuses = {
        get: (await B.browser.get(`/students/${firstStudent.id}`)).status,
        update: (await B.browser.patch(`/students/${firstStudent.id}`, { firstName: 'Hacked' }))
          .status,
        reveal: (await B.browser.post(`/students/${firstStudent.id}/aadhaar/reveal`)).status,
        addGuardian: (
          await B.browser.post(`/students/${firstStudent.id}/guardians`, {
            fullName: 'Intruder',
            phone: '9999999999',
            relationship: 'other',
          })
        ).status,
        editGuardian: (await B.browser.patch(`/guardians/${gid}`, { fullName: 'Hacked' })).status,
        lookup: (await B.browser.get('/guardians?phone=9829054321')).body.length,
        enrollment: (await B.browser.patch(`/enrollments/${enrollmentId}`, { rollNumber: 50 }))
          .status,
        renumber: (await B.browser.post(`/sections/${sec1A.id}/renumber`, { order: 'name' }))
          .status,
        admitIntoA: (await admit(B, sec1A.id)).status,
        linkAGuardian: (
          await B.browser.post('/students', {
            firstName: 'Sib',
            dateOfBirth: '2019-05-10',
            gender: 'male',
            sectionId: sec1A.id,
            guardians: [{ guardianId: gid, relationship: 'father', isPrimary: true }],
            privacyNotice: ack,
          })
        ).status,
        search: (await B.browser.get('/students?q=aarav')).body.data.length,
      };
      expect(statuses).toEqual({
        get: 404,
        update: 404,
        reveal: 404,
        addGuardian: 404,
        editGuardian: 404,
        lookup: 0,
        enrollment: 404,
        renumber: 404,
        admitIntoA: 404,
        linkAGuardian: 404,
        search: 0,
      });
    });
  });
});
