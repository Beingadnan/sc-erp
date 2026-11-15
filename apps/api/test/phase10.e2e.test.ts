import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { todayIn } from '../src/attendance/attendance.service.js';
import { Browser, registerSchool, startApp } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
const DAY = 86_400_000;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Phase 10: bell, timetable, substitutions, homework, notices and parent leave. */
describe('Phase 10: daily classroom (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  const today = todayIn('Asia/Kolkata');
  const y0 =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  // The next Monday on or after today (inside the school year in all but the last week of March).
  const monday = (() => {
    let d = Date.parse(`${today}T00:00:00Z`);
    while (new Date(d).getUTCDay() !== 1) d += DAY;
    return new Date(d).toISOString().slice(0, 10);
  })();
  const n = String(Date.now()).slice(-8);
  const sec: Record<string, string> = {};
  const subj: Record<string, string> = {};
  const t: Record<string, { browser: Browser; id: string }> = {};
  let gradeId: string;
  let kid: string;
  let parent: Browser;
  let slots: Array<{ id: string; label: string; isBreak: boolean }>;

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
      ['P10HIN', 'Hindi'],
      ['P10ENG', 'English'],
      ['P10SCI', 'Science'],
    ] as const) {
      subj[name] = (await A.browser.post('/subjects', { code, name })).body.id;
    }
    const cls = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: '3',
        name: 'Class 3',
        stage: 'primary',
        sortOrder: 13,
      })
    ).body;
    gradeId = cls.id;
    await A.browser.put(`/classes/${cls.id}/subjects`, {
      subjects: [{ subjectId: subj.Hindi! }, { subjectId: subj.English! }],
    });
    for (const s of ['A', 'B']) {
      sec[s] = (
        await A.browser.post('/sections', {
          academicYearId: year.id,
          gradeLevelId: cls.id,
          name: s,
        })
      ).body.id;
    }
    for (const [k, name, phone] of [
      ['hindi', 'Hindi Teacher', `91${n}`],
      ['english', 'English Teacher', `92${n}`],
      ['free', 'Free Teacher', `93${n}`],
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
      t[k] = { browser: b, id: inv.body.id };
    }
    for (const s of ['A', 'B']) {
      await A.browser.put('/teaching/cell', {
        sectionId: sec[s],
        subjectId: subj.Hindi!,
        membershipIds: [t.hindi!.id],
      });
    }
    await A.browser.put('/teaching/cell', {
      sectionId: sec.A!,
      subjectId: subj.English!,
      membershipIds: [t.english!.id],
    });
    await A.browser.patch(`/sections/${sec.A!}`, { classTeacherMembershipId: t.english!.id });
    const st = await A.browser.post('/students', {
      firstName: 'Tara',
      lastName: 'Singh',
      dateOfBirth: '2017-02-02',
      gender: 'female',
      sectionId: sec.A!,
      admissionDate: `${y0}-04-01`,
      guardians: [
        { fullName: 'Tara Mother', phone: `94${n}`, relationship: 'mother', isPrimary: true },
      ],
      privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
    });
    kid = st.body.id;
    const g = (await A.browser.get(`/students/${kid}/portal-access`)).body.guardians[0];
    const link = await A.browser.post('/portal/invites', { guardianId: g.id });
    parent = new Browser(app);
    await parent.post('/portal/activate', {
      token: tokenOf(link.body.url),
      password: 'tara mother 22',
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('bell and timetable', () => {
    it('saves the school bell', async () => {
      const bad = await A.browser.put('/timetable/slots', {
        campusId: A.campusId,
        slots: [
          { label: 'P1', startsAt: '08:00', endsAt: '08:40' },
          { label: 'P2', startsAt: '08:30', endsAt: '09:10' },
        ],
      });
      expect(bad.status).toBe(422);
      const res = await A.browser.put('/timetable/slots', {
        campusId: A.campusId,
        slots: [
          { label: 'Period 1', startsAt: '08:00', endsAt: '08:40' },
          { label: 'Period 2', startsAt: '08:40', endsAt: '09:20' },
          { label: 'Lunch', startsAt: '09:20', endsAt: '09:50', isBreak: true },
          { label: 'Period 3', startsAt: '09:50', endsAt: '10:30' },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      slots = res.body.slots;
      expect(slots.map((s) => s.label)).toEqual(['Period 1', 'Period 2', 'Lunch', 'Period 3']);
      expect(
        (await t.hindi!.browser.put('/timetable/slots', { campusId: A.campusId, slots: [] }))
          .status,
      ).toBe(403);
      // Keeping ids keeps the periods; renaming works.
      const again = await A.browser.put('/timetable/slots', {
        campusId: A.campusId,
        slots: slots.map((s) => ({ ...s, label: s.label === 'Lunch' ? 'Lunch break' : s.label })),
      });
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.slots.map((s: Row) => s.id)).toEqual(slots.map((s) => s.id));
    });

    it('fills a timetable; the subject teacher comes from who-teaches-what', async () => {
      const p1 = slots[0]!.id;
      const r = await A.browser.put(`/timetable/sections/${sec.A!}/cell`, {
        weekday: 1,
        slotId: p1,
        subjectId: subj.Hindi!,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.membershipId).toBe(t.hindi!.id);
      const clash = await A.browser.put(`/timetable/sections/${sec.B!}/cell`, {
        weekday: 1,
        slotId: p1,
        subjectId: subj.Hindi!,
      });
      expect(clash.status).toBe(409);
      expect(clash.body.error.message).toMatch(
        /Hindi Teacher already teaches Class 3 A in Period 1 on Mon/,
      );
      const ok = await A.browser.put(`/timetable/sections/${sec.B!}/cell`, {
        weekday: 1,
        slotId: p1,
        subjectId: subj.English!,
        membershipId: t.english!.id,
      });
      expect(ok.status).toBe(200);
      expect(
        (
          await A.browser.put(`/timetable/sections/${sec.A!}/cell`, {
            weekday: 1,
            slotId: slots[2]!.id,
            subjectId: subj.Hindi!,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await A.browser.put(`/timetable/sections/${sec.A!}/cell`, {
            weekday: 2,
            slotId: p1,
            subjectId: subj.Science!,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await t.hindi!.browser.put(`/timetable/sections/${sec.A!}/cell`, {
            weekday: 2,
            slotId: p1,
            subjectId: subj.Hindi!,
          })
        ).status,
      ).toBe(403);
      expect([403, 404]).toContain((await B.browser.get(`/timetable/sections/${sec.A!}`)).status);
      const tt = await t.hindi!.browser.get(`/timetable/sections/${sec.A!}`);
      expect(tt.status).toBe(200);
      expect(tt.body.entries).toHaveLength(1);
    });

    it("shows a teacher's periods for the day", async () => {
      const m = await t.hindi!.browser.get(`/timetable/mine?date=${monday}`);
      expect(m.body.periods).toEqual([
        expect.objectContaining({
          label: 'Period 1',
          className: 'Class 3',
          sectionName: 'A',
          subjectName: 'Hindi',
          isCover: false,
        }),
      ]);
    });
  });

  describe('substitutions', () => {
    it('suggests only free teachers and records the cover', async () => {
      const day = await A.browser.get(
        `/timetable/teachers/${t.hindi!.id}/day?campusId=${A.campusId}&date=${monday}`,
      );
      expect(day.status, JSON.stringify(day.body)).toBe(200);
      const p = day.body.periods[0];
      const free = p.freeTeachers.map((f: Row) => f.fullName);
      expect(free).toContain('Free Teacher');
      expect(free).not.toContain('English Teacher');
      expect(
        (
          await A.browser.put('/timetable/substitutions', {
            onDate: monday,
            entryId: p.entryId,
            substituteMembershipId: t.english!.id,
          })
        ).status,
      ).toBe(409);
      const set = await A.browser.put('/timetable/substitutions', {
        onDate: monday,
        entryId: p.entryId,
        substituteMembershipId: t.free!.id,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      const cover = await t.free!.browser.get(`/timetable/mine?date=${monday}`);
      expect(cover.body.periods).toEqual([
        expect.objectContaining({
          isCover: true,
          absentTeacher: 'Hindi Teacher',
          subjectName: 'Hindi',
        }),
      ]);
      const own = await t.hindi!.browser.get(`/timetable/mine?date=${monday}`);
      expect(own.body.periods[0].coveredBy).toBe('Free Teacher');
      const tuesday = new Date(Date.parse(`${monday}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
      expect(
        (
          await A.browser.put('/timetable/substitutions', {
            onDate: tuesday,
            entryId: p.entryId,
            substituteMembershipId: t.free!.id,
          })
        ).status,
      ).toBe(422);
    });
  });

  describe('homework', () => {
    let hwId: string;
    it('a teacher gives homework only in their own subject', async () => {
      const ok = await t.hindi!.browser.upload(
        '/homework',
        {
          sectionId: sec.A!,
          subjectId: subj.Hindi!,
          title: 'Write 10 words',
          details: 'Page 12',
          dueOn: '',
        },
        { name: 'board.png', bytes: PNG },
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      hwId = ok.body.id;
      expect(
        (
          await t.hindi!.browser.upload(
            '/homework',
            { sectionId: sec.A!, subjectId: subj.English!, title: 'Not mine' },
            null,
          )
        ).status,
      ).toBe(403);
      expect([403, 404]).toContain(
        (
          await t.free!.browser.upload(
            '/homework',
            { sectionId: sec.A!, subjectId: subj.Hindi!, title: 'Nope' },
            null,
          )
        ).status,
      );
      expect(
        (
          await t.hindi!.browser.upload(
            '/homework',
            { sectionId: sec.A!, subjectId: subj.Hindi!, title: 'Old', dueOn: '2001-01-01' },
            null,
          )
        ).status,
      ).toBe(422);
    });

    it('the class teacher and the parent see it, with the photo', async () => {
      const list = await t.english!.browser.get(`/homework?sectionId=${sec.A!}`);
      expect(list.body.items[0]).toMatchObject({
        title: 'Write 10 words',
        subjectName: 'Hindi',
        teacherName: 'Hindi Teacher',
        canRemove: false,
      });
      const fam = await parent.get(`/family/children/${kid}/homework`);
      expect(fam.status).toBe(200);
      expect(fam.body.items[0].attachmentUrl).toBeTruthy();
      expect(fam.body.items[0].createdBy).toBeUndefined();
      expect((await t.english!.browser.delete(`/homework/${hwId}`)).status).toBe(403);
      expect((await t.hindi!.browser.delete(`/homework/${hwId}`)).status).toBe(200);
      expect((await parent.get(`/family/children/${kid}/homework`)).body.items).toEqual([]);
    });
  });

  describe('notices', () => {
    it('reach exactly the people they are for', async () => {
      expect((await t.hindi!.browser.post('/notices', { title: 'X', body: 'Y' })).status).toBe(403);
      const pta = (
        await A.browser.post('/notices', {
          title: 'PTM on Saturday',
          body: 'Parents of Class 3, please come at 10.',
          audience: 'parents',
          gradeLevelIds: [gradeId],
        })
      ).body;
      expect((await parent.get('/family/notices')).body.items).toEqual([]);
      expect((await A.browser.post(`/notices/${pta.id}/publish`, {})).status).toBe(200);
      const staffOnly = (
        await A.browser.post('/notices', {
          title: 'Staff meeting',
          body: '3 pm',
          audience: 'staff',
        })
      ).body;
      await A.browser.post(`/notices/${staffOnly.id}/publish`, {});
      const otherSection = (
        await A.browser.post('/notices', {
          title: '3 B trip',
          body: 'Zoo',
          audience: 'parents',
          sectionIds: [sec.B!],
        })
      ).body;
      await A.browser.post(`/notices/${otherSection.id}/publish`, {});
      const feed = (await parent.get('/family/notices')).body.items.map((x: Row) => x.title);
      expect(feed).toEqual(['PTM on Saturday']);
      const staff = (await t.hindi!.browser.get('/notices/feed')).body.items.map(
        (x: Row) => x.title,
      );
      expect(staff).toEqual(['Staff meeting']);
      expect((await parent.post(`/notices/${pta.id}/read`, {})).status).toBe(200);
      const list = (await A.browser.get('/notices')).body.items;
      expect(list.find((x: Row) => x.id === pta.id).reads).toBe(1);
      expect((await A.browser.post(`/notices/${pta.id}/archive`, {})).status).toBe(200);
      expect((await parent.get('/family/notices')).body.items).toEqual([]);
      expect((await B.browser.get('/notices')).body.items).toEqual([]);
    });
  });

  describe('parent leave requests', () => {
    it('a parent asks; the class teacher approves', async () => {
      const req = await parent.post(`/family/children/${kid}/leave`, {
        fromDate: monday,
        toDate: monday,
        reason: 'Family function',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      expect(req.body.status).toBe('pending');
      expect(
        (
          await parent.post(`/family/children/${kid}/leave`, {
            fromDate: monday,
            toDate: monday,
            reason: 'Again',
          })
        ).status,
      ).toBe(409);
      const list = await t.english!.browser.get(
        `/attendance/leave?campusId=${A.campusId}&status=pending`,
      );
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const item = (list.body.items ?? list.body).find((x: Row) => x.id === req.body.id);
      expect(item).toMatchObject({ requestedVia: 'parent_app' });
      expect(
        (
          await t.english!.browser.post(`/attendance/leave/${req.body.id}/decision`, {
            status: 'approved',
          })
        ).status,
      ).toBe(200);
      expect((await parent.post(`/family/leave/${req.body.id}/cancel`, {})).status).toBe(409);
      const att = await parent.get(`/family/children/${kid}/attendance`);
      expect(att.body.leaves[0]).toMatchObject({ status: 'approved' });
    });

    it('a pending request can be withdrawn by the parent', async () => {
      const tue = new Date(Date.parse(`${monday}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
      const req = await parent.post(`/family/children/${kid}/leave`, {
        fromDate: tue,
        toDate: tue,
        reason: 'Doctor visit',
      });
      expect((await parent.post(`/family/leave/${req.body.id}/cancel`, {})).status).toBe(200);
      expect(
        (
          await parent.post(`/family/children/${kid}/leave`, {
            fromDate: '2001-01-01',
            toDate: '2001-01-02',
            reason: 'Old',
          })
        ).status,
      ).toBe(422);
    });
  });
});
