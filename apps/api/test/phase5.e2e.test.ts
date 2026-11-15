import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openOwnerPool, prepareDatabase } from '@school-erp/db/testing';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';
import { todayIn } from '../src/attendance/attendance.service.js';

type Row = { id: string; [k: string]: unknown };
type RegisterStudent = {
  enrollmentId: string;
  studentId: string;
  status: string;
  onLeave: boolean;
};

const DAY = 86_400_000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Phase 5: attendance (ATT-01…06). */
describe('Phase 5: attendance (e2e)', () => {
  let app: INestApplication;
  let owner: Pool;
  let A: School;
  let B: School;
  let year: Row;
  let secA: Row;
  let secB: Row;
  let bSection: Row;
  let teacher: { browser: Browser; membershipId: string };
  let receptionist: { browser: Browser; membershipId: string };
  const today = todayIn('Asia/Kolkata');
  const yStart =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const startsOn = `${yStart}-04-01`;
  // Dates in the past that are still inside the year (the year starts 1 April).
  const d = (back: number) => shift(today, -back);
  const holiday = d(4);
  let phone = 0;

  const roleId = async (s: School, key: string) =>
    ((await s.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === key,
    )!.id;

  const staff = async (s: School, roleKey: string) => {
    const email = `${unique('staff')}@example.test`;
    const res = await s.browser.post('/members/invite', {
      email,
      fullName: `Staff ${roleKey}`,
      assignments: [{ roleId: await roleId(s, roleKey), campusId: s.campusId }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const browser = new Browser(app);
    await browser.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
    return { browser, membershipId: res.body.id as string };
  };

  const admit = (s: School, sectionId: string, i: number) =>
    s.browser.post('/students', {
      firstName: `Kid${String(i).padStart(2, '0')}`,
      lastName: unique('x').slice(-5),
      dateOfBirth: '2018-05-10',
      gender: i % 2 ? 'female' : 'male',
      sectionId,
      admissionDate: startsOn,
      guardians: [
        {
          fullName: 'Parent',
          phone: `96${String(10000000 + ++phone).slice(-8)}`,
          relationship: 'mother',
          isPrimary: true,
        },
      ],
      privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
    });

  const setup = async (s: School) => {
    const y = (
      await s.browser.post('/academic-years', {
        campusId: s.campusId,
        name: `${yStart}-${(yStart + 1) % 100}`,
        startsOn,
        endsOn: `${yStart + 1}-03-31`,
        weeklyOffDays: [],
      })
    ).body as Row;
    const cls = (
      await s.browser.post('/classes', {
        campusId: s.campusId,
        code: '5',
        name: 'Class 5',
        stage: 'primary',
        sortOrder: 15,
      })
    ).body as Row;
    const mk = async (name: string) =>
      (await s.browser.post('/sections', { academicYearId: y.id, gradeLevelId: cls.id, name }))
        .body as Row;
    return { y, a: await mk('A'), b: await mk('B') };
  };

  const register = (b: Browser, sectionId: string, date: string, period = 0) =>
    b.get(`/attendance/sections/${sectionId}/register?date=${date}&period=${period}`);
  const save = (
    b: Browser,
    sectionId: string,
    date: string,
    records: Array<{ enrollmentId: string; status: string; remark?: string }>,
    extra: Record<string, unknown> = {},
    period = 0,
  ) =>
    b.put(`/attendance/sections/${sectionId}/register?date=${date}&period=${period}`, {
      records,
      ...extra,
    });
  const all = (
    students: RegisterStudent[],
    status = 'present',
    overrides: Record<number, string> = {},
  ) => students.map((x, i) => ({ enrollmentId: x.enrollmentId, status: overrides[i] ?? status }));

  let roster: RegisterStudent[] = [];

  /** Owner-role query inside A's tenant (tables use FORCE row-level security). */
  const asA = async (text: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [A.tenantId]);
      const res = await client.query(text, params);
      await client.query('commit');
      return res;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    owner = openOwnerPool();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    const a = await setup(A);
    year = a.y;
    secA = a.a;
    secB = a.b;
    bSection = (await setup(B)).a;
    teacher = await staff(A, 'teacher');
    receptionist = await staff(A, 'receptionist');
    await A.browser.patch(`/sections/${secA.id}`, {
      classTeacherMembershipId: teacher.membershipId,
    });
    for (let i = 1; i <= 45; i++) {
      const res = await admit(A, secA.id, i);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    await admit(A, secB.id, 1);
    await admit(B, bSection.id, 1);
    await A.browser.post('/calendar', {
      campusId: null,
      title: 'Local festival',
      kind: 'holiday',
      startsOn: holiday,
      endsOn: holiday,
    });
  }, 120_000);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('settings', () => {
    it('returns defaults and lets attendance managers change them', async () => {
      const def = await teacher.browser.get(`/attendance/settings?campusId=${A.campusId}`);
      expect(def.status).toBe(200);
      expect(def.body).toMatchObject({ mode: 'daily', cutoffHours: 12, lowThreshold: 75 });
      const bad = await teacher.browser.put(`/attendance/settings?campusId=${A.campusId}`, {
        ...def.body,
        lowThreshold: 80,
      });
      expect(bad.status).toBe(403);
      const ok = await A.browser.put(`/attendance/settings?campusId=${A.campusId}`, {
        ...def.body,
        lowThreshold: 80,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await B.browser.get(`/attendance/settings?campusId=${A.campusId}`)).status).toBe(404);
    });
  });

  describe('marking (ATT-01, ATT-02)', () => {
    it('shows the class teacher a full register defaulting to present', async () => {
      const res = await register(teacher.browser, secA.id, today);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.canEdit).toBe(true);
      expect(res.body.session).toBeNull();
      roster = res.body.students;
      expect(roster).toHaveLength(45);
      expect(roster.every((x) => x.status === 'present')).toBe(true);
    });

    it('saves 45 students in under a second and emits absence events', async () => {
      const t0 = Date.now();
      const res = await save(
        teacher.browser,
        secA.id,
        today,
        all(roster, 'present', { 0: 'absent', 1: 'absent', 2: 'late', 3: 'late' }),
      );
      const took = Date.now() - t0;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(took).toBeLessThan(1000);
      expect(res.body.counts).toEqual({ present: 41, absent: 2, late: 2 });
      const ev = await asA(
        `select payload from outbox_events where tenant_id = $1 and event_type = 'attendance.absent'`,
        [A.tenantId],
      );
      expect(ev.rows).toHaveLength(2);
      expect(ev.rows[0].payload).toMatchObject({ sectionId: secA.id, date: today });

      // Saving again within the cut-off changes freely and doesn't repeat events.
      const again = await save(
        teacher.browser,
        secA.id,
        today,
        all(roster, 'present', { 0: 'absent', 1: 'present', 2: 'late', 3: 'late' }),
      );
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ created: false, changed: 1, corrected: 0 });
      const ev2 = await asA(
        `select count(*)::int as n from outbox_events where tenant_id = $1 and event_type = 'attendance.absent'`,
        [A.tenantId],
      );
      expect(ev2.rows[0].n).toBe(2);
      const after = await register(teacher.browser, secA.id, today);
      expect(after.body.session.markedBy).toBe('Staff teacher');
      expect(
        (after.body.students as RegisterStudent[]).filter((x) => x.status === 'absent'),
      ).toHaveLength(1);
    });

    it('refuses incomplete registers, future dates and holidays', async () => {
      const missing = await save(teacher.browser, secA.id, today, all(roster).slice(1));
      expect(missing.status).toBe(422);
      expect(missing.body.error.message).toMatch(/1 not marked/);
      const stranger = await save(teacher.browser, secA.id, today, [
        ...all(roster).slice(1),
        { enrollmentId: '01920000-0000-7000-8000-000000000001', status: 'present' },
      ]);
      expect(stranger.status).toBe(422);
      expect((await save(A.browser, secA.id, shift(today, 1), all(roster))).status).toBe(422);
      const hol = await save(A.browser, secA.id, holiday, all(roster));
      expect(hol.status).toBe(422);
      expect(hol.body.error.message).toMatch(/holiday \(Local festival\)/);
      const view = await register(A.browser, secA.id, holiday);
      expect(view.body).toMatchObject({
        canEdit: false,
        day: { working: false, reason: 'holiday' },
      });
    });

    it('lets teachers mark only their own sections, and other schools see nothing', async () => {
      expect((await register(teacher.browser, secB.id, today)).status).toBe(404);
      const b = (await register(A.browser, secB.id, today)).body.students as RegisterStudent[];
      expect((await save(teacher.browser, secB.id, today, all(b))).status).toBe(404);
      // Receptionists may look but not mark.
      expect((await register(receptionist.browser, secA.id, today)).body.canEdit).toBe(false);
      expect((await save(receptionist.browser, secA.id, today, all(roster))).status).toBe(403);
      expect((await register(B.browser, secA.id, today)).status).toBe(404);
      expect((await save(B.browser, secA.id, today, all(roster))).status).toBe(404);
    });

    it('takes period registers when the campus is in period mode', async () => {
      const cur = (await A.browser.get(`/attendance/settings?campusId=${A.campusId}`)).body;
      await A.browser.put(`/attendance/settings?campusId=${A.campusId}`, {
        ...cur,
        mode: 'period',
        periodsPerDay: 6,
      });
      expect((await register(teacher.browser, secA.id, today, 0)).status).toBe(422);
      expect((await register(teacher.browser, secA.id, today, 7)).status).toBe(422);
      const p3 = await save(teacher.browser, secA.id, today, all(roster), {}, 3);
      expect(p3.status, JSON.stringify(p3.body)).toBe(200);
      await A.browser.put(`/attendance/settings?campusId=${A.campusId}`, cur);
    });
  });

  describe('cut-off and corrections (ATT-03)', () => {
    it('closes the register after the cut-off; corrections need the right and a reason', async () => {
      await asA(
        `update attendance_sessions set marked_at = now() - interval '13 hours'
         where section_id = $1 and on_date = $2 and period = 0`,
        [secA.id, today],
      );
      const reg = await register(teacher.browser, secA.id, today);
      expect(reg.body).toMatchObject({ locked: true, canEdit: false });
      const records = all(roster, 'present', { 0: 'present', 2: 'late', 3: 'late' });
      expect((await save(teacher.browser, secA.id, today, records)).status).toBe(403);

      const noReason = await save(A.browser, secA.id, today, records);
      expect(noReason.status).toBe(422);
      expect(noReason.body.error.message).toMatch(/reason/);
      const ok = await save(A.browser, secA.id, today, records, {
        reason: 'Arrived with parent at 9:10',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.corrected).toBe(1);

      const hist = await A.browser.get(
        `/attendance/sections/${secA.id}/history?date=${today}&period=0`,
      );
      expect(hist.body).toHaveLength(1);
      expect(hist.body[0]).toMatchObject({
        fromStatus: 'absent',
        toStatus: 'present',
        reason: 'Arrived with parent at 9:10',
      });
    });

    it('a register never taken closes after its day; only correctors can fill it late', async () => {
      const old = d(6);
      expect((await register(teacher.browser, secA.id, old)).body.canEdit).toBe(false);
      expect((await save(teacher.browser, secA.id, old, all(roster))).status).toBe(403);
      const late = await save(A.browser, secA.id, old, all(roster, 'present', { 5: 'absent' }));
      expect(late.status).toBe(200);
      expect(late.body.corrected).toBe(0);
    });

    it('keeps history append-only at the database level', async () => {
      const q = async (sql: string) => (await owner.query(sql)).rows[0].ok as boolean;
      expect(
        await q(`select has_table_privilege('erp_app', 'student_attendance', 'DELETE') as ok`),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'student_attendance', 'on_date', 'UPDATE') as ok`,
        ),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'student_attendance', 'status', 'UPDATE') as ok`,
        ),
      ).toBe(true);
      expect(
        await q(`select has_table_privilege('erp_app', 'attendance_corrections', 'UPDATE') as ok`),
      ).toBe(false);
      expect(
        await q(`select has_table_privilege('erp_app', 'attendance_corrections', 'DELETE') as ok`),
      ).toBe(false);
    });
  });

  describe('leave (ATT-04)', () => {
    let leaveId: string;

    it('the class teacher records and approves leave; marked days turn to leave', async () => {
      // Student 5 was marked absent on d(6) above.
      const kid = roster[5]!;
      const res = await teacher.browser.post('/attendance/leave', {
        studentId: kid.studentId,
        fromDate: d(7),
        toDate: d(6),
        reason: 'Family function in village',
        requestedVia: 'phone',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ status: 'pending', days: 2 });
      leaveId = res.body.id;

      const overlap = await A.browser.post('/attendance/leave', {
        studentId: kid.studentId,
        fromDate: d(6),
        toDate: d(5),
        reason: 'Duplicate',
      });
      expect(overlap.status).toBe(409);

      const list = await receptionist.browser.get(
        `/attendance/leave?campusId=${A.campusId}&status=pending`,
      );
      expect(list.body.map((l: Row) => l.id)).toContain(leaveId);
      expect(list.body.find((l: Row) => l.id === leaveId).canDecide).toBe(false);
      expect(
        (
          await receptionist.browser.post(`/attendance/leave/${leaveId}/decision`, {
            status: 'approved',
          })
        ).status,
      ).toBe(403);
      expect(
        (await B.browser.post(`/attendance/leave/${leaveId}/decision`, { status: 'approved' }))
          .status,
      ).toBe(404);
      expect(
        (
          await teacher.browser.post(`/attendance/leave/${leaveId}/decision`, {
            status: 'rejected',
          })
        ).status,
      ).toBe(422);

      const ok = await teacher.browser.post(`/attendance/leave/${leaveId}/decision`, {
        status: 'approved',
        note: 'OK',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.recordsChanged).toBe(1);
      const reg = await register(A.browser, secA.id, d(6));
      // Registers keep Absent (three marks only); the day gets an "On leave" note.
      expect((reg.body.students as RegisterStudent[])[5]).toMatchObject({
        status: 'absent',
        remark: 'On leave',
        onLeave: true,
      });
      // A day not yet marked defaults to absent, on leave.
      const unmarked = await register(A.browser, secA.id, d(7));
      expect((unmarked.body.students as RegisterStudent[])[5]).toMatchObject({
        status: 'absent',
        remark: 'On leave',
        marked: false,
      });
      expect(
        (
          await teacher.browser.post(`/attendance/leave/${leaveId}/decision`, {
            status: 'approved',
          })
        ).status,
      ).toBe(409);
    });

    it('cancelling approved leave clears the leave note', async () => {
      const res = await A.browser.post(`/attendance/leave/${leaveId}/decision`, {
        status: 'cancelled',
        note: 'Came to school',
      });
      expect(res.status).toBe(200);
      expect(res.body.recordsChanged).toBe(1);
      const reg = await register(A.browser, secA.id, d(6));
      expect((reg.body.students as RegisterStudent[])[5]).toMatchObject({
        status: 'absent',
        remark: '',
      });
    });

    it('teachers cannot record leave for other sections', async () => {
      const other = (
        (await register(A.browser, secB.id, today)).body.students as RegisterStudent[]
      )[0]!;
      const res = await teacher.browser.post('/attendance/leave', {
        studentId: other.studentId,
        fromDate: today,
        toDate: today,
        reason: 'Fever',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('reports (ATT-05)', () => {
    it('monthly register with per-student percentages', async () => {
      const month = d(6).slice(0, 7);
      const res = await teacher.browser.get(`/attendance/sections/${secA.id}/month?month=${month}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.students).toHaveLength(45);
      expect(res.body.markedDates).toContain(d(6));
      const kid5 = res.body.students[5];
      expect(kid5.days[d(6)]).toBe('absent');
      expect(res.body.days.find((x: Row) => x.date === holiday)?.reason ?? 'holiday').toBe(
        'holiday',
      );
      expect(
        (await teacher.browser.get(`/attendance/sections/${secB.id}/month?month=${month}`)).status,
      ).toBe(404);
    });

    it('student summary and the low-attendance list', async () => {
      const kid = roster[5]!;
      const sum = await teacher.browser.get(`/attendance/students/${kid.studentId}`);
      expect(sum.status, JSON.stringify(sum.body)).toBe(200);
      // Two registers: today present, d(6) absent → 50%.
      expect(sum.body.totals).toMatchObject({ days: 2, absent: 1, percent: 50 });
      expect(sum.body.low).toBe(true);
      expect(sum.body.leaves).toHaveLength(1);

      const low = await A.browser.get(
        `/attendance/low?campusId=${A.campusId}&academicYearId=${year.id}`,
      );
      expect(low.status).toBe(200);
      expect(low.body.threshold).toBe(80);
      const ids = low.body.students.map((x: Row) => x.studentId);
      expect(ids).toContain(kid.studentId);
      expect(ids).not.toContain(roster[10]!.studentId);
      const strict = await A.browser.get(
        `/attendance/low?campusId=${A.campusId}&academicYearId=${year.id}&threshold=40`,
      );
      expect(strict.body.students.map((x: Row) => x.studentId)).not.toContain(kid.studentId);
      expect((await B.browser.get(`/attendance/students/${kid.studentId}`)).status).toBe(404);
    });

    it('today overview: totals, and teachers see only their sections', async () => {
      const res = await A.browser.get(`/attendance/today?campusId=${A.campusId}`);
      expect(res.status).toBe(200);
      expect(res.body.totals).toMatchObject({ sections: 2, marked: 1, students: 46 });
      const row = res.body.sections.find((x: Row) => x.sectionId === secA.id);
      expect(row.counts).toMatchObject({ absent: 0, late: 2, present: 43 });
      expect(row.periodsMarked).toEqual([3]);
      const mine = await teacher.browser.get(`/attendance/today?campusId=${A.campusId}`);
      expect(mine.body.sections.map((x: Row) => x.sectionId)).toEqual([secA.id]);
      expect((await B.browser.get(`/attendance/today?campusId=${A.campusId}`)).status).toBe(404);
    });
  });
});
