import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '@school-erp/db/testing';
import { todayIn } from '../src/attendance/attendance.service.js';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';

type Row = { id: string; [k: string]: unknown };
const R = (rupees: number) => rupees * 100;
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));

/** Phase 9b: old fee balances — previous dues and advance brought in from old records. */
describe('Phase 9b: old fee balances (e2e)', () => {
  let app: INestApplication;
  let A: School;
  let B: School;
  let accountant: Browser;
  const today = todayIn('Asia/Kolkata');
  const y0 =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const kids: Array<{ id: string; adm: string }> = [];
  let first: string;

  const upload = (s: School, bytes: Buffer) =>
    s.browser.upload(
      `/opening-balances?campusId=${s.campusId}`,
      {},
      { name: 'balances.csv', bytes },
    );
  const account = async (i: number) => (await A.browser.get(`/fees/students/${kids[i]!.id}`)).body;
  const trial = async () => {
    const tb = (await A.browser.get(`/fees/accounts?campusId=${A.campusId}`)).body;
    expect(tb.totals.debit).toBe(tb.totals.credit);
    return Object.fromEntries(
      (tb.accounts as Array<{ systemKey: string | null; balance: number }>)
        .filter((a) => a.systemKey)
        .map((a) => [a.systemKey, a.balance]),
    );
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
    const cls = (
      await A.browser.post('/classes', {
        campusId: A.campusId,
        code: '4',
        name: 'Class 4',
        stage: 'primary',
        sortOrder: 14,
      })
    ).body;
    const sec = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: cls.id,
        name: 'A',
      })
    ).body;
    for (let i = 0; i < 3; i++) {
      const r = await A.browser.post('/students', {
        firstName: `Old${i}`,
        lastName: 'Gupta',
        dateOfBirth: '2016-01-01',
        gender: 'male',
        sectionId: sec.id,
        admissionDate: `${y0}-04-01`,
        guardians: [
          {
            fullName: `P${i}`,
            phone: `98${String(Date.now()).slice(-7)}${i}`,
            relationship: 'father',
            isPrimary: true,
          },
        ],
        privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      kids.push({ id: r.body.id, adm: r.body.admissionNumber });
    }
    const roles = (await A.browser.get('/roles')).body as Array<{ key: string; id: string }>;
    const email = `${unique('acc')}@example.test`;
    await A.browser.post('/members/invite', {
      email,
      fullName: 'Accountant',
      assignments: [
        { roleId: roles.find((r) => r.key === 'accountant')!.id, campusId: A.campusId },
      ],
    });
    accountant = new Browser(app);
    await accountant.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('gives a CSV template', async () => {
    const res = await A.browser.get('/opening-balances/template');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admission no,Name,Previous dues,Advance');
  });

  it('marks rows it cannot use', async () => {
    const res = await upload(
      A,
      csv([
        ['Admission no', 'Name', 'Previous dues', 'Advance'],
        ['NOPE-1', 'X', '100', '0'],
        [kids[0]!.adm, '', 'abc', '0'],
        ['', 'Y', '10', '0'],
      ]),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.problems.map((p: Row) => p.row)).toEqual([2, 3, 4]);
    expect((await A.browser.post(`/opening-balances/${res.body.id}/apply`, {})).status).toBe(409);
  });

  it('previews and imports dues and advance', async () => {
    const res = await upload(
      A,
      csv([
        ['Adm No', 'Name', 'Previous dues', 'Advance', 'Note'],
        [kids[0]!.adm, 'Old0', '"4,500"', '0', 'Term 4 of last year'],
        [kids[1]!.adm, 'Old1', '0', '1200', ''],
        [kids[2]!.adm, 'Old2', '0', '0', ''],
      ]),
    );
    expect(res.body.problemCount).toBe(0);
    expect(res.body.summary).toMatchObject({ students: 2, dues: R(4500), advance: R(1200) });
    first = res.body.id;
    expect((await B.browser.post(`/opening-balances/${first}/apply`, {})).status).toBe(404);
    const done = await A.browser.post(`/opening-balances/${first}/apply`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ demands: 1, advances: 1 });

    const a0 = await account(0);
    expect(a0.totals).toMatchObject({ billed: R(4500), balance: R(4500) });
    expect(a0.invoices[0].structureName).toBe('Previous year dues');
    const a1 = await account(1);
    expect(a1.totals).toMatchObject({ advance: R(1200) });
    expect(a1.payments[0]).toMatchObject({
      mode: 'opening',
      receiptNumber: expect.stringMatching(/^OB\//),
    });
    const tb = await trial();
    // Balances are debit − credit: the opening account holds a net credit of 4500 − 1200.
    expect(tb.opening).toBe(-(R(4500) - R(1200)));
    expect(tb.cash ?? 0).toBe(0);
  });

  it('old balances stay out of collection and day closing', async () => {
    const rep = await A.browser.get(
      `/fees/reports/collection?campusId=${A.campusId}&from=${today}&to=${today}`,
    );
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.total ?? 0).toBe(0);
  });

  it('the same student cannot get previous dues twice', async () => {
    const res = await upload(
      A,
      csv([
        ['Admission no', 'Previous dues'],
        [kids[0]!.adm, '100'],
      ]),
    );
    expect(res.body.problems[0].message).toMatch(/already has previous dues/);
  });

  it('paying previous dues at the counter works like any fee; undo is then refused', async () => {
    const pay = await accountant.post('/fees/payments', {
      studentId: kids[0]!.id,
      mode: 'cash',
      amount: R(2000),
      idempotencyKey: `k-${Date.now()}`,
    });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect((await account(0)).totals).toMatchObject({ balance: R(2500), paid: R(2000) });
    const undo = await A.browser.post(`/opening-balances/${first}/undo`, {});
    expect(undo.status).toBe(409);
  });

  it('undo cancels the dues and the advance when nothing has used them', async () => {
    const res = await upload(
      A,
      csv([
        ['Admission no', 'Previous dues', 'Advance'],
        [kids[2]!.adm, '700', '300'],
      ]),
    );
    const applied = await A.browser.post(`/opening-balances/${res.body.id}/apply`, {});
    expect(applied.status).toBe(200);
    expect((await account(2)).totals).toMatchObject({ balance: R(700), advance: R(300) });
    const undo = await A.browser.post(`/opening-balances/${res.body.id}/undo`, {});
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    const after = await account(2);
    expect(after.totals).toMatchObject({ balance: 0, advance: 0 });
    await trial();
    const list = (await A.browser.get(`/opening-balances?campusId=${A.campusId}`)).body.items.map(
      (i: Row) => i.status,
    );
    expect(list).toEqual(expect.arrayContaining(['undone', 'applied', 'previewed']));
  });
});
