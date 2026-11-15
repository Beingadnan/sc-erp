import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { todayIn } from '../src/attendance/attendance.service.js';
import { Browser, registerSchool, startApp } from './support.js';
import type { School } from './support.js';

type Row = { [k: string]: unknown };
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

/** Phase 11: exams, date sheet, marks entry by subject teachers, results, report cards. */
describe('Phase 11: exams and results (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  const today = todayIn('Asia/Kolkata');
  const y0 =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const n = String(Date.now()).slice(-8);
  let secA: string;
  let secB: string;
  let gradeId: string;
  const subj: Record<string, string> = {};
  const t: Record<string, Browser> = {};
  const kids: string[] = [];
  const enr: string[] = [];
  let parent: Browser;
  let examId: string;
  const paper: Record<string, string> = {};

  const roleId = async (k: string) =>
    ((await A.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === k,
    )!.id;

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
      ['HIN', 'Hindi'],
      ['ENG', 'English'],
      ['MAT', 'Mathematics'],
      ['SKT', 'Sanskrit'],
    ] as const) {
      subj[name] = (await A.browser.post('/subjects', { code, name })).body.id;
    }
    gradeId = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: '5',
        name: 'Class 5',
        stage: 'primary',
        sortOrder: 15,
      })
    ).body.id;
    await A.browser.put(`/classes/${gradeId}/subjects`, {
      subjects: [
        { subjectId: subj.Hindi },
        { subjectId: subj.English },
        { subjectId: subj.Mathematics },
      ],
    });
    secA = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: gradeId,
        name: 'A',
      })
    ).body.id;
    secB = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: gradeId,
        name: 'B',
      })
    ).body.id;
    for (const [k, name, phone] of [
      ['hindi', 'Hindi Teacher', `81${n}`],
      ['english', 'English Teacher', `82${n}`],
    ] as const) {
      const inv = await A.browser.post('/members/invite', {
        phone,
        fullName: name,
        assignments: [{ roleId: await roleId('teacher'), campusId: A.campusId }],
      });
      const b = new Browser(app);
      await b.post('/auth/invite/accept', {
        token: tokenOf(inv.body.link.url),
        password: `${k} teacher pass 1`,
      });
      t[k] = b;
      if (k === 'hindi') {
        for (const s of [secA, secB])
          await A.browser.put('/teaching/cell', {
            sectionId: s,
            subjectId: subj.Hindi,
            membershipIds: [inv.body.id],
          });
      } else {
        await A.browser.put('/teaching/cell', {
          sectionId: secA,
          subjectId: subj.English,
          membershipIds: [inv.body.id],
        });
        await A.browser.patch(`/sections/${secA}`, { classTeacherMembershipId: inv.body.id });
      }
    }
    for (const [i, [first, sec]] of (
      [
        ['Asha', secA],
        ['Bina', secA],
        ['Chetan', secA],
        ['Dev', secB],
      ] as const
    ).entries()) {
      const st = await A.browser.post('/students', {
        firstName: first,
        lastName: 'Kumar',
        dateOfBirth: '2016-05-05',
        gender: i % 2 ? 'male' : 'female',
        sectionId: sec,
        rollNumber: i + 1,
        admissionDate: `${y0}-04-01`,
        guardians: [
          {
            fullName: `${first} Parent`,
            phone: `9${i}${n}`,
            relationship: 'father',
            isPrimary: true,
          },
        ],
        privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
      });
      kids.push(st.body.id);
    }
    const g = (await A.browser.get(`/students/${kids[0]}/portal-access`)).body.guardians[0];
    const link = await A.browser.post('/portal/invites', { guardianId: g.id });
    parent = new Browser(app);
    await parent.post('/portal/activate', {
      token: tokenOf(link.body.url),
      password: 'asha parent 22',
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the office creates an exam; teachers cannot', async () => {
    expect(
      (await t.hindi!.post('/exams', { campusId: A.campusId, name: 'Half-yearly' })).status,
    ).toBe(403);
    const r = await A.browser.post('/exams', {
      campusId: A.campusId,
      name: 'Half-yearly',
      startsOn: `${y0}-09-20`,
      endsOn: `${y0}-09-30`,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    examId = r.body.id;
    expect(
      (await A.browser.post('/exams', { campusId: A.campusId, name: 'Half-yearly' })).status,
    ).toBe(409);
    expect((await A.browser.post(`/exams/${examId}/status`, { status: 'open' })).status).toBe(409);
    expect((await B.browser.get(`/exams/${examId}`)).status).toBe(404);
  });

  it('sets the date sheet with maximum and pass marks', async () => {
    expect(
      (
        await A.browser.put(`/exams/${examId}/papers`, {
          gradeLevelId: gradeId,
          papers: [{ subjectId: subj.Sanskrit, maxMarks: 80, passMarks: 27 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await A.browser.put(`/exams/${examId}/papers`, {
          gradeLevelId: gradeId,
          papers: [{ subjectId: subj.Hindi, maxMarks: 20, passMarks: 30 }],
        })
      ).status,
    ).toBe(422);
    const r = await A.browser.put(`/exams/${examId}/papers`, {
      gradeLevelId: gradeId,
      papers: [
        {
          subjectId: subj.Hindi,
          maxMarks: 80,
          passMarks: 27,
          examDate: `${y0}-09-21`,
          startsAt: '09:00',
        },
        { subjectId: subj.English, maxMarks: 80, passMarks: 27, examDate: `${y0}-09-23` },
        { subjectId: subj.Mathematics, maxMarks: 100, passMarks: 33, examDate: `${y0}-09-25` },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    for (const p of r.body.papers as Array<{ id: string; subjectName: string }>)
      paper[p.subjectName] = p.id;
    const d = await A.browser.get(`/exams/${examId}`);
    const cls = d.body.classes.find((c: Row) => c.id === gradeId);
    expect(cls.papers).toHaveLength(3);
    expect(d.body.progress).toHaveLength(6);
  });

  it('marks wait until the exam is opened; teachers see only their own subjects and classes', async () => {
    expect(
      (await t.hindi!.put(`/exams/papers/${paper.Hindi}/sections/${secA}`, { marks: [] })).status,
    ).toBe(409);
    expect((await t.hindi!.get('/exams/marks/mine')).body.items).toEqual([]);
    expect((await A.browser.post(`/exams/${examId}/status`, { status: 'open' })).status).toBe(200);
    const mine = (await t.hindi!.get('/exams/marks/mine')).body.items;
    expect(mine.map((x: Row) => `${x.subjectName} ${x.sectionName}`)).toEqual([
      'Hindi A',
      'Hindi B',
    ]);
    expect((await t.english!.get('/exams/marks/mine')).body.items).toHaveLength(1);
  });

  it('a subject teacher enters marks, then hands them in', async () => {
    const sheet = await t.hindi!.get(`/exams/papers/${paper.Hindi}/sections/${secA}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.canEdit).toBe(true);
    for (const s of sheet.body.students as Array<{ enrollmentId: string }>)
      enr.push(s.enrollmentId);
    expect(
      (
        await t.hindi!.put(`/exams/papers/${paper.Hindi}/sections/${secA}`, {
          marks: [{ enrollmentId: enr[0], marks: 81 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await t.hindi!.put(`/exams/papers/${paper.English}/sections/${secA}`, {
          marks: [{ enrollmentId: enr[0], marks: 50 }],
        })
      ).status,
    ).toBe(403);
    const save = await t.hindi!.put(`/exams/papers/${paper.Hindi}/sections/${secA}`, {
      marks: [
        { enrollmentId: enr[0], marks: 72.5 },
        { enrollmentId: enr[1], marks: 20 },
      ],
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    const early = await t.hindi!.post(`/exams/papers/${paper.Hindi}/sections/${secA}/submit`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/1 student has no marks/);
    await t.hindi!.put(`/exams/papers/${paper.Hindi}/sections/${secA}`, {
      marks: [{ enrollmentId: enr[2], status: 'absent' }],
    });
    expect(
      (await t.hindi!.post(`/exams/papers/${paper.Hindi}/sections/${secA}/submit`, {})).status,
    ).toBe(201);
    expect(
      (
        await t.hindi!.put(`/exams/papers/${paper.Hindi}/sections/${secA}`, {
          marks: [{ enrollmentId: enr[1], marks: 30 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await t.hindi!.post(`/exams/papers/${paper.Hindi}/sections/${secA}/reopen`, {})).status,
    ).toBe(403);
    expect(
      (await A.browser.post(`/exams/papers/${paper.Hindi}/sections/${secA}/reopen`, {})).status,
    ).toBe(201);
    expect(
      (
        await t.hindi!.put(`/exams/papers/${paper.Hindi}/sections/${secA}`, {
          marks: [{ enrollmentId: enr[1], marks: 30 }],
        })
      ).status,
    ).toBe(200);
    // English (class teacher) and Maths (no teacher: the office enters).
    await t.english!.put(`/exams/papers/${paper.English}/sections/${secA}`, {
      marks: [
        { enrollmentId: enr[0], marks: 76 },
        { enrollmentId: enr[1], marks: 40 },
        { enrollmentId: enr[2], marks: 55 },
      ],
    });
    const maths = await A.browser.put(`/exams/papers/${paper.Mathematics}/sections/${secA}`, {
      marks: [
        { enrollmentId: enr[0], marks: 98 },
        { enrollmentId: enr[1], marks: 25 },
        { enrollmentId: enr[2], marks: 61 },
      ],
    });
    expect(maths.status).toBe(200);
  });

  it('protects marks already entered when the date sheet changes', async () => {
    const base = [
      { subjectId: subj.Hindi, maxMarks: 80, passMarks: 27 },
      { subjectId: subj.English, maxMarks: 80, passMarks: 27 },
    ];
    const drop = await A.browser.put(`/exams/${examId}/papers`, {
      gradeLevelId: gradeId,
      papers: base,
    });
    expect(drop.status).toBe(409);
    expect(drop.body.error.message).toMatch(/Mathematics already has marks/);
    const lower = await A.browser.put(`/exams/${examId}/papers`, {
      gradeLevelId: gradeId,
      papers: [...base, { subjectId: subj.Mathematics, maxMarks: 50, passMarks: 17 }],
    });
    expect(lower.status).toBe(409);
    expect((await A.browser.post(`/exams/${examId}/status`, { status: 'draft' })).status).toBe(409);
  });

  it('works out totals, grades and rank for the class teacher', async () => {
    expect((await t.hindi!.get(`/exams/${examId}/sections/${secA}/results`)).status).toBe(403);
    const r = await t.english!.get(`/exams/${examId}/sections/${secA}/results`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [asha, bina, chetan] = r.body.results;
    // Asha: 72.5 + 76 + 98 = 246.5 / 260 = 94.81% → A1, rank 1
    expect(asha).toMatchObject({
      total: 246.5,
      maxTotal: 260,
      percent: 94.81,
      grade: 'A1',
      rank: 1,
      failedIn: [],
    });
    expect(asha.subjects[0]).toMatchObject({
      subjectName: 'Hindi',
      marks: 72.5,
      grade: 'A2',
      passed: true,
    });
    // Bina: 30 + 40 + 25 = 95 / 260 = 36.54% → D; failed Maths (25 < 33)
    expect(bina).toMatchObject({
      total: 95,
      percent: 36.54,
      grade: 'D',
      rank: 3,
      failedIn: ['Mathematics'],
    });
    // Chetan: absent in Hindi counts as 0 of 80 and a fail.
    expect(chetan).toMatchObject({
      total: 116,
      maxTotal: 260,
      percent: 44.62,
      grade: 'C2',
      rank: 2,
      failedIn: ['Hindi'],
    });
    expect(chetan.subjects[0]).toMatchObject({ status: 'absent', marks: null, grade: null });
    expect(r.body.summary).toMatchObject({ students: 3, complete: 3, passed: 1 });
    const rem = await t.english!.put(`/exams/${examId}/sections/${secA}/remarks`, {
      remarks: [{ enrollmentId: enr[0], remark: 'Excellent work. Keep it up!' }],
    });
    expect(rem.status).toBe(200);
    expect(
      (await t.hindi!.put(`/exams/${examId}/sections/${secA}/remarks`, { remarks: [] })).status,
    ).toBe(403);
  });

  it('parents see results and the report card only after they are published', async () => {
    expect((await parent.get(`/family/children/${kids[0]}/results`)).body.items).toEqual([]);
    expect(
      (await parent.get(`/family/children/${kids[0]}/results/${examId}/report-card.pdf`)).status,
    ).toBe(404);
    const staffPdf = await t.english!.get(`/exams/${examId}/students/${kids[0]}/report-card.pdf`);
    expect(staffPdf.status).toBe(200);
    expect(staffPdf.headers['content-type']).toMatch(/pdf/);
    expect(
      (await t.hindi!.get(`/exams/${examId}/students/${kids[0]}/report-card.pdf`)).status,
    ).toBe(404);

    expect((await t.english!.post(`/exams/${examId}/status`, { status: 'published' })).status).toBe(
      403,
    );
    expect((await A.browser.post(`/exams/${examId}/status`, { status: 'published' })).status).toBe(
      200,
    );
    const res = await parent.get(`/family/children/${kids[0]}/results`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      examName: 'Half-yearly',
      percent: 94.81,
      grade: 'A1',
      rank: 1,
      classSize: 3,
      remark: 'Excellent work. Keep it up!',
    });
    expect(res.body.items[0].subjects[0].paperId).toBeUndefined();
    const pdf = await parent.get(`/family/children/${kids[0]}/results/${examId}/report-card.pdf`);
    expect(pdf.status).toBe(200);
    expect((await parent.get(`/family/children/${kids[1]}/results`)).status).toBe(404);

    // Published results are locked; taking them back reopens editing.
    expect(
      (
        await A.browser.put(`/exams/papers/${paper.Mathematics}/sections/${secA}`, {
          marks: [{ enrollmentId: enr[1], marks: 26 }],
        })
      ).status,
    ).toBe(409);
    expect((await A.browser.post(`/exams/${examId}/status`, { status: 'open' })).status).toBe(200);
    expect((await parent.get(`/family/children/${kids[0]}/results`)).body.items).toEqual([]);
    expect((await A.browser.delete(`/exams/${examId}`)).status).toBe(409);
  });

  it('lists exams with marks progress', async () => {
    const l = await A.browser.get(`/exams?campusId=${A.campusId}`);
    expect(l.body.canManage).toBe(true);
    expect(l.body.items[0]).toMatchObject({
      name: 'Half-yearly',
      status: 'open',
      papers: 3,
      classes: 1,
      toSubmit: 6,
    });
    const other = await A.browser.post('/exams', { campusId: A.campusId, name: 'Periodic Test 1' });
    expect((await A.browser.delete(`/exams/${other.body.id}`)).status).toBe(200);
  });
});
