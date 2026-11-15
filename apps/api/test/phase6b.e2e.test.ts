import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openOwnerPool, prepareDatabase } from '@school-erp/db/testing';
import { financialYear } from '@school-erp/validation';
import { Browser, mailer, registerSchool, startApp, tokenFromMail, unique } from './support.js';
import type { School } from './support.js';
import { todayIn } from '../src/attendance/attendance.service.js';

type Row = { id: string; [k: string]: unknown };
const DAY = 86_400_000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const R = (rupees: number) => rupees * 100;
let keyN = 0;
const key = () => `test-key-${Date.now()}-${++keyN}`;

/** Phase 6b: counter collection, receipts, cheques, advance, day closing, reports. */
describe('Phase 6b: fee collection (e2e)', () => {
  let app: INestApplication;
  let owner: Pool;
  let A: School;
  let B: School;
  let accountant: Browser;
  let year: Row;
  let structure: Row;
  let campusCode: string;
  const today = todayIn('Asia/Kolkata');
  const yStart =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const startsOn = `${yStart}-04-01`;
  const kids: string[] = [];
  const heads: Record<string, string> = {};
  let phone = 0;

  const roleId = async (s: School, k: string) =>
    ((await s.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === k,
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
    return browser;
  };

  const trial = async () => {
    const tb = (await A.browser.get(`/fees/accounts?campusId=${A.campusId}`)).body as {
      accounts: Array<{ systemKey: string | null; balance: number }>;
      totals: { debit: number; credit: number };
    };
    expect(tb.totals.debit).toBe(tb.totals.credit);
    return Object.fromEntries(
      tb.accounts.filter((a) => a.systemKey).map((a) => [a.systemKey, a.balance]),
    );
  };
  const account = async (i: number) => (await accountant.get(`/fees/students/${kids[i]}`)).body;
  const pay = (body: Record<string, unknown>, as: Browser = accountant) =>
    as.post('/fees/payments', { mode: 'cash', idempotencyKey: key(), ...body });

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    owner = openOwnerPool();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    campusCode = (await A.browser.get('/campuses')).body.find((c: Row) => c.id === A.campusId).code;
    year = (
      await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: `${yStart}-${(yStart + 1) % 100}`,
        startsOn,
        endsOn: `${yStart + 1}-03-31`,
      })
    ).body;
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
    for (let i = 0; i < 6; i++) {
      const res = await A.browser.post('/students', {
        firstName: `Kid${i}`,
        lastName: unique('x').slice(-5),
        dateOfBirth: '2017-05-10',
        gender: i % 2 ? 'female' : 'male',
        sectionId: sec.id,
        admissionDate: startsOn,
        guardians: [
          {
            fullName: `Parent ${i}`,
            phone: `95${String(10000000 + ++phone).slice(-8)}`,
            relationship: 'father',
            isPrimary: true,
          },
        ],
        privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      kids.push(res.body.id);
    }
    for (const [code, name, category] of [
      ['TUI', 'Tuition fee', 'tuition'],
      ['ANN', 'Annual charges', 'annual'],
      ['BUS', 'Transport', 'transport'],
    ] as const) {
      heads[code] = (await A.browser.post('/fees/heads', { code, name, category })).body.id;
    }
    structure = (
      await A.browser.post('/fees/structures', {
        campusId: A.campusId,
        academicYearId: year.id,
        name: 'Class 4 fees',
        kind: 'class',
        gradeLevelIds: [cls.id],
        lateFee: { kind: 'fixed', amount: R(100), graceDays: 5 },
      })
    ).body;
    await A.browser.put(`/fees/structures/${structure.id}/plan`, {
      installments: [
        {
          label: 'Term 1',
          dueOn: shift(today, -30),
          items: [
            { feeHeadId: heads.TUI, amount: R(15000) },
            { feeHeadId: heads.ANN, amount: R(5000) },
          ],
        },
        {
          label: 'Term 2',
          dueOn: shift(today, 30),
          items: [{ feeHeadId: heads.TUI, amount: R(15000) }],
        },
      ],
    });
    await A.browser.post(`/fees/structures/${structure.id}/status`, { status: 'published' });
    accountant = await staff(A, 'accountant');
    const gen = await accountant.post('/fees/demands/generate', { structureId: structure.id });
    expect(gen.body.created).toBe(12);
  }, 120_000);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('collecting (FEE-04, FEE-06)', () => {
    let first: Row;

    it('takes cash, settles the oldest dues first and numbers the receipt', async () => {
      const k = key();
      const res = await pay({ studentId: kids[0], amount: R(12000), idempotencyKey: k });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        amount: R(12000),
        advance: 0,
        status: 'cleared',
        repeated: false,
      });
      expect(res.body.receiptNumber).toBe(`${campusCode}/${financialYear(today)}/00001`);
      first = res.body;
      const again = await accountant.post('/fees/payments', {
        studentId: kids[0],
        mode: 'cash',
        amount: R(12000),
        idempotencyKey: k,
      });
      expect(again.body).toMatchObject({ id: first.id, repeated: true });
      const acct = await account(0);
      expect(acct.totals).toMatchObject({
        billed: R(35000),
        paid: R(12000),
        balance: R(23000),
        advance: 0,
      });
      expect(acct.invoices[0].paid).toBe(R(12000));
      expect(acct.invoices[1].paid).toBe(0);
      expect(acct.payments).toHaveLength(1);
    });

    it('settles chosen fees, and refuses more than is due', async () => {
      const kid1 = await account(1);
      const ann = kid1.invoices[0].lines.find((l: Row) => l.headName === 'Annual charges');
      const over = await pay({
        studentId: kids[1],
        amount: R(6000),
        allocations: [{ lineId: ann.id, amount: R(6000) }],
      });
      expect(over.status).toBe(422);
      const sumOver = await pay({
        studentId: kids[1],
        amount: R(4000),
        allocations: [{ lineId: ann.id, amount: R(5000) }],
      });
      expect(sumOver.status).toBe(422);
      const ok = await pay({
        studentId: kids[1],
        amount: R(5000),
        allocations: [{ lineId: ann.id, amount: R(5000) }],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const after = await account(1);
      expect(after.invoices[0].lines.find((l: Row) => l.id === ann.id).paid).toBe(R(5000));
      expect(after.invoices[0].balance).toBe(R(15000));
    });

    it('keeps an overpayment as advance and applies it to later dues', async () => {
      const res = await pay({
        studentId: kids[2],
        amount: R(40000),
        mode: 'upi',
        reference: 'UPI123456789',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.advance).toBe(R(5000));
      let acct = await account(2);
      expect(acct.totals).toMatchObject({ balance: 0, advance: R(5000) });
      expect(acct.statement.at(-1).balance).toBe(-R(5000));
      expect(
        (await pay({ studentId: kids[2], amount: R(1), mode: 'upi', reference: '' })).status,
      ).toBe(422);

      const bus = (
        await A.browser.post('/fees/structures', {
          campusId: A.campusId,
          academicYearId: year.id,
          name: 'Bus',
          kind: 'optional',
        })
      ).body;
      await A.browser.put(`/fees/structures/${bus.id}/plan`, {
        installments: [
          { label: 'Nov', dueOn: today, items: [{ feeHeadId: heads.BUS, amount: R(1200) }] },
        ],
      });
      await A.browser.post(`/fees/structures/${bus.id}/status`, { status: 'published' });
      await accountant.post(`/fees/structures/${bus.id}/students`, { studentId: kids[2] });
      await accountant.post('/fees/demands/generate', { structureId: bus.id });
      const applied = await accountant.post(`/fees/students/${kids[2]}/apply-advance`, {});
      expect(applied.body).toEqual({ applied: R(1200) });
      acct = await account(2);
      expect(acct.totals).toMatchObject({ balance: 0, advance: R(3800) });
      expect(acct.statement.at(-1).balance).toBe(-R(3800));
      const tb = await trial();
      expect(tb.advance).toBe(-R(3800));
    });

    it('cheques wait for clearance; clearing moves money to the bank', async () => {
      const bad = await pay({
        studentId: kids[3],
        amount: R(20000),
        mode: 'cheque',
        reference: '000123',
      });
      expect(bad.status).toBe(422);
      const res = await pay({
        studentId: kids[3],
        amount: R(20000),
        mode: 'cheque',
        reference: '000123',
        bankName: 'State Bank of India',
        instrumentDate: today,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.status).toBe('pending');
      expect((await account(3)).invoices[0]).toMatchObject({ balance: 0, chequePending: true });
      let tb = await trial();
      expect(tb.cheques).toBe(R(20000));
      const cleared = await accountant.post(`/fees/payments/${res.body.id}/clear`, {});
      expect(cleared.status).toBe(200);
      expect((await accountant.post(`/fees/payments/${res.body.id}/clear`, {})).status).toBe(409);
      tb = await trial();
      expect(tb.cheques).toBe(0);
      expect(tb.bank).toBe(R(20000 + 40000));
    });

    it('a bounced cheque reopens the dues and reverses the ledger', async () => {
      const res = await pay({
        studentId: kids[4],
        amount: R(20000),
        mode: 'cheque',
        reference: '777001',
        bankName: 'Bank of Baroda',
        instrumentDate: today,
      });
      const b = await accountant.post(`/fees/payments/${res.body.id}/bounce`, {
        reason: 'Insufficient funds',
      });
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      const acct = await account(4);
      expect(acct.totals).toMatchObject({ paid: 0, balance: R(35000) });
      expect(acct.payments[0].status).toBe('bounced');
      expect((await trial()).cheques).toBe(0);
    });

    it('late fees stop once the fees are paid', async () => {
      const res = await accountant.post('/fees/demands/late-fees', { campusId: A.campusId });
      // Term 1 unpaid or partly paid: kids 0, 1, 4, 5. Kid 2 and kid 3 have paid.
      expect(res.body).toMatchObject({ demands: 4, amount: R(400) });
    });

    it('cancelling a receipt keeps its number, reverses it and reopens the dues', async () => {
      expect(
        (await accountant.post(`/fees/payments/${first.id}/cancel`, { reason: 'Wrong student' }))
          .status,
      ).toBe(403);
      const res = await A.browser.post(`/fees/payments/${first.id}/cancel`, {
        reason: 'Entered against the wrong student',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        (await A.browser.post(`/fees/payments/${first.id}/cancel`, { reason: 'again' })).status,
      ).toBe(409);
      const acct = await account(0);
      expect(acct.totals).toMatchObject({ paid: 0, balance: R(35100) });
      const next = await pay({ studentId: kids[0], amount: R(100) });
      const list = await accountant.get(`/fees/payments?campusId=${A.campusId}`);
      const numbers = (list.body.data as Row[])
        .map((p) => Number(String(p.receiptNumber).split('/').at(-1)))
        .sort((a, b) => a - b);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1)); // gap-free, cancelled one included
      expect(next.body.receiptNumber.endsWith(String(numbers.length).padStart(5, '0'))).toBe(true);
      expect(list.body.byMode.find((m: Row) => m.mode === 'cash').amount).toBe(R(5000 + 100));
    });

    it('cancelling a paid demand keeps the money as advance, ready to apply again', async () => {
      const kid1 = await account(1);
      const res = await accountant.post(`/fees/demands/${kid1.invoices[0].id}/cancel`, {
        reason: 'Raised twice',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.movedToAdvance).toBe(R(5000));
      let after = await account(1);
      expect(after.totals).toMatchObject({ advance: R(5000) });
      await accountant.post('/fees/demands/generate', {
        structureId: structure.id,
        installmentIds: [
          kid1.invoices[0].installmentId ??
            (await A.browser.get(`/fees/structures/${structure.id}`)).body.installments[0].id,
        ],
        studentIds: [kids[1]],
      });
      const applied = await accountant.post(`/fees/students/${kids[1]}/apply-advance`, {});
      expect(applied.body).toEqual({ applied: R(5000) });
      after = await account(1);
      expect(after.totals).toMatchObject({ advance: 0, paid: R(5000) });
      await trial();
    });

    it('prints the receipt as a PDF', async () => {
      const kid1 = await account(1);
      const res = await accountant
        .get(`/fees/payments/${kid1.payments[0].id}/receipt.pdf`)
        .buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
      expect((await B.browser.get(`/fees/payments/${kid1.payments[0].id}`)).status).toBe(404);
      expect((await pay({ studentId: kids[1], amount: R(1) }, B.browser)).status).toBe(403);
    });
  });

  describe('day closing and reports (FEE-08)', () => {
    it('closes the cashier day with a cash count; no more receipts that day', async () => {
      const day = await accountant.get(`/fees/day-close?campusId=${A.campusId}`);
      expect(day.status).toBe(200);
      expect(day.body).toMatchObject({ cashExpected: R(5100), closing: null });
      expect(day.body.totals).toMatchObject({ cash: R(5100), upi: R(40000), cheque: R(20000) });
      const noNote = await accountant.post('/fees/day-close', {
        campusId: A.campusId,
        date: today,
        cashCounted: R(5000),
      });
      expect(noNote.status).toBe(422);
      const ok = await accountant.post('/fees/day-close', {
        campusId: A.campusId,
        date: today,
        cashCounted: R(5000),
        note: 'Rs. 100 short, will be made good',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.difference).toBe(-R(100));
      expect((await pay({ studentId: kids[5], amount: R(100) })).status).toBe(409);
      expect(
        (
          await accountant.post('/fees/day-close', {
            campusId: A.campusId,
            date: today,
            cashCounted: R(5000),
            note: 'x',
          })
        ).status,
      ).toBe(409);
      const list = await A.browser.get(`/fees/day-closings?campusId=${A.campusId}`);
      expect(list.body[0]).toMatchObject({ cashier: 'Staff accountant', difference: -R(100) });
      const receipts = await accountant.get(`/fees/payments?campusId=${A.campusId}`);
      expect((receipts.body.data as Row[]).every((p) => p.dayClosed)).toBe(true);
    });

    it('collection report agrees with receipts and downloads as CSV and Excel', async () => {
      const res = await A.browser.get(`/fees/reports/collection?campusId=${A.campusId}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(R(5100 + 40000 + 20000));
      expect(res.body.byHead.find((h: Row) => h.head === 'Advance (not yet due)').amount).toBe(
        R(10000),
      );
      const csv = await A.browser.get(`/fees/reports/collection?campusId=${A.campusId}&format=csv`);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toMatch(/Receipt no\.,Student/);
      const xlsx = await A.browser
        .get(`/fees/reports/collection?campusId=${A.campusId}&format=xlsx`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });

    it('outstanding report matches the ledger', async () => {
      const res = await A.browser.get(
        `/fees/reports/outstanding?campusId=${A.campusId}&academicYearId=${year.id}`,
      );
      expect(res.status).toBe(200);
      const tb = await trial();
      expect(res.body.totals.outstanding).toBe(tb.receivable);
      expect(res.body.totals.defaulters).toBe(4);
      const conc = await A.browser.get(`/fees/reports/concessions?campusId=${A.campusId}`);
      expect(conc.status).toBe(200);
      expect((await B.browser.get(`/fees/reports/outstanding?campusId=${A.campusId}`)).status).toBe(
        404,
      );
    });

    it('receipts and allocations cannot be edited in the database', async () => {
      const q = async (s: string) => (await owner.query(s)).rows[0].ok as boolean;
      expect(
        await q(`select has_column_privilege('erp_app', 'fee_payments', 'amount', 'UPDATE') as ok`),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'fee_payments', 'receipt_number', 'UPDATE') as ok`,
        ),
      ).toBe(false);
      expect(await q(`select has_table_privilege('erp_app', 'fee_payments', 'DELETE') as ok`)).toBe(
        false,
      );
      expect(
        await q(`select has_table_privilege('erp_app', 'fee_allocations', 'UPDATE') as ok`),
      ).toBe(false);
      expect(
        await q(`select has_table_privilege('erp_app', 'fee_day_closings', 'DELETE') as ok`),
      ).toBe(false);
    });
  });
});
