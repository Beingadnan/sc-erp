import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { financialYear } from '@school-erp/validation';
import type { PaymentInput, PaymentListQuery } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { OutboxService } from '../tenancy/outbox.service.js';
import { todayIn } from '../attendance/attendance.service.js';
import { ensureFeeBooks, newIds, postJournals, reverseJournals } from './ledger.js';
import type { FeeBooks, SystemAccount } from './ledger.js';
import { renderReceiptPdf } from './receipt-pdf.js';

const pay = schema.feePayments;
const alloc = schema.feeAllocations;
const dc = schema.feeDayClosings;
const cp = schema.campuses;

const PAGE = 50;
const VIEW = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const DAY = 86_400_000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Which asset account a payment mode lands in. */
const accountFor = (mode: string): SystemAccount =>
  mode === 'cash'
    ? 'cash'
    : mode === 'cheque' || mode === 'dd'
      ? 'cheques'
      : mode === 'opening'
        ? 'opening'
        : 'bank';

export interface OpenLine {
  lineId: string;
  invoiceId: string;
  campusId: string;
  dueOn: string;
  kind: string;
  label: string;
  outstanding: number;
}

/** Oldest dues first; within a demand, fees before late fees. */
export function allocateOldestFirst(lines: OpenLine[], amount: number) {
  const sorted = [...lines].sort(
    (a, b) =>
      a.dueOn.localeCompare(b.dueOn) ||
      a.invoiceId.localeCompare(b.invoiceId) ||
      (a.kind === b.kind ? 0 : a.kind === 'fee' ? -1 : 1),
  );
  const out: Array<{ line: OpenLine; amount: number }> = [];
  let left = amount;
  for (const l of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, l.outstanding);
    if (take > 0) {
      out.push({ line: l, amount: take });
      left -= take;
    }
  }
  return out;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private ctx(access: TenantAccess) {
    return { tenantId: access.tenantId, userId: access.userId };
  }

  private async campus(tx: Transaction, campusId: string) {
    const [c] = await tx
      .select({ id: cp.id, code: cp.code, timezone: cp.timezone, name: cp.name })
      .from(cp)
      .where(eq(cp.id, campusId));
    if (!c) throw notFound('Campus');
    return c;
  }

  /** Unpaid demand lines of a student at a campus, with what is still owed on each. */
  async openLines(tx: Transaction, studentId: string, campusId: string): Promise<OpenLine[]> {
    const res = await tx.execute(sql`
      select l.id as "lineId", v.id as "invoiceId", v.campus_id as "campusId", v.due_on::text as "dueOn",
        l.kind, h.name || ' — ' || fs.name || ' (' || i.label || ')' as label,
        (l.amount - app.line_taken(l.tenant_id, l.id, null))::bigint as outstanding
      from fee_invoice_lines l
      join fee_invoices v on v.tenant_id = l.tenant_id and v.id = l.invoice_id
      join fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id
      join fee_structures fs on fs.tenant_id = v.tenant_id and fs.id = v.structure_id
      join fee_installments i on i.tenant_id = v.tenant_id and i.id = v.installment_id
      where v.student_id = ${studentId} and v.campus_id = ${campusId} and v.status = 'active'`);
    return (res.rows as Array<Record<string, unknown>>)
      .map((r) => ({
        lineId: r.lineId as string,
        invoiceId: r.invoiceId as string,
        campusId: r.campusId as string,
        dueOn: r.dueOn as string,
        kind: r.kind as string,
        label: r.label as string,
        outstanding: Number(r.outstanding),
      }))
      .filter((l) => l.outstanding > 0);
  }

  /** The student's latest enrollment at a campus where the caller may take money. */
  async enrollmentFor(
    tx: Transaction,
    access: TenantAccess,
    studentId: string,
    need: string,
    campusId?: string,
  ) {
    const rows = await tx
      .select({
        id: schema.studentEnrollments.id,
        campusId: schema.studentEnrollments.campusId,
        startsOn: schema.academicYears.startsOn,
      })
      .from(schema.studentEnrollments)
      .innerJoin(
        schema.academicYears,
        and(
          eq(schema.academicYears.tenantId, schema.studentEnrollments.tenantId),
          eq(schema.academicYears.id, schema.studentEnrollments.academicYearId),
        ),
      )
      .where(eq(schema.studentEnrollments.studentId, studentId))
      .orderBy(sql`${schema.academicYears.startsOn} desc`);
    const visible = rows.filter((r) => VIEW.some((p) => access.has(p, r.campusId)));
    if (!visible.length) throw notFound('Student');
    const e = visible.find(
      (r) => access.has(need, r.campusId) && (!campusId || r.campusId === campusId),
    );
    if (!e) throw new AppError('FORBIDDEN', 'You cannot take fees for this campus');
    return e;
  }

  private async dayClosed(tx: Transaction, campusId: string, userId: string, date: string) {
    const [row] = await tx
      .select({ id: dc.id })
      .from(dc)
      .where(and(eq(dc.campusId, campusId), eq(dc.cashierId, userId), eq(dc.closedFor, date)));
    return !!row;
  }

  /* -------------------------------------- collect -------------------------------------- */

  collect(access: TenantAccess, input: PaymentInput) {
    return withTenant(this.handle.db, access.ctx, (tx) => this.recordInTx(tx, access, input));
  }

  /**
   * Records money received and issues the receipt. Used by the counter and when staff
   * approve a parent's payment proof (`proofId`).
   */
  async recordInTx(
    tx: Transaction,
    access: TenantAccess,
    input: Omit<PaymentInput, 'mode'> & { mode: PaymentInput['mode'] | 'opening' },
    extra: { proofId?: string; campusId?: string; need?: string } = {},
  ) {
    // `opening`: an advance brought in from old records (no money received today).
    const opening = input.mode === 'opening';
    {
      // The same attempt twice (double click, retry after a timeout) returns the first receipt.
      const [again] = await tx
        .select({ id: pay.id, studentId: pay.studentId })
        .from(pay)
        .where(eq(pay.idempotencyKey, input.idempotencyKey));
      if (again) {
        if (again.studentId !== input.studentId) {
          throw new AppError('CONFLICT', 'This payment key was already used for another student');
        }
        return { ...(await this.summary(tx, again.id)), repeated: true };
      }
      const e = await this.enrollmentFor(
        tx,
        access,
        input.studentId,
        extra.need ?? 'fees.collect',
        extra.campusId,
      );
      // One payment at a time per student, so two counters cannot settle the same dues.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`pay:${input.studentId}`}, 0))`,
      );

      const campus = await this.campus(tx, e.campusId);
      const today = todayIn(campus.timezone);
      const receivedOn = input.receivedOn ?? today;
      if (receivedOn > today)
        throw new AppError('VALIDATION_FAILED', 'The date cannot be in the future');
      if (!opening && receivedOn < shift(today, -30)) {
        throw new AppError('VALIDATION_FAILED', 'Payments older than 30 days cannot be entered');
      }
      if (!opening && (await this.dayClosed(tx, e.campusId, access.userId, receivedOn))) {
        throw new AppError('CONFLICT', 'You have closed your collection for this day');
      }

      const open = await this.openLines(tx, input.studentId, e.campusId);
      let plan: Array<{ line: OpenLine; amount: number }>;
      if (input.allocations) {
        const byId = new Map(open.map((l) => [l.lineId, l]));
        plan = input.allocations.map((a) => {
          const line = byId.get(a.lineId);
          if (!line)
            throw new AppError('VALIDATION_FAILED', 'A chosen fee is not due from this student');
          if (a.amount > line.outstanding) {
            throw new AppError('VALIDATION_FAILED', `More than is due on ${line.label}`);
          }
          return { line, amount: a.amount };
        });
      } else {
        plan = allocateOldestFirst(open, input.amount);
      }
      const allocated = plan.reduce((n, p) => n + p.amount, 0);
      const advance = input.amount - allocated;

      const books = await ensureFeeBooks(tx, access.tenantId);
      const [{ last }] = (
        await tx.execute(sql`
          insert into number_counters (tenant_id, counter_key, last_value)
          values (${access.tenantId}, ${`${opening ? 'opening' : 'receipt'}:${e.campusId}:${financialYear(receivedOn)}`}, 1)
          on conflict (tenant_id, counter_key) do update set last_value = number_counters.last_value + 1
          returning last_value as last`)
      ).rows as [{ last: number }];
      const receiptNumber = `${opening ? 'OB/' : ''}${campus.code}/${financialYear(receivedOn)}/${String(last).padStart(5, '0')}`;
      const pending = input.mode === 'cheque' || input.mode === 'dd';
      const [paymentId] = await newIds(tx, 1);
      try {
        await tx.insert(pay).values({
          id: paymentId,
          tenantId: access.tenantId,
          campusId: e.campusId,
          studentId: input.studentId,
          enrollmentId: e.id,
          receiptNumber,
          receivedOn,
          mode: input.mode,
          amount: input.amount,
          reference: input.reference,
          bankName: input.bankName,
          instrumentDate: input.instrumentDate ?? null,
          payerName: input.payerName,
          note: input.note,
          status: pending ? 'pending' : 'cleared',
          clearedOn: pending ? null : receivedOn,
          collectedBy: access.userId,
          idempotencyKey: input.idempotencyKey,
          proofId: extra.proofId ?? null,
        });
      } catch (err) {
        if (/fee_payments_idempotency_uq/.test(String((err as { cause?: unknown }).cause ?? err))) {
          throw new AppError(
            'CONFLICT',
            'This payment is already being recorded; refresh to see it',
          );
        }
        throw err;
      }
      const [journalId] = await postJournals(tx, this.ctx(access), [
        {
          campusId: e.campusId,
          postedOn: receivedOn,
          sourceType: 'payment',
          sourceId: paymentId!,
          memo: `Receipt ${receiptNumber}`,
          entries: [
            { accountId: books.accounts[accountFor(input.mode)], debit: input.amount },
            { accountId: books.accounts.receivable, studentId: input.studentId, credit: allocated },
            { accountId: books.accounts.advance, studentId: input.studentId, credit: advance },
          ],
        },
      ]);
      if (plan.length) {
        await tx.insert(alloc).values(
          plan.map((p) => ({
            tenantId: access.tenantId,
            paymentId: paymentId!,
            invoiceId: p.line.invoiceId,
            lineId: p.line.lineId,
            amount: p.amount,
            source: 'payment',
            journalId: journalId!,
          })),
        );
      }
      await this.outbox.emit(
        tx,
        { tenantId: access.tenantId, requestId: access.requestId },
        'fees.payment_received',
        {
          paymentId: paymentId!,
          studentId: input.studentId,
          receiptNumber,
          amount: input.amount,
          mode: input.mode,
        },
      );
      await this.audit.record(tx, access, {
        action: 'fees.payment_received',
        entity: 'fee_payment',
        entityId: paymentId!,
        campusId: e.campusId,
        diff: {
          receiptNumber,
          studentId: input.studentId,
          amount: input.amount,
          mode: input.mode,
          allocated,
          advance,
        },
      });
      return { ...(await this.summary(tx, paymentId!)), repeated: false };
    }
  }

  private async summary(tx: Transaction, id: string) {
    // Raw SQL with an alias: in single-table drizzle selects, columns inside a subquery
    // would be written unqualified and bind to the inner table.
    const [p] = (
      await tx.execute(sql`
        select p.id, p.receipt_number as "receiptNumber", p.amount::bigint as amount, p.status,
          p.received_on::text as "receivedOn",
          coalesce((select sum(x.amount) from fee_allocations x
            where x.tenant_id = p.tenant_id and x.payment_id = p.id), 0)::bigint as allocated
        from fee_payments p where p.id = ${id}`)
    ).rows as Array<Record<string, unknown>>;
    const amount = Number(p!.amount);
    const allocated = Number(p!.allocated);
    return {
      id: p!.id as string,
      receiptNumber: p!.receiptNumber as string,
      amount,
      status: p!.status as string,
      receivedOn: p!.receivedOn as string,
      allocated,
      advance: amount - allocated,
    };
  }

  /* ----------------------------------- cheques, cancel ----------------------------------- */

  private async paymentRow(tx: Transaction, access: TenantAccess, id: string, need?: string) {
    const [p] = await tx.select().from(pay).where(eq(pay.id, id));
    if (!p || !VIEW.some((x) => access.has(x, p.campusId))) throw notFound('Receipt');
    if (need && !access.has(need, p.campusId)) {
      throw new AppError('FORBIDDEN', 'You cannot do this for this campus');
    }
    return p;
  }

  /** Journals a receipt posted (receipt, clearance, advance applied) that are still standing. */
  private async liveJournals(tx: Transaction, paymentId: string) {
    const res = await tx.execute(sql`
      select j.id from ledger_journals j
      where j.source_id = ${paymentId} and j.source_type in ('payment', 'payment_clear', 'advance', 'release')
        and j.reverses_id is null
        and not exists (select 1 from ledger_journals r where r.tenant_id = j.tenant_id and r.reverses_id = j.id)`);
    return (res.rows as Array<{ id: string }>).map((r) => r.id);
  }

  clearCheque(access: TenantAccess, id: string, clearedOn?: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const p = await this.paymentRow(tx, access, id, 'fees.collect');
      if (p.status !== 'pending') throw new AppError('CONFLICT', `The receipt is ${p.status}`);
      const campus = await this.campus(tx, p.campusId);
      const on = clearedOn ?? todayIn(campus.timezone);
      if (on < p.receivedOn || on > todayIn(campus.timezone)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Clearing date must be between receipt date and today',
        );
      }
      const books = await ensureFeeBooks(tx, access.tenantId);
      await postJournals(tx, this.ctx(access), [
        {
          campusId: p.campusId,
          postedOn: on,
          sourceType: 'payment_clear',
          sourceId: id,
          memo: `Cheque cleared — ${p.receiptNumber}`,
          entries: [
            { accountId: books.accounts.bank, debit: p.amount },
            { accountId: books.accounts.cheques, credit: p.amount },
          ],
        },
      ]);
      await tx.update(pay).set({ status: 'cleared', clearedOn: on }).where(eq(pay.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.cheque_cleared',
        entity: 'fee_payment',
        entityId: id,
        campusId: p.campusId,
        diff: { receiptNumber: p.receiptNumber, clearedOn: on },
      });
      return { id, status: 'cleared' };
    });
  }

  /** A bounced cheque undoes the receipt: dues reopen, and the ledger is reversed. */
  bounceCheque(access: TenantAccess, id: string, reason: string, bouncedOn?: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const p = await this.paymentRow(tx, access, id, 'fees.collect');
      if (p.status !== 'pending') {
        throw new AppError('CONFLICT', 'Only cheques awaiting clearance can bounce');
      }
      const campus = await this.campus(tx, p.campusId);
      const on = bouncedOn ?? todayIn(campus.timezone);
      await reverseJournals(
        tx,
        this.ctx(access),
        await this.liveJournals(tx, id),
        on,
        `Cheque bounced: ${reason}`,
      );
      await tx
        .update(pay)
        .set({ status: 'bounced', bouncedOn: on, bounceReason: reason })
        .where(eq(pay.id, id));
      await this.outbox.emit(
        tx,
        { tenantId: access.tenantId, requestId: access.requestId },
        'fees.cheque_bounced',
        { paymentId: id, studentId: p.studentId, receiptNumber: p.receiptNumber, amount: p.amount },
      );
      await this.audit.record(tx, access, {
        action: 'fees.cheque_bounced',
        entity: 'fee_payment',
        entityId: id,
        campusId: p.campusId,
        diff: { receiptNumber: p.receiptNumber, reason },
      });
      return { id, status: 'bounced' };
    });
  }

  /** Cancels a receipt: the number stays used, the ledger is reversed, dues reopen. */
  cancel(access: TenantAccess, id: string, reason: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const p = await this.paymentRow(tx, access, id, 'fees.cancel_receipt');
      if (p.status !== 'cleared' && p.status !== 'pending') {
        throw new AppError('CONFLICT', `The receipt is already ${p.status}`);
      }
      const refunded = await tx.execute(sql`
        select 1 from fee_refund_parts rp join fee_refunds r on r.tenant_id = rp.tenant_id and r.id = rp.refund_id
        where r.status <> 'rejected' and (rp.payment_id = ${id} or rp.line_id in (
          select x.line_id from fee_allocations x where x.payment_id = ${id} and x.released_at is null))
        limit 1`);
      if (refunded.rows.length) {
        throw new AppError(
          'CONFLICT',
          'Money from this receipt has been refunded; it cannot be cancelled',
        );
      }
      const campus = await this.campus(tx, p.campusId);
      await reverseJournals(
        tx,
        this.ctx(access),
        await this.liveJournals(tx, id),
        todayIn(campus.timezone),
        `Receipt ${p.receiptNumber} cancelled: ${reason}`,
      );
      await tx
        .update(pay)
        .set({
          status: 'cancelled',
          cancelReason: reason,
          cancelledBy: access.userId,
          cancelledAt: new Date(),
        })
        .where(eq(pay.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.receipt_cancelled',
        entity: 'fee_payment',
        entityId: id,
        campusId: p.campusId,
        diff: { receiptNumber: p.receiptNumber, amount: p.amount, reason },
      });
      return { id, status: 'cancelled' };
    });
  }

  /** Uses money held in advance to settle dues raised since. */
  applyAdvance(access: TenantAccess, studentId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.enrollmentFor(tx, access, studentId, 'fees.collect');
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`pay:${studentId}`}, 0))`,
      );
      const credits = (
        await tx.execute(sql`
          select p.id, p.receipt_number as "receiptNumber",
            (p.amount - app.payment_used(p.tenant_id, p.id))::bigint as left
          from fee_payments p
          where p.student_id = ${studentId} and p.campus_id = ${e.campusId} and p.status in ('cleared', 'pending')
          order by p.received_on, p.created_at`)
      ).rows
        .map((r: Record<string, unknown>) => ({
          id: r.id as string,
          receiptNumber: r.receiptNumber as string,
          left: Number(r.left),
        }))
        .filter((c) => c.left > 0);
      let open = await this.openLines(tx, studentId, e.campusId);
      if (!credits.length || !open.length) return { applied: 0 };
      const books = await ensureFeeBooks(tx, access.tenantId);
      const campus = await this.campus(tx, e.campusId);
      const today = todayIn(campus.timezone);
      let applied = 0;
      for (const c of credits) {
        const plan = allocateOldestFirst(open, c.left);
        const total = plan.reduce((n, p) => n + p.amount, 0);
        if (!total) break;
        const [journalId] = await postJournals(tx, this.ctx(access), [
          {
            campusId: e.campusId,
            postedOn: today,
            sourceType: 'advance',
            sourceId: c.id,
            memo: `Advance from ${c.receiptNumber} applied`,
            entries: [
              { accountId: books.accounts.advance, studentId, debit: total },
              { accountId: books.accounts.receivable, studentId, credit: total },
            ],
          },
        ]);
        await tx.insert(alloc).values(
          plan.map((p) => ({
            tenantId: access.tenantId,
            paymentId: c.id,
            invoiceId: p.line.invoiceId,
            lineId: p.line.lineId,
            amount: p.amount,
            source: 'advance',
            journalId: journalId!,
          })),
        );
        applied += total;
        const used = new Map(plan.map((p) => [p.line.lineId, p.amount]));
        open = open
          .map((l) => ({ ...l, outstanding: l.outstanding - (used.get(l.lineId) ?? 0) }))
          .filter((l) => l.outstanding > 0);
      }
      await this.audit.record(tx, access, {
        action: 'fees.advance_applied',
        entity: 'student',
        entityId: studentId,
        campusId: e.campusId,
        diff: { applied },
      });
      return { applied };
    });
  }

  /* --------------------------------------- reads --------------------------------------- */

  list(access: TenantAccess, q: PaymentListQuery) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!VIEW.some((p) => access.has(p, q.campusId))) throw notFound('Campus');
        const campus = await this.campus(tx, q.campusId);
        const today = todayIn(campus.timezone);
        const from = q.from ?? today;
        const to = q.to ?? today;
        const conds: SQL[] = [
          sql`p.campus_id = ${q.campusId}`,
          sql`p.received_on between ${from} and ${to}`,
        ];
        if (q.mode) conds.push(sql`p.mode = ${q.mode}`);
        if (q.status) conds.push(sql`p.status = ${q.status}`);
        if (q.cashierId) conds.push(sql`p.collected_by = ${q.cashierId}`);
        if (q.q) {
          const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          conds.push(
            sql`(p.receipt_number ilike ${like} or s.admission_number ilike ${like} or p.reference ilike ${like}
              or (s.first_name || ' ' || s.last_name) ilike ${like})`,
          );
        }
        const where = sql.join(conds, sql` and `);
        const rows = await tx.execute(sql`
          select p.id, p.receipt_number as "receiptNumber", p.received_on::text as "receivedOn", p.mode,
            p.amount::bigint as amount, p.reference, p.status, p.student_id as "studentId",
            trim(s.first_name || ' ' || s.last_name) as "studentName", s.admission_number as "admissionNumber",
            u.full_name as "collectedBy", p.closing_id is not null as "dayClosed", p.created_at as "createdAt",
            count(*) over() as "totalCount"
          from fee_payments p
          join students s on s.tenant_id = p.tenant_id and s.id = p.student_id
          left join users u on u.id = p.collected_by
          where ${where}
          order by p.received_on desc, p.created_at desc
          limit ${PAGE} offset ${(q.page - 1) * PAGE}`);
        const totals = await tx.execute(sql`
          select p.mode, count(*)::int as receipts, sum(p.amount)::bigint as amount
          from fee_payments p join students s on s.tenant_id = p.tenant_id and s.id = p.student_id
          where ${where} and p.status in ('cleared', 'pending')
          group by p.mode order by p.mode`);
        const list = rows.rows as Array<Record<string, unknown>>;
        const byMode = (totals.rows as Array<Record<string, unknown>>).map((t) => ({
          mode: t.mode as string,
          receipts: Number(t.receipts),
          amount: Number(t.amount),
        }));
        return {
          from,
          to,
          page: q.page,
          pageSize: PAGE,
          total: list[0] ? Number(list[0].totalCount) : 0,
          byMode,
          totalAmount: byMode.reduce((n, m) => n + m.amount, 0),
          data: list.map(({ totalCount: _t, ...r }) => ({ ...r, amount: Number(r.amount) })),
          can: {
            collect: access.has('fees.collect', q.campusId),
            cancel: access.has('fees.cancel_receipt', q.campusId),
          },
        };
      },
      { readOnly: true },
    );
  }

  private async details(tx: Transaction, id: string) {
    const [row] = (
      await tx.execute(sql`
        select p.*, p.received_on::text as received_on_text, p.instrument_date::text as instrument_date_text,
          trim(s.first_name || ' ' || s.last_name) as student_name, s.admission_number,
          g.name || ' ' || sec.name as class_name, c.name as campus_name, c.address as campus_address,
          t.name as school_name, u.full_name as collected_by_name,
          (select gu.full_name from student_guardians sg join guardians gu
             on gu.tenant_id = sg.tenant_id and gu.id = sg.guardian_id
           where sg.tenant_id = p.tenant_id and sg.student_id = p.student_id and sg.is_primary limit 1) as guardian_name
        from fee_payments p
        join students s on s.tenant_id = p.tenant_id and s.id = p.student_id
        join student_enrollments e on e.tenant_id = p.tenant_id and e.id = p.enrollment_id
        join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
        join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
        join campuses c on c.tenant_id = p.tenant_id and c.id = p.campus_id
        join tenants t on t.id = p.tenant_id
        left join users u on u.id = p.collected_by
        where p.id = ${id}`)
    ).rows as Array<Record<string, unknown>>;
    const lines = (
      await tx.execute(sql`
        select h.name || ' — ' || i.label as label, sum(x.amount)::bigint as amount, x.source
        from fee_allocations x
        join fee_invoice_lines l on l.tenant_id = x.tenant_id and l.id = x.line_id
        join fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id
        join fee_invoices v on v.tenant_id = x.tenant_id and v.id = x.invoice_id
        join fee_installments i on i.tenant_id = v.tenant_id and i.id = v.installment_id
        where x.payment_id = ${id}
        group by h.name, i.label, i.seq, h.sort_order, x.source
        order by x.source desc, i.seq, h.sort_order`)
    ).rows as Array<Record<string, unknown>>;
    return { row: row!, lines };
  }

  get(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const p = await this.paymentRow(tx, access, id);
        const { row, lines } = await this.details(tx, id);
        const onReceipt = lines.filter((l) => l.source === 'payment');
        const allocated = onReceipt.reduce((n, l) => n + Number(l.amount), 0);
        return {
          id: p.id,
          receiptNumber: p.receiptNumber,
          receivedOn: p.receivedOn,
          mode: p.mode,
          amount: p.amount,
          reference: p.reference,
          bankName: p.bankName,
          instrumentDate: p.instrumentDate,
          payerName: p.payerName,
          note: p.note,
          status: p.status,
          clearedOn: p.clearedOn,
          bouncedOn: p.bouncedOn,
          reason: p.cancelReason ?? p.bounceReason,
          studentId: p.studentId,
          studentName: row.student_name as string,
          admissionNumber: row.admission_number as string,
          className: row.class_name as string,
          collectedBy: row.collected_by_name as string | null,
          dayClosed: !!p.closingId,
          lines: lines.map((l) => ({
            label: l.label as string,
            amount: Number(l.amount),
            laterFromAdvance: l.source === 'advance',
          })),
          advanceOnReceipt: p.amount - allocated,
          can: {
            clear: p.status === 'pending' && access.has('fees.collect', p.campusId),
            cancel:
              (p.status === 'cleared' || p.status === 'pending') &&
              access.has('fees.cancel_receipt', p.campusId),
          },
        };
      },
      { readOnly: true },
    );
  }

  receiptPdf(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.paymentRow(tx, access, id);
        return this.receiptPdfInTx(tx, id);
      },
      { readOnly: true },
    );
  }

  /** Renders a receipt; the caller has already checked who may see it. */
  async receiptPdfInTx(tx: Transaction, id: string) {
    const [p] = await tx.select().from(pay).where(eq(pay.id, id));
    if (!p) throw notFound('Receipt');
    const { row, lines } = await this.details(tx, id);
    const onReceipt = lines.filter((l) => l.source === 'payment');
    const allocated = onReceipt.reduce((n, l) => n + Number(l.amount), 0);
    const bytes = await renderReceiptPdf({
      schoolName: row.school_name as string,
      campusName: row.campus_name as string,
      campusAddress: (row.campus_address as string | null) ?? null,
      receiptNumber: p.receiptNumber,
      receivedOn: p.receivedOn,
      studentName: row.student_name as string,
      admissionNumber: row.admission_number as string,
      className: row.class_name as string,
      guardianName: (row.guardian_name as string | null) ?? null,
      mode: p.mode,
      reference: p.reference,
      bankName: p.bankName,
      instrumentDate: p.instrumentDate,
      status: p.status,
      amount: p.amount,
      lines: onReceipt.map((l) => ({ label: l.label as string, amount: Number(l.amount) })),
      advance: p.amount - allocated,
      collectedBy: (row.collected_by_name as string | null) ?? null,
      note: p.note,
    });
    return { bytes, fileName: `receipt-${p.receiptNumber.replace(/[^A-Za-z0-9-]/g, '_')}.pdf` };
  }

  /* ------------------------------------- day closing ------------------------------------- */

  /** The caller's own collection for a day at a campus. */
  myDay(access: TenantAccess, campusId: string, date?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!access.has('fees.collect', campusId)) throw notFound('Campus');
        const campus = await this.campus(tx, campusId);
        const on = date ?? todayIn(campus.timezone);
        return this.dayFigures(tx, campusId, access.userId, on);
      },
      { readOnly: true },
    );
  }

  private async dayFigures(tx: Transaction, campusId: string, userId: string, on: string) {
    const rows = (
      await tx.execute(sql`
        select p.mode, p.status, count(*)::int as receipts, sum(p.amount)::bigint as amount
        from fee_payments p
        where p.campus_id = ${campusId} and p.collected_by = ${userId} and p.received_on = ${on}
          and p.mode <> 'opening'
        group by p.mode, p.status`)
    ).rows as Array<{ mode: string; status: string; receipts: number; amount: string }>;
    const live = rows.filter((r) => r.status === 'cleared' || r.status === 'pending');
    const totals: Record<string, number> = {};
    for (const r of live) totals[r.mode] = (totals[r.mode] ?? 0) + Number(r.amount);
    const [closing] = await tx
      .select()
      .from(dc)
      .where(and(eq(dc.campusId, campusId), eq(dc.cashierId, userId), eq(dc.closedFor, on)));
    return {
      date: on,
      receipts: rows.reduce((n, r) => n + r.receipts, 0),
      cancelled: rows.filter((r) => r.status === 'cancelled').reduce((n, r) => n + r.receipts, 0),
      totals,
      total: Object.values(totals).reduce((n, v) => n + v, 0),
      cashExpected: totals.cash ?? 0,
      closing: closing
        ? {
            id: closing.id,
            closedAt: closing.closedAt,
            cashCounted: closing.cashCounted,
            cashExpected: closing.cashExpected,
            difference: closing.cashCounted - closing.cashExpected,
            note: closing.note,
          }
        : null,
    };
  }

  closeDay(
    access: TenantAccess,
    input: { campusId: string; date: string; cashCounted: number; note: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (!access.has('fees.collect', input.campusId)) throw notFound('Campus');
      const campus = await this.campus(tx, input.campusId);
      if (input.date > todayIn(campus.timezone)) {
        throw new AppError('VALIDATION_FAILED', 'A future day cannot be closed');
      }
      // Serialise with receipts being written by this cashier.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`close:${access.userId}`}, 0))`,
      );
      const fig = await this.dayFigures(tx, input.campusId, access.userId, input.date);
      if (fig.closing) throw new AppError('CONFLICT', 'This day is already closed');
      const diff = input.cashCounted - fig.cashExpected;
      if (diff !== 0 && input.note.length < 3) {
        throw new AppError('VALIDATION_FAILED', 'Explain the difference in cash', {
          fields: { note: 'Required when the cash does not match' },
        });
      }
      const [row] = await tx
        .insert(dc)
        .values({
          tenantId: access.tenantId,
          campusId: input.campusId,
          cashierId: access.userId,
          closedFor: input.date,
          receipts: fig.receipts,
          totals: fig.totals,
          cashExpected: fig.cashExpected,
          cashCounted: input.cashCounted,
          note: input.note,
          closedBy: access.userId,
        })
        .returning({ id: dc.id });
      await tx.execute(sql`
        update fee_payments set closing_id = ${row!.id}
        where campus_id = ${input.campusId} and collected_by = ${access.userId}
          and received_on = ${input.date} and closing_id is null`);
      await this.audit.record(tx, access, {
        action: 'fees.day_closed',
        entity: 'campus',
        entityId: input.campusId,
        campusId: input.campusId,
        diff: {
          date: input.date,
          total: fig.total,
          cashExpected: fig.cashExpected,
          cashCounted: input.cashCounted,
        },
      });
      return { id: row!.id, difference: diff };
    });
  }

  closings(access: TenantAccess, campusId: string, from?: string, to?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!VIEW.some((p) => access.has(p, campusId))) throw notFound('Campus');
        const campus = await this.campus(tx, campusId);
        const today = todayIn(campus.timezone);
        const res = await tx.execute(sql`
          select d.id, d.closed_for::text as "closedFor", d.receipts, d.totals, d.cash_expected::bigint as "cashExpected",
            d.cash_counted::bigint as "cashCounted", d.note, d.closed_at as "closedAt", u.full_name as cashier
          from fee_day_closings d left join users u on u.id = d.cashier_id
          where d.campus_id = ${campusId} and d.closed_for between ${from ?? shift(today, -30)} and ${to ?? today}
          order by d.closed_for desc, u.full_name`);
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          cashExpected: Number(r.cashExpected),
          cashCounted: Number(r.cashCounted),
          difference: Number(r.cashCounted) - Number(r.cashExpected),
        }));
      },
      { readOnly: true },
    );
  }
}

export type { FeeBooks };
