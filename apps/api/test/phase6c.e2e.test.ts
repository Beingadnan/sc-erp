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
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Phase 6c: paying the school's account (links, screenshots, checking) and refunds. */
describe('Phase 6c: pay to school account and refunds (e2e)', () => {
  let app: INestApplication;
  let owner: Pool;
  let A: School;
  let B: School;
  let accountant: Browser;
  let parent: Browser;
  let structure: Row;
  let campusCode: string;
  const today = todayIn('Asia/Kolkata');
  const yStart =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const startsOn = `${yStart}-04-01`;
  const kids: string[] = [];
  const heads: Record<string, string> = {};
  let phone = 500;

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
  const link = async (i: number, extra: Record<string, unknown> = {}) => {
    const res = await accountant.post('/fees/payment-links', { studentId: kids[i], ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { ...res.body, token: (res.body.url as string).split('/pay/')[1]! };
  };
  const proof = (token: string, fields: Record<string, string>, file: Buffer | null = PNG) =>
    parent.upload(
      `/public/pay/${token}/proof`,
      { mode: 'upi', paidOn: today, payerName: 'Parent One', ...fields },
      file && { name: 'screenshot.png', bytes: file },
    );

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    owner = openOwnerPool();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    parent = new Browser(app);
    campusCode = (await A.browser.get('/campuses')).body.find((c: Row) => c.id === A.campusId).code;
    const year = (
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
        code: '6',
        name: 'Class 6',
        stage: 'middle',
        sortOrder: 16,
      })
    ).body;
    const sec = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: cls.id,
        name: 'B',
      })
    ).body;
    for (let i = 0; i < 4; i++) {
      const res = await A.browser.post('/students', {
        firstName: `Pupil${i}`,
        lastName: unique('y').slice(-5),
        dateOfBirth: '2014-05-10',
        gender: i % 2 ? 'female' : 'male',
        sectionId: sec.id,
        admissionDate: startsOn,
        guardians: [
          {
            fullName: `Guardian ${i}`,
            phone: `96${String(10000000 + ++phone).slice(-8)}`,
            relationship: 'mother',
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
      ['DEP', 'Caution deposit', 'deposit'],
    ] as const) {
      heads[code] = (await A.browser.post('/fees/heads', { code, name, category })).body.id;
    }
    structure = (
      await A.browser.post('/fees/structures', {
        campusId: A.campusId,
        academicYearId: year.id,
        name: 'Class 6 fees',
        kind: 'class',
        gradeLevelIds: [cls.id],
      })
    ).body;
    await A.browser.put(`/fees/structures/${structure.id}/plan`, {
      installments: [
        {
          label: 'Term 1',
          dueOn: shift(today, -10),
          items: [
            { feeHeadId: heads.TUI, amount: R(10000) },
            { feeHeadId: heads.DEP, amount: R(5000) },
          ],
        },
        {
          label: 'Term 2',
          dueOn: shift(today, 30),
          items: [{ feeHeadId: heads.TUI, amount: R(10000) }],
        },
      ],
    });
    await A.browser.post(`/fees/structures/${structure.id}/status`, { status: 'published' });
    accountant = await staff(A, 'accountant');
    const gen = await accountant.post('/fees/demands/generate', { structureId: structure.id });
    expect(gen.body.created).toBe(8);
  }, 120_000);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  const details = {
    payeeName: 'Sunrise Public School',
    upiId: 'sunrise@okhdfcbank',
    bankAccountName: 'Sunrise Public School',
    bankAccountNumber: '5010 0123 4567 89',
    ifsc: 'hdfc0001234',
    bankName: 'HDFC Bank',
    branch: 'Jaipur',
    instructions: 'Write the admission number in the remarks.',
  };

  describe('school payment details', () => {
    it('cannot send a link before the school adds its account', async () => {
      const res = await accountant.post('/fees/payment-links', { studentId: kids[0] });
      expect(res.status).toBe(409);
    });

    it('only administrators can change where parents pay', async () => {
      const denied = await accountant.put('/fees/payment-settings', {
        campusId: A.campusId,
        ...details,
      });
      expect(denied.status).toBe(403);
      const bad = await A.browser.put('/fees/payment-settings', {
        campusId: A.campusId,
        ...details,
        ifsc: 'HDFC1234',
      });
      expect(bad.status).toBe(422);
      const none = await A.browser.put('/fees/payment-settings', {
        campusId: A.campusId,
        payeeName: 'X School',
      });
      expect(none.status).toBe(422);
      const ok = await A.browser.put('/fees/payment-settings', {
        campusId: A.campusId,
        ...details,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.settings).toMatchObject({
        bankAccountNumber: '50100123456789',
        ifsc: 'HDFC0001234',
        enabled: true,
        hasQrImage: false,
      });
      const seen = await accountant.get(`/fees/payment-settings?campusId=${A.campusId}`);
      expect(seen.body.settings.upiId).toBe('sunrise@okhdfcbank');
      expect((await B.browser.get(`/fees/payment-settings?campusId=${A.campusId}`)).status).toBe(
        404,
      );
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [A.tenantId]);
        const audit = await client.query(
          `select diff from audit_logs where action = 'fees.payment_details_changed' order by created_at desc limit 1`,
        );
        expect(JSON.stringify(audit.rows[0].diff)).toContain('6789');
        expect(JSON.stringify(audit.rows[0].diff)).not.toContain('50100123456789');
      } finally {
        await client.query('rollback');
        client.release();
      }
    });

    it('takes the school QR image (images only)', async () => {
      const txt = await A.browser.upload(
        `/fees/payment-settings/qr?campusId=${A.campusId}`,
        {},
        {
          name: 'qr.png',
          bytes: Buffer.from('not an image'),
        },
      );
      expect(txt.status).toBe(422);
      const res = await A.browser.upload(
        `/fees/payment-settings/qr?campusId=${A.campusId}`,
        {},
        {
          name: 'qr.png',
          bytes: PNG,
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.settings.hasQrImage).toBe(true);
      expect(res.body.settings.qrUrl).toBeTruthy();
    });
  });

  describe('payment link → screenshot → receipt (FEE-05)', () => {
    let l0: { token: string; id: string; amount: number };
    let proofId: string;

    it('creates a link for what is due today', async () => {
      l0 = await link(0);
      expect(l0.amount).toBe(R(15000));
      expect(l0).toMatchObject({ guardianPhone: expect.stringMatching(/^\+91/) });
      const other = await B.browser.post('/fees/payment-links', { studentId: kids[0] });
      expect([403, 404]).toContain(other.status);
    });

    it('shows the parent the bank details without signing in', async () => {
      const res = await parent.get(`/public/pay/${l0.token}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        status: 'open',
        amount: R(15000),
        studentFirstName: 'Pupil0',
        payTo: { ifsc: 'HDFC0001234', upiId: 'sunrise@okhdfcbank' },
      });
      expect(res.body.payTo.upiUri).toMatch(/^upi:\/\/pay\?pa=sunrise%40okhdfcbank.*am=15000\.00/);
      expect(res.body.payTo.qrUrl).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/admissionNumber|lastName/);
      expect((await parent.get(`/public/pay/${'x'.repeat(43)}`)).status).toBe(404);
    });

    it('accepts a screenshot with its UTR, once', async () => {
      const noFile = await proof(l0.token, { amount: String(R(15000)), reference: 'X1' }, null);
      expect(noFile.status).toBe(422);
      const future = await proof(l0.token, {
        amount: String(R(15000)),
        reference: '412356789012',
        paidOn: shift(today, 1),
      });
      expect(future.status).toBe(422);
      const res = await proof(l0.token, { amount: String(R(15000)), reference: '4123 5678-9012' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      proofId = res.body.id;
      const again = await proof(l0.token, { amount: String(R(15000)), reference: '412356789012' });
      expect(again.status).toBe(409);
      const view = await parent.get(`/public/pay/${l0.token}`);
      expect(view.body.proofs).toMatchObject([{ status: 'pending', reference: '412356789012' }]);
    });

    it('staff see the queue and the screenshot; other schools do not', async () => {
      const q = await accountant.get(`/fees/payment-proofs?campusId=${A.campusId}`);
      expect(q.body.pending).toBe(1);
      expect(q.body.items[0]).toMatchObject({
        id: proofId,
        amount: R(15000),
        askedAmount: R(15000),
      });
      const one = await accountant.get(`/fees/payment-proofs/${proofId}`);
      expect(one.status).toBe(200);
      expect(one.body.fileUrl).toBeTruthy();
      expect((await B.browser.get(`/fees/payment-proofs/${proofId}`)).status).toBe(404);
      expect([403, 404]).toContain(
        (await B.browser.post(`/fees/payment-proofs/${proofId}/approve`, {})).status,
      );
    });

    it('approving issues the receipt and closes the link', async () => {
      const res = await accountant.post(`/fees/payment-proofs/${proofId}/approve`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.receipt).toMatchObject({ amount: R(15000), status: 'cleared' });
      expect(res.body.receipt.receiptNumber).toBe(`${campusCode}/${financialYear(today)}/00001`);
      expect((await accountant.post(`/fees/payment-proofs/${proofId}/approve`, {})).status).toBe(
        409,
      );
      const acct = await account(0);
      expect(acct.totals).toMatchObject({ paid: R(15000), advance: 0 });
      const pay = await accountant.get(`/fees/payments/${res.body.receipt.id}`);
      expect(pay.body).toMatchObject({ mode: 'upi', reference: '412356789012' });
      const view = await parent.get(`/public/pay/${l0.token}`);
      expect(view.body.status).toBe('paid');
      expect(view.body.payTo).toBeNull();
      expect(view.body.proofs[0].receiptNumber).toBe(res.body.receipt.receiptNumber);
      const pdf = await parent
        .get(`/public/pay/${l0.token}/receipts/${proofId}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const more = await proof(l0.token, { amount: String(R(100)), reference: 'NEWUTR12345' });
      expect(more.status).toBe(409);
      await trial();
    });

    it('a rejected proof tells the parent why, and the UTR can be sent again', async () => {
      const l1 = await link(1, { amount: R(5000) });
      expect(l1.amount).toBe(R(5000));
      const first = await proof(l1.token, {
        amount: String(R(5000)),
        reference: 'AXIS00099887766',
      });
      expect(first.status).toBe(201);
      const rej = await accountant.post(`/fees/payment-proofs/${first.body.id}/reject`, {
        note: 'Amount not in bank statement yet',
      });
      expect(rej.status).toBe(200);
      const view = await parent.get(`/public/pay/${l1.token}`);
      expect(view.body.proofs[0]).toMatchObject({
        status: 'rejected',
        note: 'Amount not in bank statement yet',
      });
      const second = await proof(l1.token, {
        amount: String(R(5000)),
        reference: 'AXIS00099887766',
      });
      expect(second.status).toBe(201);
    });

    it('a UTR already receipted at the counter is refused', async () => {
      const counter = await accountant.post('/fees/payments', {
        studentId: kids[3],
        mode: 'upi',
        amount: R(1000),
        reference: 'COUNTER998877',
        idempotencyKey: key(),
      });
      expect(counter.status).toBe(201);
      const l3 = await link(3);
      const res = await proof(l3.token, { amount: String(R(1000)), reference: 'counter998877' });
      expect(res.status).toBe(409);
    });

    it('a cancelled link stops taking proofs', async () => {
      const l2 = await link(2);
      expect((await accountant.post(`/fees/payment-links/${l2.id}/cancel`, {})).status).toBe(200);
      expect((await parent.get(`/public/pay/${l2.token}`)).body).toMatchObject({
        status: 'cancelled',
        payTo: null,
      });
      expect((await proof(l2.token, { amount: '10000', reference: 'ZZ12345678' })).status).toBe(
        409,
      );
      const list = await accountant.get(`/fees/payment-links?campusId=${A.campusId}`);
      expect(list.body.items.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('refunds (FEE-07)', () => {
    let receiptId: string;

    it('shows what can be refunded', async () => {
      const res = await accountant.post('/fees/payments', {
        studentId: kids[2],
        mode: 'cash',
        amount: R(30000),
        idempotencyKey: key(),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      receiptId = res.body.id;
      const r = await accountant.get(`/fees/students/${kids[2]}/refundable`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ advance: R(5000), deposit: R(5000) });
    });

    it('refunds advance only with a second person approving', async () => {
      const tooMuch = await accountant.post('/fees/refunds', {
        studentId: kids[2],
        source: 'advance',
        amount: R(6000),
        mode: 'cash',
        reason: 'Leaving school',
      });
      expect(tooMuch.status).toBe(409);
      const req = await accountant.post('/fees/refunds', {
        studentId: kids[2],
        source: 'advance',
        amount: R(3000),
        mode: 'cash',
        reason: 'Paid extra by mistake',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      expect((await accountant.post(`/fees/refunds/${req.body.id}/pay`, {})).status).toBe(403);
      const before = await trial();
      const paid = await A.browser.post(`/fees/refunds/${req.body.id}/pay`, {});
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      expect(paid.body.refundNumber).toBe(`RF/${campusCode}/${financialYear(today)}/00001`);
      const after = await trial();
      expect(after.advance - before.advance).toBe(R(3000));
      expect(after.cash - before.cash).toBe(-R(3000));
      expect((await accountant.get(`/fees/students/${kids[2]}/refundable`)).body.advance).toBe(
        R(2000),
      );
      expect((await A.browser.post(`/fees/refunds/${req.body.id}/pay`, {})).status).toBe(409);
    });

    it('the person who asked cannot approve, and a bank refund needs its reference', async () => {
      const own = await A.browser.post('/fees/refunds', {
        studentId: kids[2],
        source: 'deposit',
        amount: R(5000),
        mode: 'bank_transfer',
        reason: 'Transfer certificate issued',
      });
      expect(own.status).toBe(201);
      expect(
        (await A.browser.post(`/fees/refunds/${own.body.id}/pay`, { reference: 'NEFT1' })).status,
      ).toBe(403);
      // While asked for, the deposit is held.
      expect((await accountant.get(`/fees/students/${kids[2]}/refundable`)).body.deposit).toBe(0);
      expect(
        (await A.browser.post(`/fees/refunds/${own.body.id}/reject`, { note: 'Raised twice' }))
          .status,
      ).toBe(200);
      const req = await accountant.post('/fees/refunds', {
        studentId: kids[2],
        source: 'deposit',
        amount: R(5000),
        mode: 'bank_transfer',
        reason: 'Transfer certificate issued',
      });
      expect(req.status).toBe(201);
      expect((await A.browser.post(`/fees/refunds/${req.body.id}/pay`, {})).status).toBe(422);
      const before = await trial();
      const paid = await A.browser.post(`/fees/refunds/${req.body.id}/pay`, {
        reference: 'NEFT00112233',
      });
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      const after = await trial();
      expect(after.bank - before.bank).toBe(-R(5000));
      expect((await accountant.get(`/fees/students/${kids[2]}/refundable`)).body.deposit).toBe(0);
      const list = await accountant.get(
        `/fees/refunds?campusId=${A.campusId}&studentId=${kids[2]}`,
      );
      expect(list.body.items.map((r: Row) => r.status).sort()).toEqual([
        'paid',
        'paid',
        'rejected',
      ]);
      expect((await B.browser.get(`/fees/refunds?campusId=${A.campusId}`)).status).toBe(404);
    });

    it('a receipt that was refunded cannot be cancelled', async () => {
      const res = await A.browser.post(`/fees/payments/${receiptId}/cancel`, { reason: 'Mistake' });
      expect(res.status).toBe(409);
    });

    it('cancelling a paid demand turns the money into advance that can be refunded', async () => {
      const acct = await account(0);
      const term1 = acct.invoices.find((v: Row) => v.paid === R(15000));
      const cancel = await A.browser.post(`/fees/demands/${term1.id}/cancel`, {
        reason: 'Admission withdrawn',
      });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(cancel.body.movedToAdvance).toBe(R(15000));
      const r = await accountant.get(`/fees/students/${kids[0]}/refundable`);
      expect(r.body).toMatchObject({ advance: R(15000), deposit: 0 });
      const req = await accountant.post('/fees/refunds', {
        studentId: kids[0],
        source: 'advance',
        amount: R(15000),
        mode: 'upi',
        reason: 'Admission withdrawn',
      });
      expect(req.status).toBe(201);
      const paid = await A.browser.post(`/fees/refunds/${req.body.id}/pay`, {
        reference: 'UPIREFUND123',
      });
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      const tb = await trial();
      expect(tb.advance).toBeLessThanOrEqual(0);
    });
  });

  describe('database guards', () => {
    it('proofs and refunds cannot be rewritten', async () => {
      const q = async (s: string) => (await owner.query(s)).rows[0].ok as boolean;
      expect(
        await q(`select has_table_privilege('erp_app', 'fee_payment_proofs', 'DELETE') as ok`),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'fee_payment_proofs', 'amount', 'UPDATE') as ok`,
        ),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'fee_payment_proofs', 'reference', 'UPDATE') as ok`,
        ),
      ).toBe(false);
      expect(
        await q(`select has_column_privilege('erp_app', 'fee_refunds', 'amount', 'UPDATE') as ok`),
      ).toBe(false);
      expect(
        await q(`select has_table_privilege('erp_app', 'fee_refund_parts', 'UPDATE') as ok`),
      ).toBe(false);
      expect(
        await q(`select has_table_privilege('erp_app', 'fee_payment_settings', 'DELETE') as ok`),
      ).toBe(false);
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [A.tenantId]);
        await expect(
          client.query(
            `update fee_payment_proofs set status = 'pending' where status = 'approved'`,
          ),
        ).rejects.toThrow();
      } finally {
        await client.query('rollback');
        client.release();
      }
    });
  });
});
