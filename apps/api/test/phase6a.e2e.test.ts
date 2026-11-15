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

/** Phase 6a: fee setup, concessions, demands, late fees, waivers and the ledger. */
describe('Phase 6a: fees setup and demands (e2e)', () => {
  let app: INestApplication;
  let owner: Pool;
  let A: School;
  let B: School;
  let year: Row;
  let class1: Row;
  let class2: Row;
  let sec1: Row;
  let accountant: Browser;
  let teacher: Browser;
  const today = todayIn('Asia/Kolkata');
  const yStart =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const startsOn = `${yStart}-04-01`;
  const q1Due = shift(today, -30);
  const q2Due = shift(today, 30);
  const N = 120;
  let phone = 0;
  const kids: string[] = [];
  const heads: Record<string, string> = {};
  const types: Record<string, string> = {};
  let structure: Row & { installments: Array<Row & { label: string }> };

  const roleId = async (s: School, key: string) =>
    ((await s.browser.get('/roles')).body as Array<{ key: string; id: string }>).find(
      (r) => r.key === key,
    )!.id;

  const staff = async (s: School, roleKey: string, campusId: string | null) => {
    const email = `${unique('staff')}@example.test`;
    const res = await s.browser.post('/members/invite', {
      email,
      fullName: `Staff ${roleKey}`,
      assignments: [{ roleId: await roleId(s, roleKey), campusId }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const browser = new Browser(app);
    await browser.post('/auth/invite/accept', {
      token: tokenFromMail(mailer(app).lastTo(email, 'invite')),
      password: 'staff passphrase 123',
    });
    return browser;
  };

  const admit = async (s: School, sectionId: string, i: number, admissionDate = startsOn) => {
    const res = await s.browser.post('/students', {
      firstName: `Kid${String(i).padStart(3, '0')}`,
      lastName: unique('x').slice(-5),
      dateOfBirth: '2019-05-10',
      gender: i % 2 ? 'female' : 'male',
      sectionId,
      admissionDate,
      guardians: [
        {
          fullName: 'Parent',
          phone: `97${String(10000000 + ++phone).slice(-8)}`,
          relationship: 'mother',
          isPrimary: true,
        },
      ],
      privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  /** Owner-role query inside a tenant (tables use FORCE row-level security). */
  const asTenant = async (tenantId: string, text: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const res = await client.query(text, params);
      await client.query('commit');
      return res;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  };

  const trialBalance = async () => {
    const res = await A.browser.get(`/fees/accounts?campusId=${A.campusId}`);
    expect(res.status).toBe(200);
    return res.body as {
      accounts: Array<{ systemKey: string | null; balance: number; code: string }>;
      totals: { debit: number; credit: number };
    };
  };
  const account = (id: string) => A.browser.get(`/fees/students/${id}`);

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    owner = openOwnerPool();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
    year = (
      await A.browser.post('/academic-years', {
        campusId: A.campusId,
        name: `${yStart}-${(yStart + 1) % 100}`,
        startsOn,
        endsOn: `${yStart + 1}-03-31`,
      })
    ).body as Row;
    const mkClass = async (code: string, sortOrder: number) =>
      (
        await A.browser.post('/classes', {
          campusId: A.campusId,
          code,
          name: `Class ${code}`,
          stage: 'primary',
          sortOrder,
        })
      ).body as Row;
    class1 = await mkClass('1', 11);
    class2 = await mkClass('2', 12);
    sec1 = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: class1.id,
        name: 'A',
      })
    ).body as Row;
    const sec2 = (
      await A.browser.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: class2.id,
        name: 'A',
      })
    ).body as Row;
    for (let i = 0; i < N; i += 10) {
      kids.push(
        ...(await Promise.all(Array.from({ length: 10 }, (_, k) => admit(A, sec1.id, i + k + 1)))),
      );
    }
    await admit(A, sec2.id, 900);
    accountant = await staff(A, 'accountant', A.campusId);
    teacher = await staff(A, 'teacher', A.campusId);
  }, 240_000);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('setup (FEE-01)', () => {
    it('creates fee heads with their own income accounts; shared heads need school-wide rights', async () => {
      for (const [code, name, category] of [
        ['TUI', 'Tuition fee', 'tuition'],
        ['ANN', 'Annual charges', 'annual'],
        ['DEP', 'Caution deposit', 'deposit'],
        ['BUS', 'Transport', 'transport'],
      ] as const) {
        const res = await A.browser.post('/fees/heads', { code, name, category });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        heads[code] = res.body.id;
      }
      expect(
        (await A.browser.post('/fees/heads', { code: 'tui', name: 'Other', category: 'other' }))
          .status,
      ).toBe(409);
      expect(
        (await accountant.post('/fees/heads', { code: 'EXM', name: 'Exam', category: 'exam' }))
          .status,
      ).toBe(403);
      expect((await teacher.get('/fees/heads')).status).toBe(403);

      const list = (await accountant.get('/fees/heads')).body as Row[];
      expect(list.find((h) => h.code === 'LATE')).toMatchObject({ system: true });
      expect(list.find((h) => h.code === 'DEP')).toMatchObject({ refundable: true });
      const tb = await trialBalance();
      expect(tb.accounts.find((a) => a.code === '2301')).toBeTruthy(); // deposit is a liability
    });

    it('builds a class structure with installments, publishes it and then locks amounts', async () => {
      const res = await accountant.post('/fees/structures', {
        campusId: A.campusId,
        academicYearId: year.id,
        name: 'Class 1 fees',
        kind: 'class',
        gradeLevelIds: [class1.id],
        lateFee: { kind: 'fixed', amount: R(100), graceDays: 5 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const id = res.body.id as string;
      expect(
        (await accountant.post(`/fees/structures/${id}/status`, { status: 'published' })).status,
      ).toBe(422);

      const bad = await accountant.put(`/fees/structures/${id}/plan`, {
        installments: [
          {
            label: 'Q1',
            dueOn: `${yStart + 2}-01-01`,
            items: [{ feeHeadId: heads.TUI, amount: R(1) }],
          },
        ],
      });
      expect(bad.status).toBe(422);
      const plan = await accountant.put(`/fees/structures/${id}/plan`, {
        installments: [
          {
            label: 'Term 1',
            dueOn: q1Due,
            items: [
              { feeHeadId: heads.TUI, amount: R(15000) },
              { feeHeadId: heads.ANN, amount: R(5000) },
              { feeHeadId: heads.DEP, amount: R(2000) },
            ],
          },
          { label: 'Term 2', dueOn: q2Due, items: [{ feeHeadId: heads.TUI, amount: R(15000) }] },
        ],
      });
      expect(plan.status, JSON.stringify(plan.body)).toBe(200);
      expect(
        (await accountant.post(`/fees/structures/${id}/status`, { status: 'published' })).status,
      ).toBe(200);
      const again = await accountant.put(`/fees/structures/${id}/plan`, {
        installments: [
          { label: 'Term 1', dueOn: q1Due, items: [{ feeHeadId: heads.TUI, amount: R(1) }] },
        ],
      });
      expect(again.status).toBe(409);
      structure = (await accountant.get(`/fees/structures/${id}`)).body;
      expect(structure).toMatchObject({ total: R(37000), status: 'published' });
      expect(structure.installments.map((i) => i.label)).toEqual(['Term 1', 'Term 2']);
      expect((await B.browser.get(`/fees/structures/${id}`)).status).toBe(404);
    });

    it('deletes only unused drafts', async () => {
      const res = await accountant.post('/fees/structures', {
        campusId: A.campusId,
        academicYearId: year.id,
        name: 'Mistake',
        kind: 'class',
      });
      expect((await accountant.delete(`/fees/structures/${res.body.id}`)).status).toBe(204);
      expect((await accountant.delete(`/fees/structures/${structure.id}`)).status).toBe(409);
    });

    it('creates concession types', async () => {
      for (const [name, kind, mode, value, feeHeadIds] of [
        ['Sibling', 'sibling', 'percent', 10, [heads.TUI]],
        ['Merit scholarship', 'scholarship', 'fixed', R(5000), []],
        ['RTE', 'rte', 'percent', 100, []],
      ] as const) {
        const res = await A.browser.post('/fees/concession-types', {
          name,
          kind,
          mode,
          value,
          feeHeadIds,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        types[name] = res.body.id;
      }
      expect(
        (
          await A.browser.post('/fees/concession-types', {
            name: 'x',
            kind: 'other',
            mode: 'percent',
            value: 120,
          })
        ).status,
      ).toBe(422);
    });
  });

  describe('demands (FEE-02, FEE-03, FEE-09)', () => {
    it('applies a concession given before demands are raised', async () => {
      const res = await A.browser.post('/fees/concessions', {
        studentId: kids[0],
        academicYearId: year.id,
        concessionTypeId: types.Sibling,
        reason: 'Elder brother in Class 5',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ status: 'approved', demands: 0 });
      const dup = await A.browser.post('/fees/concessions', {
        studentId: kids[0],
        academicYearId: year.id,
        concessionTypeId: types.Sibling,
        reason: 'Again',
      });
      expect(dup.status).toBe(409);
    });

    it(`raises ${N * 2} demands quickly, once, with concessions and balanced books`, async () => {
      const t0 = Date.now();
      const res = await accountant.post('/fees/demands/generate', { structureId: structure.id });
      const took = Date.now() - t0;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(took).toBeLessThan(4000);
      expect(res.body).toMatchObject({
        created: N * 2,
        billed: N * R(37000),
        concessions: R(1500) * 2,
        skippedExisting: 0,
      });
      const again = await accountant.post('/fees/demands/generate', { structureId: structure.id });
      expect(again.body).toMatchObject({ created: 0, skippedExisting: N * 2 });

      const kid = (await account(kids[0]!)).body;
      expect(kid.totals).toMatchObject({ billed: R(37000), reduced: R(3000), balance: R(34000) });
      expect(kid.invoices[0].lines.find((l: Row) => l.headName === 'Tuition fee')).toMatchObject({
        reduced: R(1500),
      });
      expect(kid.statement.at(-1).balance).toBe(R(34000));

      const tb = await trialBalance();
      expect(tb.totals.debit).toBe(tb.totals.credit);
      const receivable = tb.accounts.find((a) => a.systemKey === 'receivable')!;
      expect(receivable.balance).toBe(N * R(37000) - R(3000));
    });

    it('bills late joiners only for installments due after they joined, unless named', async () => {
      const joiner = await admit(A, sec1.id, 500, today);
      const res = await accountant.post('/fees/demands/generate', { structureId: structure.id });
      expect(res.body).toMatchObject({ created: 1, skippedJoinedLater: 1 });
      const named = await accountant.post('/fees/demands/generate', {
        structureId: structure.id,
        installmentIds: [structure.installments[0]!.id],
        studentIds: [joiner],
      });
      expect(named.body).toMatchObject({ created: 1 });
      kids.push(joiner);
      const stranger = await accountant.post('/fees/demands/generate', {
        structureId: structure.id,
        studentIds: ['01920000-0000-7000-8000-000000000001'],
      });
      expect(stranger.status).toBe(422);
    });

    it('lists demands with filters and totals', async () => {
      const overdue = await accountant.get(`/fees/demands?campusId=${A.campusId}&status=overdue`);
      expect(overdue.status).toBe(200);
      expect(overdue.body.total).toBe(N + 1);
      expect(overdue.body.data).toHaveLength(50);
      expect(overdue.body.data[0]).toMatchObject({ status: 'overdue', installmentLabel: 'Term 1' });
      const admissionNumber = (await A.browser.get(`/students/${kids[1]}`)).body
        .admissionNumber as string;
      const mine = await accountant.get(
        `/fees/demands?campusId=${A.campusId}&q=${encodeURIComponent(admissionNumber)}`,
      );
      expect(mine.body.total).toBe(2);
      expect(mine.body.totals.balance).toBe(R(37000));
      expect((await B.browser.get(`/fees/demands?campusId=${A.campusId}`)).status).toBe(404);
    });

    it('adds late fees once per rule, on overdue unpaid demands only', async () => {
      const res = await accountant.post('/fees/demands/late-fees', { campusId: A.campusId });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ demands: N + 1, amount: (N + 1) * R(100) });
      const again = await accountant.post('/fees/demands/late-fees', { campusId: A.campusId });
      expect(again.body).toMatchObject({ demands: 0 });
      expect(
        (
          await accountant.post('/fees/demands/late-fees', {
            campusId: A.campusId,
            asOf: shift(today, 1),
          })
        ).status,
      ).toBe(422);
      const kid = (await account(kids[1]!)).body;
      expect(kid.invoices[0].lines.find((l: Row) => l.kind === 'late_fee')).toMatchObject({
        amount: R(100),
      });
    });

    it('waivers: requested by the accountant, approved by the owner, never more than the line', async () => {
      const kid = (await account(kids[1]!)).body;
      const late = kid.invoices[0].lines.find((l: Row) => l.kind === 'late_fee');
      const tooMuch = await accountant.post(`/fees/demands/${kid.invoices[0].id}/waivers`, {
        lineId: late.id,
        amount: R(101),
        reason: 'Bank holiday',
      });
      expect(tooMuch.status).toBe(422);
      const req = await accountant.post(`/fees/demands/${kid.invoices[0].id}/waivers`, {
        lineId: late.id,
        amount: R(100),
        reason: 'Parent paid by cheque on time; bank delay',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      expect(req.body.status).toBe('pending');
      expect(
        (await accountant.post(`/fees/waivers/${req.body.id}/decision`, { status: 'approved' }))
          .status,
      ).toBe(403);
      expect(
        (await B.browser.post(`/fees/waivers/${req.body.id}/decision`, { status: 'approved' }))
          .status,
      ).toBe(404);
      expect(
        (await A.browser.post(`/fees/waivers/${req.body.id}/decision`, { status: 'rejected' }))
          .status,
      ).toBe(422);
      const ok = await A.browser.post(`/fees/waivers/${req.body.id}/decision`, {
        status: 'approved',
        note: 'OK',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const after = (await account(kids[1]!)).body;
      expect(after.invoices[0].balance).toBe(R(22000));
      expect(after.invoices[0].lines.find((l: Row) => l.kind === 'late_fee')).toMatchObject({
        reduced: R(100),
      });
    });

    it('a concession approved later reduces raised demands; revoking puts it back', async () => {
      const req = await accountant.post('/fees/concessions', {
        studentId: kids[2],
        academicYearId: year.id,
        concessionTypeId: types['Merit scholarship'],
        value: R(4000),
        reason: 'District topper',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      expect(req.body.status).toBe('pending');
      const pending = await A.browser.get(
        `/fees/concessions?campusId=${A.campusId}&status=pending`,
      );
      expect(pending.body.map((c: Row) => c.id)).toContain(req.body.id);

      const ok = await A.browser.post(`/fees/concessions/${req.body.id}/decision`, {
        status: 'approved',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ demands: 2, amount: R(8000) });
      let kid = (await account(kids[2]!)).body;
      expect(kid.totals.reduced).toBe(R(8000));

      const rev = await A.browser.post(`/fees/concessions/${req.body.id}/revoke`, {
        note: 'Certificate not genuine',
      });
      expect(rev.status, JSON.stringify(rev.body)).toBe(200);
      expect(rev.body.amount).toBe(R(8000));
      kid = (await account(kids[2]!)).body;
      expect(kid.totals.reduced).toBe(0);
      expect(kid.statement.filter((s: Row) => s.reversal)).toHaveLength(2);
      expect(
        (await A.browser.post(`/fees/concessions/${req.body.id}/revoke`, { note: 'again' })).status,
      ).toBe(409);
      const tb = await trialBalance();
      expect(tb.totals.debit).toBe(tb.totals.credit);
    });

    it('optional fees bill only assigned students', async () => {
      const res = await accountant.post('/fees/structures', {
        campusId: A.campusId,
        academicYearId: year.id,
        name: 'Bus route 4',
        kind: 'optional',
      });
      const id = res.body.id as string;
      await accountant.put(`/fees/structures/${id}/plan`, {
        installments: [
          { label: 'Oct', dueOn: q1Due, items: [{ feeHeadId: heads.BUS, amount: R(1200) }] },
          { label: 'Dec', dueOn: q2Due, items: [{ feeHeadId: heads.BUS, amount: R(1200) }] },
        ],
      });
      await accountant.post(`/fees/structures/${id}/status`, { status: 'published' });
      expect(
        (await accountant.post(`/fees/structures/${structure.id}/students`, { studentId: kids[3] }))
          .status,
      ).toBe(409);
      const a = await accountant.post(`/fees/structures/${id}/students`, { studentId: kids[3] });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      expect(
        (await accountant.post(`/fees/structures/${id}/students`, { studentId: kids[3] })).status,
      ).toBe(409);
      const gen = await accountant.post('/fees/demands/generate', { structureId: id });
      expect(gen.body).toMatchObject({ created: 2, billed: R(2400) });
      const kid = (await account(kids[3]!)).body;
      expect(kid.optional.find((o: Row) => o.structureId === id).assignmentId).toBe(a.body.id);
      const sum = await accountant.get(`/fees/structures/${id}/demands`);
      expect(sum.body).toMatchObject({ eligible: 1 });
    });

    it('cancelling a demand reverses everything it posted; it can be raised again', async () => {
      const kid0 = (await account(kids[0]!)).body;
      const term1 = kid0.invoices[0];
      expect(
        (await accountant.post(`/fees/demands/${term1.id}/cancel`, { reason: 'x' })).status,
      ).toBe(422);
      const res = await accountant.post(`/fees/demands/${term1.id}/cancel`, {
        reason: 'Raised before RTE approval',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        (await accountant.post(`/fees/demands/${term1.id}/cancel`, { reason: 'again' })).status,
      ).toBe(409);
      let kid = (await account(kids[0]!)).body;
      expect(kid.invoices[0].state).toBe('cancelled');
      expect(kid.totals.balance).toBe(R(13500));
      expect(kid.statement.at(-1).balance).toBe(R(13500));

      const regen = await accountant.post('/fees/demands/generate', {
        structureId: structure.id,
        installmentIds: [structure.installments[0]!.id],
        studentIds: [kids[0]],
      });
      expect(regen.body.created).toBe(1);
      kid = (await account(kids[0]!)).body;
      expect(kid.totals.balance).toBe(R(13500) + R(20500));
      const tb = await trialBalance();
      expect(tb.totals.debit).toBe(tb.totals.credit);
    });

    it('unpublishing is refused while demands exist', async () => {
      expect(
        (await accountant.post(`/fees/structures/${structure.id}/status`, { status: 'draft' }))
          .status,
      ).toBe(409);
    });
  });

  describe('ledger integrity', () => {
    it('refuses unbalanced journals and any change to posted entries', async () => {
      const [acct] = (
        await asTenant(A.tenantId, `select id from ledger_accounts where system_key = 'cash'`)
      ).rows;
      await expect(
        asTenant(
          A.tenantId,
          `with j as (insert into ledger_journals (tenant_id, campus_id, posted_on, source_type, source_id)
             values ($1, $2, current_date, 'test', $1) returning id)
           insert into ledger_entries (tenant_id, journal_id, account_id, debit) select $1, j.id, $3, 100 from j`,
          [A.tenantId, A.campusId, acct.id],
        ),
      ).rejects.toThrow(/does not balance/);
      const q = async (sql: string) => (await owner.query(sql)).rows[0].ok as boolean;
      for (const t of ['ledger_entries', 'ledger_journals', 'fee_invoice_lines']) {
        expect(await q(`select has_table_privilege('erp_app', '${t}', 'UPDATE') as ok`)).toBe(
          false,
        );
        expect(await q(`select has_table_privilege('erp_app', '${t}', 'DELETE') as ok`)).toBe(
          false,
        );
      }
      expect(
        await q(
          `select has_column_privilege('erp_app', 'fee_invoices', 'student_id', 'UPDATE') as ok`,
        ),
      ).toBe(false);
      expect(
        await q(
          `select has_column_privilege('erp_app', 'fee_adjustments', 'amount', 'UPDATE') as ok`,
        ),
      ).toBe(false);
    });

    it('other schools and staff without fee rights see nothing', async () => {
      expect((await B.browser.get(`/fees/students/${kids[0]}`)).status).toBe(404);
      expect((await B.browser.get(`/fees/structures?campusId=${A.campusId}`)).status).toBe(404);
      expect((await B.browser.get(`/fees/accounts?campusId=${A.campusId}`)).status).toBe(404);
      expect((await teacher.get(`/fees/students/${kids[0]}`)).status).toBe(403);
      const bHeads = (await B.browser.get('/fees/heads')).body as Row[];
      expect(bHeads).toHaveLength(0);
    });
  });
});
