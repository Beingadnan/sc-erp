import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openOwnerPool, prepareDatabase } from '@school-erp/db/testing';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';
import { todayIn } from '../src/attendance/attendance.service.js';

type Row = { id: string; [k: string]: unknown };
const DAY = 86_400_000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const R = (rupees: number) => rupees * 100;
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

/** Phase 7a: parent portal accounts, sign-in by mobile, and the family's own view. */
describe('Phase 7a: parent portal (e2e)', () => {
  let app: INestApplication;
  let owner: Pool;
  let A: School;
  let B: School;
  let teacher: Browser;
  let accountant: Browser;
  const today = todayIn('Asia/Kolkata');
  const yStart =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const startsOn = `${yStart}-04-01`;
  const phone = `98${String(Date.now()).slice(-8)}`;
  const otherPhone = `97${String(Date.now()).slice(-8)}`;
  const kids: string[] = [];
  let bKid: string;
  let sectionId: string;
  let guardianId: string;
  let parent: Browser;

  const roleId = async (s: School, k: string) =>
    ((await s.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === k,
    )!.id;

  const staff = async (s: School, roleKey: string) => {
    const email = `${unique('staff')}@example.test`;
    await s.browser.post('/members/invite', {
      email,
      fullName: `Staff ${roleKey}`,
      assignments: [{ roleId: await roleId(s, roleKey), campusId: s.campusId }],
    });
    const browser = new Browser(app);
    await browser.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
    return browser;
  };

  const setup = async (s: School, names: string[], guardian: Array<Record<string, unknown>>) => {
    const year = (
      await s.browser.post('/academic-years', {
        campusId: s.campusId,
        name: `${yStart}-${(yStart + 1) % 100}`,
        startsOn,
        endsOn: `${yStart + 1}-03-31`,
      })
    ).body;
    await s.browser.post(`/academic-years/${year.id}/set-current`, {});
    const cls = (
      await s.browser.post('/classes', {
        campusId: s.campusId,
        code: '3',
        name: 'Class 3',
        stage: 'primary',
        sortOrder: 13,
      })
    ).body;
    const sec = (
      await s.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: cls.id,
        name: 'A',
      })
    ).body;
    const ids: string[] = [];
    for (const [i, n] of names.entries()) {
      const res = await s.browser.post('/students', {
        firstName: n,
        lastName: 'Sharma',
        dateOfBirth: '2017-05-10',
        gender: 'female',
        sectionId: sec.id,
        admissionDate: startsOn,
        guardians: [guardian[i]],
        privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      ids.push(res.body.id);
    }
    const head = (
      await s.browser.post('/fees/heads', { code: 'TUI', name: 'Tuition fee', category: 'tuition' })
    ).body;
    const st = (
      await s.browser.post('/fees/structures', {
        campusId: s.campusId,
        academicYearId: year.id,
        name: 'Class 3 fees',
        kind: 'class',
        gradeLevelIds: [cls.id],
      })
    ).body;
    await s.browser.put(`/fees/structures/${st.id}/plan`, {
      installments: [
        {
          label: 'Term 1',
          dueOn: shift(today, -5),
          items: [{ feeHeadId: head.id, amount: R(8000) }],
        },
      ],
    });
    await s.browser.post(`/fees/structures/${st.id}/status`, { status: 'published' });
    await s.browser.post('/fees/demands/generate', { structureId: st.id });
    return { ids, sectionId: sec.id as string };
  };

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    owner = openOwnerPool();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    const mother = { fullName: 'Sunita Sharma', phone, relationship: 'mother', isPrimary: true };
    const first = await setup(A, ['Riya'], [mother]);
    kids.push(first.ids[0]!);
    sectionId = first.sectionId;
    const g = (await A.browser.get(`/students/${kids[0]}/portal-access`)).body.guardians[0];
    guardianId = g.id;
    // A sibling linked to the same guardian, and an unrelated child.
    const sib = await A.browser.post('/students', {
      firstName: 'Kabir',
      lastName: 'Sharma',
      dateOfBirth: '2015-02-01',
      gender: 'male',
      sectionId,
      admissionDate: startsOn,
      guardians: [{ guardianId, relationship: 'mother', isPrimary: true }],
      privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
    });
    expect(sib.status, JSON.stringify(sib.body)).toBe(201);
    kids.push(sib.body.id);
    const other = await A.browser.post('/students', {
      firstName: 'Zoya',
      lastName: 'Khan',
      dateOfBirth: '2016-02-01',
      gender: 'female',
      sectionId,
      admissionDate: startsOn,
      guardians: [
        { fullName: 'Imran Khan', phone: otherPhone, relationship: 'father', isPrimary: true },
      ],
      privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
    });
    kids.push(other.body.id);
    await A.browser.post('/fees/demands/generate', {
      structureId: (await A.browser.get(`/fees/structures?campusId=${A.campusId}`)).body[0]?.id,
    });
    const bSetup = await setup(
      B,
      ['Aditi'],
      [{ fullName: 'Sunita Sharma', phone, relationship: 'mother', isPrimary: true }],
    );
    bKid = bSetup.ids[0]!;
    teacher = await staff(A, 'teacher');
    accountant = await staff(A, 'accountant');
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('giving access', () => {
    it('shows each guardian with no access yet', async () => {
      const res = await A.browser.get(`/students/${kids[0]}/portal-access`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        canManage: true,
        guardians: [{ status: 'none', phone: `+91${phone}` }],
      });
      expect((await B.browser.get(`/students/${kids[0]}/portal-access`)).status).toBe(404);
    });

    it('teachers cannot hand out access; other schools cannot see the guardian', async () => {
      expect((await teacher.post('/portal/invites', { guardianId })).status).toBe(403);
      expect([403, 404]).toContain(
        (await B.browser.post('/portal/invites', { guardianId })).status,
      );
    });

    it('a parent activates with the link and sets a password', async () => {
      const inv = await A.browser.post('/portal/invites', { guardianId });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      expect(inv.body.message).toContain('Riya');
      const token = tokenOf(inv.body.url);
      const status = await A.browser.get(`/students/${kids[0]}/portal-access`);
      expect(status.body.guardians[0].status).toBe('invited');

      parent = new Browser(app);
      const peek = await parent.post('/portal/activate/peek', { token });
      expect(peek.status).toBe(200);
      expect(peek.body).toMatchObject({
        status: 'open',
        purpose: 'activate',
        hasAccount: false,
        guardianFirstName: 'Sunita',
      });
      expect(peek.body.phone).not.toContain(phone.slice(2, 6));
      expect((await parent.post('/portal/activate', { token, password: 'short' })).status).toBe(
        422,
      );
      const ok = await parent.post('/portal/activate', { token, password: 'riya mother 2026' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(
        (await new Browser(app).post('/portal/activate', { token, password: 'riya mother 2026' }))
          .status,
      ).toBe(422);
      const after = await A.browser.get(`/students/${kids[0]}/portal-access`);
      expect(after.body.guardians[0]).toMatchObject({
        status: 'active',
        loginPhone: `+91${phone}`,
      });
    });

    it('parents do not appear among staff members', async () => {
      const members = (await A.browser.get('/members')).body as Array<{ fullName: string }>;
      expect(members.some((m) => m.fullName === 'Sunita Sharma')).toBe(false);
    });
  });

  describe('the family view', () => {
    it('lists only their own children', async () => {
      const res = await parent.get('/family');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.children.map((c: Row) => c.firstName).sort()).toEqual(['Kabir', 'Riya']);
      expect(res.body.children.find((c: Row) => c.firstName === 'Riya')).toMatchObject({
        className: 'Class 3',
        sectionName: 'A',
        outstanding: R(8000),
        due: R(8000),
      });
    });

    it('cannot use staff screens or see other children', async () => {
      expect((await parent.get('/students')).status).toBe(403);
      expect((await parent.get(`/fees/students/${kids[0]}`)).status).toBe(403);
      expect((await parent.get(`/family/children/${kids[2]}/fees`)).status).toBe(404);
      expect((await parent.get(`/family/children/${kids[2]}/attendance`)).status).toBe(404);
      expect((await parent.get(`/family/children/${bKid}/fees`)).status).toBe(404);
      expect((await A.browser.get('/family')).status).toBe(403);
    });

    it('shows attendance marked by the school', async () => {
      const reg = (
        await A.browser.get(`/attendance/sections/${sectionId}/register?date=${today}&period=0`)
      ).body;
      const records = reg.students.map((s: { enrollmentId: string; studentId: string }) => ({
        enrollmentId: s.enrollmentId,
        status: s.studentId === kids[0] ? 'absent' : 'present',
      }));
      const saved = await A.browser.put(
        `/attendance/sections/${sectionId}/register?date=${today}&period=0`,
        { records },
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const att = await parent.get(`/family/children/${kids[0]}/attendance`);
      expect(att.status, JSON.stringify(att.body)).toBe(200);
      expect(att.body.totals).toMatchObject({ days: 1, absent: 1 });
      expect(att.body.records).toEqual([{ date: today, status: 'absent', remark: '' }]);
      const home = await parent.get('/family');
      expect(home.body.children.find((c: Row) => c.id === kids[0]).todayAttendance).toBe('absent');
    });

    it('shows dues and receipts, and serves only their receipts', async () => {
      const pay = await accountant.post('/fees/payments', {
        studentId: kids[0],
        mode: 'cash',
        amount: R(3000),
        idempotencyKey: `k-${Date.now()}`,
      });
      expect(pay.status).toBe(201);
      const other = await accountant.post('/fees/payments', {
        studentId: kids[2],
        mode: 'cash',
        amount: R(1000),
        idempotencyKey: `k2-${Date.now()}`,
      });
      const f = await parent.get(`/family/children/${kids[0]}/fees`);
      expect(f.status, JSON.stringify(f.body)).toBe(200);
      expect(f.body.totals).toMatchObject({ paid: R(3000), balance: R(5000) });
      expect(f.body.demands[0]).toMatchObject({ label: 'Class 3 fees · Term 1', balance: R(5000) });
      expect(f.body.receipts).toHaveLength(1);
      expect(f.body.canPayOnline).toBe(false);
      const pdf = await parent.get(`/family/receipts/${pay.body.id}/receipt.pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((await parent.get(`/family/receipts/${other.body.id}/receipt.pdf`)).status).toBe(404);
    });

    it('pays to the school account through a link of their own', async () => {
      expect((await parent.post(`/family/children/${kids[0]}/pay`, {})).status).toBe(409);
      const set = await A.browser.put('/fees/payment-settings', {
        campusId: A.campusId,
        payeeName: 'School A',
        upiId: 'schoola@okhdfcbank',
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      const res = await parent.post(`/family/children/${kids[0]}/pay`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.amount).toBe(R(5000));
      const view = await parent.get(`/public/pay/${res.body.token}`);
      expect(view.body).toMatchObject({ status: 'open', studentFirstName: 'Riya' });
      expect((await parent.post(`/family/children/${kids[2]}/pay`, {})).status).toBe(404);
    });
  });

  describe('signing in', () => {
    it('signs in with the mobile number', async () => {
      const b = new Browser(app);
      expect((await b.post('/auth/login', { phone, password: 'wrong password' })).status).toBe(401);
      const res = await b.post('/auth/login', { phone: `0${phone}`, password: 'riya mother 2026' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const me = await b.get('/auth/me');
      expect(me.body.user).toMatchObject({ email: null, loginPhone: `+91${phone}` });
      expect((await b.get('/family')).status).toBe(200);
      expect((await b.post('/auth/login', { password: 'x' })).status).toBe(422);
    });

    it('parents and staff use different sign-in pages', async () => {
      const b = new Browser(app);
      expect(
        (await b.post('/auth/login', { phone, password: 'riya mother 2026', as: 'staff' })).status,
      ).toBe(403);
      expect(
        (await b.post('/auth/login', { phone, password: 'riya mother 2026', as: 'parent' })).status,
      ).toBe(200);
      expect((await b.get('/family')).status).toBe(200);
      const t = new Browser(app);
      const staffLogin = { email: A.email, password: A.password };
      expect((await t.post('/auth/login', { ...staffLogin, as: 'parent' })).status).toBe(403);
      expect((await t.post('/auth/login', { ...staffLogin, as: 'staff' })).status).toBe(200);
      // A wrong password still says only "wrong email/mobile or password".
      expect(
        (await t.post('/auth/login', { phone, password: 'nope nope', as: 'staff' })).status,
      ).toBe(401);
    });

    it('the same parent at another school joins with their existing password', async () => {
      const g = (await B.browser.get(`/students/${bKid}/portal-access`)).body.guardians[0];
      const inv = await B.browser.post('/portal/invites', { guardianId: g.id });
      const token = tokenOf(inv.body.url);
      const p = new Browser(app);
      expect((await p.post('/portal/activate/peek', { token })).body.hasAccount).toBe(true);
      expect(
        (await p.post('/portal/activate', { token, password: 'not my password 1' })).status,
      ).toBe(401);
      expect(
        (await p.post('/portal/activate', { token, password: 'riya mother 2026' })).status,
      ).toBe(200);
      const home = await p.get('/family');
      expect(home.body.children.map((c: Row) => c.firstName)).toEqual(['Aditi']);
      const me = await p.get('/auth/me');
      expect(me.body.tenants).toHaveLength(2);
      // Shared across schools: neither school may reset that password.
      const reset = await A.browser.post('/portal/invites', { guardianId, purpose: 'reset' });
      expect(reset.status).toBe(409);
    });

    it('a school-only parent account can be reset by the school', async () => {
      const g = (await A.browser.get(`/students/${kids[2]}/portal-access`)).body.guardians[0];
      expect(
        (await A.browser.post('/portal/invites', { guardianId: g.id, purpose: 'reset' })).status,
      ).toBe(409);
      const inv = await A.browser.post('/portal/invites', { guardianId: g.id });
      const dad = new Browser(app);
      await dad.post('/portal/activate', {
        token: tokenOf(inv.body.url),
        password: 'zoya father 11',
      });
      expect((await A.browser.post('/portal/invites', { guardianId: g.id })).status).toBe(409);
      const reset = await A.browser.post('/portal/invites', { guardianId: g.id, purpose: 'reset' });
      expect(reset.status, JSON.stringify(reset.body)).toBe(201);
      const token = tokenOf(reset.body.url);
      expect((await dad.post('/portal/activate/peek', { token })).body).toMatchObject({
        purpose: 'reset',
      });
      expect(
        (await new Browser(app).post('/portal/activate', { token, password: 'zoya father 22' }))
          .status,
      ).toBe(200);
      // The old session was signed out; the new password works, the old one does not.
      expect((await dad.get('/family')).status).toBe(401);
      const b = new Browser(app);
      expect(
        (await b.post('/auth/login', { phone: otherPhone, password: 'zoya father 11' })).status,
      ).toBe(401);
      expect(
        (await b.post('/auth/login', { phone: otherPhone, password: 'zoya father 22' })).status,
      ).toBe(200);
      expect((await b.get('/family')).body.children.map((c: Row) => c.firstName)).toEqual(['Zoya']);
    });

    it('removing access takes the children away at once', async () => {
      const g = (await A.browser.get(`/students/${kids[2]}/portal-access`)).body.guardians[0];
      const b = new Browser(app);
      await b.post('/auth/login', { phone: otherPhone, password: 'zoya father 22' });
      const res = await A.browser.post(`/portal/guardians/${g.id}/revoke`, {});
      expect(res.status).toBe(200);
      expect([401, 403]).toContain((await b.get('/family')).status);
      const s = await A.browser.get(`/students/${kids[2]}/portal-access`);
      expect(s.body.guardians[0].status).toBe('none');
    });
  });

  describe('database guards', () => {
    it('tokens are hashed and invites cannot be rewritten by the app', async () => {
      const q = async (s: string) => (await owner.query(s)).rows[0].ok as boolean;
      expect(
        await q(
          `select has_column_privilege('erp_app', 'portal_invites', 'token_hash', 'SELECT') as ok`,
        ),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'portal_invites', 'consumed_at', 'UPDATE') as ok`,
        ),
      ).toBe(false);
      expect(
        await q(`select has_column_privilege('erp_app', 'guardians', 'user_id', 'UPDATE') as ok`),
      ).toBe(false);
      expect(
        await q(`select has_column_privilege('erp_app', 'users', 'login_phone', 'UPDATE') as ok`),
      ).toBe(false);
    });
  });
});
