import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };

/**
 * Phase 3a: academic years, terms, classes, sections, subjects, calendar and grading.
 * Two schools (A = CBSE, B = RBSE). Cross-school checks are security tests.
 */
describe('Phase 3a: school structure (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  let campus2: string; // second campus of school A
  let yearA: Row;
  let classA1: Row;
  let sectionA: Row;

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
    expect(res.status).toBe(201);
    const browser = new Browser(app);
    const ok = await browser.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
    expect(ok.status).toBe(201);
    return { browser, membershipId: res.body.id as string };
  };

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    const c2 = await A.browser.post('/campuses', {
      code: 'C2',
      name: 'Second Campus',
      board: 'CBSE',
    });
    expect(c2.status).toBe(201);
    campus2 = c2.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('starter template', () => {
    it('creates classes, subjects, grading scales and class subjects for a CBSE school', async () => {
      const res = await A.browser.post('/academic/setup-template', {
        campusId: A.campusId,
        board: 'CBSE',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        classesCreated: 15,
        subjectsCreated: 11,
        gradingScalesCreated: 2,
      });
      expect(res.body.classSubjectsCreated).toBeGreaterThan(60);

      const classes = (await A.browser.get(`/classes?campusId=${A.campusId}`)).body as Row[];
      expect(classes.map((c) => c.name)).toEqual([
        'Nursery',
        'LKG',
        'UKG',
        ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`),
      ]);
      classA1 = classes.find((c) => c.code === '1')!;
      const subjects = (await A.browser.get(`/classes/${classA1.id}/subjects`)).body as Row[];
      expect(subjects.map((s) => s.code)).toEqual([
        'ENG',
        'HIN',
        'MATH',
        'EVS',
        'COMP',
        'ART',
        'HPE',
      ]);
      expect(subjects.find((s) => s.code === 'COMP')!.isOptional).toBe(true);

      const scales = (await A.browser.get('/grading-scales')).body as Array<{
        id: string;
        name: string;
        bands: Array<{ label: string; minPercent: number; gradePoint: number | null }>;
      }>;
      const cbse = scales.find((s) => s.name.startsWith('CBSE'))!;
      expect(cbse.bands.map((b) => b.label)).toEqual([
        'A1',
        'A2',
        'B1',
        'B2',
        'C1',
        'C2',
        'D',
        'E',
      ]);
      expect(cbse.bands[0]).toMatchObject({ minPercent: 91, gradePoint: 10 });
      const class10 = classes.find((c) => c.code === '10')!;
      expect(class10.gradingScaleId).toBe(cbse.id);
    });

    it('is idempotent and uses the RBSE division scale for an RBSE school', async () => {
      const again = await A.browser.post('/academic/setup-template', {
        campusId: A.campusId,
        board: 'CBSE',
      });
      expect(again.body).toMatchObject({
        classesCreated: 0,
        classesSkipped: 15,
        subjectsCreated: 0,
        gradingScalesCreated: 0,
        classSubjectsCreated: 0,
      });
      const b = await B.browser.post('/academic/setup-template', {
        campusId: B.campusId,
        board: 'RBSE',
        includePrePrimary: false,
        highestClass: 10,
      });
      expect(b.body.classesCreated).toBe(10);
      const scales = (await B.browser.get('/grading-scales')).body as Array<{ name: string }>;
      expect(scales.map((s) => s.name).sort()).toEqual([
        '5-point descriptive (primary)',
        'RBSE divisions',
      ]);
    });

    it('cannot target another school’s campus', async () => {
      const res = await B.browser.post('/academic/setup-template', {
        campusId: A.campusId,
        board: 'RBSE',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('academic years and terms', () => {
    it('creates a year, rejects overlaps and duplicate names', async () => {
      const res = await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: '2026-27',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        saturdayOffWeeks: [2, 4],
      });
      expect(res.status).toBe(201);
      yearA = res.body;
      expect(yearA).toMatchObject({ status: 'planned', isCurrent: false, weeklyOffDays: [0] });

      const overlap = await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: '2027-28',
        startsOn: '2027-03-01',
        endsOn: '2028-02-28',
      });
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.details.reason).toBe('year_overlap');

      // Same dates on another campus are fine.
      const other = await A.browser.post('/academic-years', {
        campusId: campus2,
        name: '2026-27',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
      });
      expect(other.status).toBe(201);

      const backwards = await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: '2030-31',
        startsOn: '2031-03-31',
        endsOn: '2030-04-01',
      });
      expect(backwards.status).toBe(422);
    });

    it('keeps exactly one current year per campus', async () => {
      const next = await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: '2027-28',
        startsOn: '2027-04-01',
        endsOn: '2028-03-31',
      });
      expect(next.status).toBe(201);
      expect((await A.browser.post(`/academic-years/${yearA.id}/make-current`)).body).toMatchObject(
        {
          isCurrent: true,
          status: 'active',
        },
      );
      await A.browser.post(`/academic-years/${next.body.id}/make-current`);
      let years = (await A.browser.get(`/academic-years?campusId=${A.campusId}`)).body as Row[];
      expect(years.filter((y) => y.isCurrent).map((y) => y.name)).toEqual(['2027-28']);
      await A.browser.post(`/academic-years/${yearA.id}/make-current`);
      years = (await A.browser.get(`/academic-years?campusId=${A.campusId}`)).body as Row[];
      expect(years.filter((y) => y.isCurrent).map((y) => y.name)).toEqual(['2026-27']);
      // The unused planned year can be deleted.
      // (2027-28 became active when it was current, so it can no longer be deleted.)
      expect((await A.browser.delete(`/academic-years/${next.body.id}`)).status).toBe(409);
    });

    it('keeps terms inside the year and apart from each other', async () => {
      const t1 = await A.browser.post(`/academic-years/${yearA.id}/terms`, {
        name: 'Term 1',
        startsOn: '2026-04-01',
        endsOn: '2026-09-30',
      });
      expect(t1.status).toBe(201);
      const overlap = await A.browser.post(`/academic-years/${yearA.id}/terms`, {
        name: 'Term 2',
        startsOn: '2026-09-15',
        endsOn: '2027-03-31',
      });
      expect(overlap.status).toBe(409);
      const outside = await A.browser.post(`/academic-years/${yearA.id}/terms`, {
        name: 'Term 2',
        startsOn: '2026-10-01',
        endsOn: '2027-04-30',
      });
      expect(outside.status).toBe(422);
      const t2 = await A.browser.post(`/academic-years/${yearA.id}/terms`, {
        name: 'Term 2',
        startsOn: '2026-10-01',
        endsOn: '2027-03-31',
      });
      expect(t2.status).toBe(201);
      const shrink = await A.browser.patch(`/academic-years/${yearA.id}`, { endsOn: '2027-02-28' });
      expect(shrink.status).toBe(409);
      expect(shrink.body.error.details.reason).toBe('term_outside_year');
      const terms = (await A.browser.get(`/academic-years/${yearA.id}/terms`)).body as Row[];
      expect(terms.map((t) => t.name)).toEqual(['Term 1', 'Term 2']);
    });
  });

  describe('sections', () => {
    it('creates sections with capacity and a class teacher', async () => {
      const teacher = await staff(A, 'teacher', A.campusId);
      const res = await A.browser.post('/sections', {
        academicYearId: yearA.id,
        gradeLevelId: classA1.id,
        name: 'A',
        capacity: 40,
        classTeacherMembershipId: teacher.membershipId,
      });
      expect(res.status).toBe(201);
      sectionA = res.body;
      const dup = await A.browser.post('/sections', {
        academicYearId: yearA.id,
        gradeLevelId: classA1.id,
        name: 'A',
      });
      expect(dup.status).toBe(409);
      const list = (await A.browser.get(`/sections?academicYearId=${yearA.id}`)).body as Row[];
      expect(list[0]).toMatchObject({ name: 'A', capacity: 40, classTeacherName: 'Staff Member' });
      // Teachers can read the structure but not change it.
      expect((await teacher.browser.get(`/classes?campusId=${A.campusId}`)).status).toBe(200);
      expect(
        (
          await teacher.browser.post('/sections', {
            academicYearId: yearA.id,
            gradeLevelId: classA1.id,
            name: 'B',
          })
        ).status,
      ).toBe(403);
    });

    it('refuses to mix a year of one campus with a class of another', async () => {
      const c2Class = await A.browser.post('/classes', {
        campusId: campus2,
        code: '1',
        name: 'Class 1',
        stage: 'primary',
      });
      expect(c2Class.status).toBe(201);
      const res = await A.browser.post('/sections', {
        academicYearId: yearA.id,
        gradeLevelId: c2Class.body.id,
        name: 'Z',
      });
      expect(res.status).toBe(422);
    });

    it('locks a closed year and lets the owner reopen it', async () => {
      expect(
        (await A.browser.post(`/academic-years/${yearA.id}/status`, { status: 'closed' })).body,
      ).toMatchObject({
        status: 'closed',
        isCurrent: false,
      });
      const blocked = await A.browser.post('/sections', {
        academicYearId: yearA.id,
        gradeLevelId: classA1.id,
        name: 'B',
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details.reason).toBe('year_closed');
      expect((await A.browser.patch(`/sections/${sectionA.id}`, { capacity: 45 })).status).toBe(
        409,
      );
      expect(
        (await A.browser.post(`/academic-years/${yearA.id}/status`, { status: 'active' })).status,
      ).toBe(200);
      expect(
        (await A.browser.patch(`/sections/${sectionA.id}`, { capacity: 45 })).body.capacity,
      ).toBe(45);
    });
  });

  describe('calendar and working days', () => {
    it('counts working days from weekly offs, Saturday rules and holidays', async () => {
      // November 2026: 30 days, 5 Sundays (1, 8, 15, 22, 29); 2nd and 4th Saturdays are 14 and 28.
      const holiday = await A.browser.post('/calendar', {
        campusId: null,
        title: 'Diwali break',
        kind: 'vacation',
        startsOn: '2026-11-09',
        endsOn: '2026-11-11',
      });
      expect(holiday.status).toBe(201);
      await A.browser.post('/calendar', {
        campusId: A.campusId,
        title: 'Sports day',
        kind: 'event',
        startsOn: '2026-11-20',
      });
      const res = await A.browser.get(
        `/calendar/working-days?campusId=${A.campusId}&from=2026-11-01&to=2026-11-30`,
      );
      expect(res.status).toBe(200);
      expect(res.body.workingDays).toBe(30 - 5 - 2 - 3);
      const day = (d: string) => res.body.days.find((x: { date: string }) => x.date === d);
      expect(day('2026-11-14')).toMatchObject({ working: false, reason: 'saturday_off' });
      expect(day('2026-11-21')).toMatchObject({ working: true });
      expect(day('2026-11-10')).toMatchObject({
        working: false,
        reason: 'holiday',
        title: 'Diwali break',
      });
      expect(day('2026-11-20')).toMatchObject({ working: true });

      const outside = await A.browser.get(
        `/calendar/working-days?campusId=${A.campusId}&from=2026-03-30&to=2026-04-01`,
      );
      expect(outside.body.days[0]).toMatchObject({ working: false, reason: 'outside_year' });

      const list = (
        await A.browser.get(`/calendar?campusId=${A.campusId}&from=2026-11-01&to=2026-11-30`)
      ).body as Row[];
      expect(list.map((e) => e.title)).toEqual(['Diwali break', 'Sports day']);
    });

    it('limits campus-scoped staff to their campus', async () => {
      const principal = await staff(A, 'principal', campus2);
      expect(
        (
          await principal.browser.post('/calendar', {
            campusId: campus2,
            title: 'PTM',
            kind: 'event',
            startsOn: '2026-12-05',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await principal.browser.post('/calendar', {
            campusId: A.campusId,
            title: 'PTM',
            kind: 'event',
            startsOn: '2026-12-05',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await principal.browser.post('/calendar', {
            campusId: null,
            title: 'PTM',
            kind: 'event',
            startsOn: '2026-12-05',
          })
        ).status,
      ).toBe(403);
      expect((await principal.browser.get(`/classes?campusId=${A.campusId}`)).status).toBe(404);
      expect((await principal.browser.get(`/classes?campusId=${campus2}`)).status).toBe(200);
      // Subjects and grading scales are school-wide.
      expect(
        (await principal.browser.post('/subjects', { code: 'GK', name: 'General Knowledge' }))
          .status,
      ).toBe(403);
    });
  });

  describe('grading scales', () => {
    it('rejects overlapping bands and protects scales in use', async () => {
      const bad = await A.browser.post('/grading-scales', {
        name: 'Broken',
        bands: [
          { label: 'A', minPercent: 50, maxPercent: 100 },
          { label: 'B', minPercent: 0, maxPercent: 50 },
        ],
      });
      expect(bad.status).toBe(422);
      const scales = (await A.browser.get('/grading-scales')).body as Row[];
      const cbse = scales.find((s) => (s.name as string).startsWith('CBSE'))!;
      const del = await A.browser.delete(`/grading-scales/${cbse.id}`);
      expect(del.status).toBe(409);
      const ok = await A.browser.post('/grading-scales', {
        name: 'Pass / fail',
        bands: [
          { label: 'P', minPercent: 33, maxPercent: 100 },
          { label: 'F', minPercent: 0, maxPercent: 32.99 },
        ],
      });
      expect(ok.status).toBe(201);
      expect((await A.browser.delete(`/grading-scales/${ok.body.id}`)).status).toBe(204);
    });
  });

  describe('isolation between schools', () => {
    it('hides every structure record of school A from school B', async () => {
      const scaleA = ((await A.browser.get('/grading-scales')).body as Row[])[0]!;
      const subjectA = ((await A.browser.get('/subjects')).body as Row[])[0]!;
      const eventA = (
        (await A.browser.get(`/calendar?campusId=${A.campusId}&from=2026-11-01&to=2026-11-30`))
          .body as Row[]
      )[0]!;
      const classB = ((await B.browser.get(`/classes?campusId=${B.campusId}`)).body as Row[])[0]!;
      const b = B.browser;
      const statuses = {
        classes: (await b.get(`/classes?campusId=${A.campusId}`)).status,
        years: (await b.get(`/academic-years?campusId=${A.campusId}`)).status,
        terms: (await b.get(`/academic-years/${yearA.id}/terms`)).status,
        sections: (await b.get(`/sections?academicYearId=${yearA.id}`)).status,
        classSubjects: (await b.get(`/classes/${classA1.id}/subjects`)).status,
        calendar: (await b.get(`/calendar?campusId=${A.campusId}&from=2026-11-01&to=2026-11-30`))
          .status,
        workingDays: (
          await b.get(`/calendar/working-days?campusId=${A.campusId}&from=2026-11-01&to=2026-11-30`)
        ).status,
        editYear: (await b.patch(`/academic-years/${yearA.id}`, { name: 'Hacked' })).status,
        closeYear: (await b.post(`/academic-years/${yearA.id}/status`, { status: 'closed' }))
          .status,
        editClass: (await b.patch(`/classes/${classA1.id}`, { name: 'Hacked' })).status,
        editSection: (await b.patch(`/sections/${sectionA.id}`, { name: 'Z' })).status,
        deleteSection: (await b.delete(`/sections/${sectionA.id}`)).status,
        sectionInAYear: (
          await b.post('/sections', {
            academicYearId: yearA.id,
            gradeLevelId: classB.id,
            name: 'X',
          })
        ).status,
        editSubject: (await b.patch(`/subjects/${subjectA.id}`, { name: 'Hacked' })).status,
        useASubject: (
          await b.put(`/classes/${classB.id}/subjects`, { subjects: [{ subjectId: subjectA.id }] })
        ).status,
        editScale: (await b.patch(`/grading-scales/${scaleA.id}`, { name: 'Hacked' })).status,
        deleteScale: (await b.delete(`/grading-scales/${scaleA.id}`)).status,
        classWithAScale: (await b.patch(`/classes/${classB.id}`, { gradingScaleId: scaleA.id }))
          .status,
        editEvent: (await b.patch(`/calendar/${eventA.id}`, { title: 'Hacked' })).status,
        deleteEvent: (await b.delete(`/calendar/${eventA.id}`)).status,
        yearOnACampus: (
          await b.post('/academic-years', {
            campusId: A.campusId,
            name: '2040-41',
            startsOn: '2040-04-01',
            endsOn: '2041-03-31',
          })
        ).status,
        classOnACampus: (
          await b.post('/classes', { campusId: A.campusId, code: 'X', name: 'X', stage: 'primary' })
        ).status,
        eventOnACampus: (
          await b.post('/calendar', {
            campusId: A.campusId,
            title: 'Injected holiday',
            kind: 'holiday',
            startsOn: '2026-12-01',
          })
        ).status,
      };
      expect(statuses).toEqual({
        yearOnACampus: 404,
        classOnACampus: 404,
        eventOnACampus: 404,
        classes: 404,
        years: 404,
        terms: 404,
        sections: 404,
        classSubjects: 404,
        calendar: 404,
        workingDays: 404,
        editYear: 404,
        closeYear: 404,
        editClass: 404,
        editSection: 404,
        deleteSection: 404,
        sectionInAYear: 404,
        editSubject: 404,
        useASubject: 404,
        editScale: 404,
        deleteScale: 404,
        classWithAScale: 404,
        editEvent: 404,
        deleteEvent: 404,
      });
      // School A's data is untouched.
      const subjects = (await A.browser.get('/subjects')).body as Row[];
      expect(subjects.some((s) => s.name === 'Hacked')).toBe(false);
    });

    it('records changes in the audit log with codes visible', async () => {
      const res = await A.browser.get('/audit-logs?entity=grade_level&limit=5');
      const created = (res.body.data as Array<{ action: string; diff: { code?: string } }>).find(
        (e) => e.action === 'class.created',
      );
      expect(created?.diff.code).toBe('1');
    });
  });
});
