import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { todayIn } from '../src/attendance/attendance.service.js';
import { Browser, registerSchool, startApp, unique } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

/** Phase 8: staff by mobile, who-teaches-what, and teachers seeing only their classes. */
describe('Phase 8: teachers and teaching assignments (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  const today = todayIn('Asia/Kolkata');
  const y0 =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const n = String(Date.now()).slice(-8);
  const hindiPhone = `91${n}`;
  const classTeacherPhone = `93${n}`;
  const sections: Record<string, string> = {};
  const subj: Record<string, string> = {};
  const kids: Record<string, string> = {};
  let hindi: Browser;
  let ct: Browser;
  let hindiMember: string;
  let ctMember: string;

  const roleId = async (k: string) =>
    ((await A.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === k,
    )!.id;

  const inviteByPhone = async (phone: string, fullName: string, designation: string) => {
    const res = await A.browser.post('/members/invite', {
      phone,
      fullName,
      designation,
      assignments: [{ roleId: await roleId('teacher'), campusId: A.campusId }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as {
      id: string;
      status: string;
      link: { url: string; message: string } | null;
    };
  };

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
    await A.browser.post(`/academic-years/${year.id}/make-current`, {});
    for (const [code, name] of [
      ['T8HIN', 'Hindi'],
      ['T8ENG', 'English'],
      ['T8SCI', 'Science'],
    ] as const) {
      const r = await A.browser.post('/subjects', { code, name });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      subj[name] = r.body.id;
    }
    for (const [code, order] of [
      ['1', 11],
      ['3', 13],
    ] as const) {
      const cls = (
        await A.browser.post('/classes', {
          campusId: A.campusId,
          code,
          name: `Class ${code}`,
          stage: 'primary',
          sortOrder: order,
        })
      ).body;
      const list = code === '1' ? ['Hindi', 'English'] : ['Hindi', 'English', 'Science'];
      const put = await A.browser.put(`/classes/${cls.id}/subjects`, {
        subjects: list.map((s) => ({ subjectId: subj[s] })),
      });
      expect(put.status, JSON.stringify(put.body)).toBeLessThan(300);
      for (const s of ['A', 'B']) {
        sections[`${code}${s}`] = (
          await A.browser.post('/sections', {
            academicYearId: year.id,
            gradeLevelId: cls.id,
            name: s,
          })
        ).body.id;
      }
    }
    for (const [key, sec] of [
      ['p1', '1A'],
      ['p2', '3B'],
      ['p3', '3A'],
    ] as const) {
      const r = await A.browser.post('/students', {
        firstName: `Kid${key}`,
        lastName: 'Verma',
        dateOfBirth: '2017-01-05',
        gender: 'male',
        sectionId: sections[sec],
        admissionDate: `${y0}-04-01`,
        guardians: [
          {
            fullName: `Parent ${key}`,
            phone: `95${n.slice(0, 6)}${key.slice(1)}0`,
            relationship: 'father',
            isPrimary: true,
          },
        ],
        privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      kids[key] = r.body.id;
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('staff by mobile number', () => {
    it('invites a teacher by mobile and returns a WhatsApp link', async () => {
      const inv = await inviteByPhone(hindiPhone, 'Sushma Rao', 'PRT Hindi');
      expect(inv.status).toBe('invited');
      expect(inv.link!.message).toContain('Sushma Rao');
      hindiMember = inv.id;
      hindi = new Browser(app);
      const acc = await hindi.post('/auth/invite/accept', {
        token: tokenOf(inv.link!.url),
        password: 'hindi teacher 2026',
      });
      expect(acc.status, JSON.stringify(acc.body)).toBeLessThan(300);
      const b = new Browser(app);
      expect(
        (await b.post('/auth/login', { phone: hindiPhone, password: 'hindi teacher 2026' })).status,
      ).toBe(200);

      const inv2 = await inviteByPhone(classTeacherPhone, 'Anil Mehta', 'TGT');
      ctMember = inv2.id;
      ct = new Browser(app);
      await ct.post('/auth/invite/accept', {
        token: tokenOf(inv2.link!.url),
        password: 'class teacher 2026',
      });
    });

    it('needs an email or a mobile, not both or neither', async () => {
      const base = {
        fullName: 'X Y',
        assignments: [{ roleId: await roleId('teacher'), campusId: A.campusId }],
      };
      expect((await A.browser.post('/members/invite', base)).status).toBe(422);
      expect(
        (
          await A.browser.post('/members/invite', {
            ...base,
            phone: '9000000001',
            email: `${unique('x')}@example.test`,
          })
        ).status,
      ).toBe(422);
    });

    it('lists staff with designation and lets the office edit it', async () => {
      const list = (await A.browser.get('/members')).body as Row[];
      const s = list.find((m) => m.id === hindiMember)!;
      expect(s).toMatchObject({
        designation: 'PRT Hindi',
        loginPhone: `+91${hindiPhone}`,
        email: null,
      });
      const p = await A.browser.put(`/members/${hindiMember}/profile`, {
        designation: 'PRT Hindi',
        employeeCode: 'T-101',
      });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      expect(
        (
          await A.browser.put(`/members/${ctMember}/profile`, {
            designation: 'TGT',
            employeeCode: 'T-101',
          })
        ).status,
      ).toBe(409);
      expect(
        (await hindi.put(`/members/${ctMember}/profile`, { designation: 'Boss' })).status,
      ).toBe(403);
    });
  });

  describe('who teaches what', () => {
    it('shows the chart: classes, sections and their subjects', async () => {
      const g = await A.browser.get(`/teaching/grid?campusId=${A.campusId}`);
      expect(g.status, JSON.stringify(g.body)).toBe(200);
      expect(g.body.classes.map((c: Row) => c.name)).toEqual(['Class 1', 'Class 3']);
      expect(g.body.classes[0].subjects.map((s: Row) => s.name).sort()).toEqual([
        'English',
        'Hindi',
      ]);
      expect(g.body.teachers.map((t: Row) => t.fullName)).toEqual(
        expect.arrayContaining(['Sushma Rao', 'Anil Mehta']),
      );
      expect((await B.browser.get(`/teaching/grid?campusId=${A.campusId}`)).status).toBe(404);
    });

    it('assigns the Hindi teacher to Class 1 A and Class 3 B only', async () => {
      for (const s of ['1A', '3B']) {
        const r = await A.browser.put('/teaching/cell', {
          sectionId: sections[s],
          subjectId: subj.Hindi,
          membershipIds: [hindiMember],
        });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
      }
      // Science is not taught in Class 1.
      expect(
        (
          await A.browser.put('/teaching/cell', {
            sectionId: sections['1A'],
            subjectId: subj.Science,
            membershipIds: [hindiMember],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await hindi.put('/teaching/cell', {
            sectionId: sections['1B'],
            subjectId: subj.Hindi,
            membershipIds: [hindiMember],
          })
        ).status,
      ).toBe(403);
      expect([403, 404]).toContain(
        (
          await B.browser.put('/teaching/cell', {
            sectionId: sections['1B'],
            subjectId: subj.Hindi,
            membershipIds: [],
          })
        ).status,
      );
      const cls = await A.browser.patch(`/sections/${sections['3B']}`, {
        classTeacherMembershipId: ctMember,
      });
      expect(cls.status, JSON.stringify(cls.body)).toBe(200);
      const g = (await A.browser.get(`/teaching/grid?campusId=${A.campusId}`)).body;
      expect(g.assignments).toHaveLength(2);
      expect(g.teachers.find((t: Row) => t.membershipId === hindiMember).periods).toBe(2);
      expect(g.teachers.find((t: Row) => t.membershipId === ctMember).classTeacherOf).toBe(1);
    });

    it('clearing a cell removes the teacher', async () => {
      await A.browser.put('/teaching/cell', {
        sectionId: sections['3A'],
        subjectId: subj.English,
        membershipIds: [ctMember],
      });
      await A.browser.put('/teaching/cell', {
        sectionId: sections['3A'],
        subjectId: subj.English,
        membershipIds: [],
      });
      expect(
        (await A.browser.get(`/teaching/grid?campusId=${A.campusId}`)).body.assignments,
      ).toHaveLength(2);
    });
  });

  describe('a teacher sees only their own classes', () => {
    it('the Hindi teacher sees Class 1 A and Class 3 B, with Hindi', async () => {
      const m = await hindi.get('/teaching/mine');
      expect(m.status).toBe(200);
      expect(m.body.sections.map((s: Row) => `${s.className} ${s.sectionName}`)).toEqual([
        'Class 1 A',
        'Class 3 B',
      ]);
      expect(m.body.sections[0]).toMatchObject({
        isClassTeacher: false,
        subjects: [{ name: 'Hindi' }],
        students: 1,
      });
    });

    it('subject teachers get the class list but not parents or profiles', async () => {
      const r = await hindi.get(`/teaching/sections/${sections['3B']}/students`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ role: 'subject_teacher', canOpenProfiles: false });
      expect(r.body.students[0].firstName).toBe('Kidp2');
      expect(r.body.students[0].parentPhone).toBeUndefined();
      expect((await hindi.get(`/teaching/sections/${sections['3A']}/students`)).status).toBe(404);
      expect((await hindi.get(`/students/${kids.p2}`)).status).toBe(404);
      expect((await hindi.get('/students')).body.items ?? []).toHaveLength(0);
    });

    it('the class teacher gets parents and full profiles of their section only', async () => {
      const m = await ct.get('/teaching/mine');
      expect(m.body.sections).toEqual([
        expect.objectContaining({
          className: 'Class 3',
          sectionName: 'B',
          isClassTeacher: true,
          attendanceTaken: false,
        }),
      ]);
      const r = await ct.get(`/teaching/sections/${sections['3B']}/students`);
      expect(r.body).toMatchObject({ role: 'class_teacher', canOpenProfiles: true });
      expect(r.body.students[0].parentPhone).toMatch(/^\+91/);
      expect((await ct.get(`/students/${kids.p2}`)).status).toBe(200);
      expect((await ct.get(`/students/${kids.p3}`)).status).toBe(404);
    });

    it('other schools cannot read the class list', async () => {
      expect((await B.browser.get(`/teaching/sections/${sections['3B']}/students`)).status).toBe(
        404,
      );
      expect((await B.browser.get('/teaching/mine')).body.sections).toEqual([]);
    });
  });

  describe('one mobile, many roles', () => {
    it('a staff link stops working once the number has a password elsewhere', async () => {
      const phone = `92${n}`;
      const inv = await inviteByPhone(phone, 'Rekha Joshi', 'PRT');
      // The same number is a parent; the parent link sets the password first.
      const g = (
        await A.browser.post('/students', {
          firstName: 'Ishita',
          lastName: 'Joshi',
          dateOfBirth: '2018-03-03',
          gender: 'female',
          sectionId: sections['1B'],
          admissionDate: `${y0}-04-01`,
          guardians: [{ fullName: 'Rekha Joshi', phone, relationship: 'mother', isPrimary: true }],
          privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
        })
      ).body;
      const guardianId = (await A.browser.get(`/students/${g.id}/portal-access`)).body.guardians[0]
        .id;
      const pl = await A.browser.post('/portal/invites', { guardianId });
      const p = new Browser(app);
      const peek = await p.post('/portal/activate/peek', { token: tokenOf(pl.body.url) });
      expect(peek.body.hasAccount).toBe(false);
      expect(
        (
          await p.post('/portal/activate', {
            token: tokenOf(pl.body.url),
            password: 'rekha mother 99',
          })
        ).status,
      ).toBe(200);
      const late = await new Browser(app).post('/auth/invite/accept', {
        token: tokenOf(inv.link!.url),
        password: 'someone else 1234',
      });
      expect(late.status).toBe(409);
      // She signs in with her own password and is staff and parent at once.
      const b = new Browser(app);
      expect((await b.post('/auth/login', { phone, password: 'rekha mother 99' })).status).toBe(
        200,
      );
      expect((await b.get('/family')).body.children).toHaveLength(1);
    });

    it('inviting a number that already has an account gives access without a link', async () => {
      const guardianId = (await A.browser.get(`/students/${kids.p1}/portal-access`)).body
        .guardians[0].id;
      const pl = await A.browser.post('/portal/invites', { guardianId });
      await new Browser(app).post('/portal/activate', {
        token: tokenOf(pl.body.url),
        password: 'parent p1 pass',
      });
      const inv = await inviteByPhone(`95${n.slice(0, 6)}10`, 'Parent p1', 'Driver');
      expect(inv).toMatchObject({ status: 'active', link: null });
    });
  });
});
