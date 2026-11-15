import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { financialYear, formatInr } from '@school-erp/validation';
import type { RefundRequestInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { OutboxService } from '../tenancy/outbox.service.js';
import { todayIn } from '../attendance/attendance.service.js';
import { ensureFeeBooks, postJournals } from './ledger.js';
import { PaymentsService } from './payments.service.js';

const rf = schema.feeRefunds;
const parts = schema.feeRefundParts;
const VIEW = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const DAY = 86_400_000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

type Rows = Array<Record<string, unknown>>;

interface Source {
  paymentId?: string;
  invoiceId?: string;
  lineId?: string;
  accountId?: string;
  label: string;
  available: number;
}

/**
 * Money going back to a family: unused advance, or a refundable deposit. One person asks,
 * a different person approves and pays (maker-checker). The amount is reserved when asked
 * for, so it cannot be applied to fees or refunded twice meanwhile.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
  ) {}

  private ctx(access: TenantAccess) {
    return { tenantId: access.tenantId, userId: access.userId };
  }

  /** Unused advance by receipt (oldest first), and paid deposits not yet refunded. */
  private async sources(tx: Transaction, studentId: string, campusId: string) {
    const advance = (
      await tx.execute(sql`
        select p.id as "paymentId", p.receipt_number as label,
          (p.amount - app.payment_used(p.tenant_id, p.id))::bigint as available
        from fee_payments p
        where p.student_id = ${studentId} and p.campus_id = ${campusId} and p.status = 'cleared'
        order by p.received_on, p.id`)
    ).rows as Rows;
    const deposits = (
      await tx.execute(sql`
        select l.id as "lineId", v.id as "invoiceId", h.income_account_id as "accountId",
          h.name || ' — ' || i.label as label,
          (coalesce((select sum(a.amount) from fee_allocations a
              join fee_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
            where a.tenant_id = l.tenant_id and a.line_id = l.id and a.released_at is null and p.status = 'cleared'), 0)
           - coalesce((select sum(rp.amount) from fee_refund_parts rp
              join fee_refunds r on r.tenant_id = rp.tenant_id and r.id = rp.refund_id
            where rp.tenant_id = l.tenant_id and rp.line_id = l.id and r.status <> 'rejected'), 0))::bigint as available
        from fee_invoice_lines l
        join fee_invoices v on v.tenant_id = l.tenant_id and v.id = l.invoice_id
        join fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id
        join fee_installments i on i.tenant_id = v.tenant_id and i.id = v.installment_id
        where v.student_id = ${studentId} and v.campus_id = ${campusId} and h.refundable
        order by v.due_on, l.id`)
    ).rows as Rows;
    const shape = (r: Record<string, unknown>): Source => ({
      paymentId: (r.paymentId as string) ?? undefined,
      invoiceId: (r.invoiceId as string) ?? undefined,
      lineId: (r.lineId as string) ?? undefined,
      accountId: (r.accountId as string) ?? undefined,
      label: r.label as string,
      available: Number(r.available),
    });
    return {
      advance: advance.map(shape).filter((s) => s.available > 0),
      deposit: deposits.map(shape).filter((s) => s.available > 0),
    };
  }

  refundable(access: TenantAccess, studentId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const e = await this.payments.enrollmentFor(tx, access, studentId, 'fees.refund');
        const s = await this.sources(tx, studentId, e.campusId);
        return {
          campusId: e.campusId,
          advance: s.advance.reduce((n, x) => n + x.available, 0),
          deposit: s.deposit.reduce((n, x) => n + x.available, 0),
          deposits: s.deposit.map((d) => ({
            lineId: d.lineId,
            label: d.label,
            available: d.available,
          })),
        };
      },
      { readOnly: true },
    );
  }

  request(access: TenantAccess, input: RefundRequestInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.payments.enrollmentFor(tx, access, input.studentId, 'fees.refund');
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`pay:${input.studentId}`}, 0))`,
      );
      const all = (await this.sources(tx, input.studentId, e.campusId))[input.source];
      const held = all.reduce((n, s) => n + s.available, 0);
      if (input.amount > held) {
        throw new AppError(
          'CONFLICT',
          held
            ? `Only ${formatInr(held)} can be refunded from the ${input.source === 'advance' ? 'advance' : 'deposit'}`
            : input.source === 'advance'
              ? 'The student has no unused advance'
              : 'No paid deposit is left to refund',
        );
      }
      const id = newId();
      await tx.insert(rf).values({
        id,
        tenantId: access.tenantId,
        campusId: e.campusId,
        studentId: input.studentId,
        enrollmentId: e.id,
        amount: input.amount,
        source: input.source,
        mode: input.mode,
        reason: input.reason,
        requestedBy: access.userId,
      });
      let left = input.amount;
      const rows: Array<typeof parts.$inferInsert> = [];
      for (const s of all) {
        if (left <= 0) break;
        const take = Math.min(left, s.available);
        left -= take;
        rows.push({
          tenantId: access.tenantId,
          refundId: id,
          paymentId: s.paymentId ?? null,
          invoiceId: s.invoiceId ?? null,
          lineId: s.lineId ?? null,
          amount: take,
        });
      }
      await tx.insert(parts).values(rows);
      await this.audit.record(tx, access, {
        action: 'fees.refund_requested',
        entity: 'fee_refund',
        entityId: id,
        campusId: e.campusId,
        diff: {
          studentId: input.studentId,
          amount: input.amount,
          source: input.source,
          reason: input.reason,
        },
      });
      return { id, status: 'requested', amount: input.amount };
    });
  }

  private async row(tx: Transaction, access: TenantAccess, id: string, need?: string) {
    const [r] = await tx.select().from(rf).where(eq(rf.id, id));
    if (
      !r ||
      (!VIEW.some((p) => access.has(p, r.campusId)) && !access.has('fees.refund', r.campusId))
    ) {
      throw notFound('Refund');
    }
    if (need && !access.has(need, r.campusId)) {
      throw new AppError('FORBIDDEN', 'You cannot approve refunds for this campus');
    }
    return r;
  }

  /** Approve and record that the money was paid out. */
  pay(
    access: TenantAccess,
    id: string,
    input: { mode?: string; reference: string; paidOn?: string; note: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`refund:${id}`}, 0))`);
      const r = await this.row(tx, access, id, 'fees.cancel_receipt');
      if (r.status !== 'requested')
        throw new AppError('CONFLICT', `The refund is already ${r.status}`);
      if (r.requestedBy === access.userId) {
        throw new AppError(
          'FORBIDDEN',
          'Someone other than the person who asked must approve a refund',
        );
      }
      const [c] = await tx
        .select({ code: schema.campuses.code, timezone: schema.campuses.timezone })
        .from(schema.campuses)
        .where(eq(schema.campuses.id, r.campusId));
      const today = todayIn(c!.timezone);
      const paidOn = input.paidOn ?? today;
      if (paidOn > today)
        throw new AppError('VALIDATION_FAILED', 'The date cannot be in the future');
      if (paidOn < shift(today, -30)) {
        throw new AppError('VALIDATION_FAILED', 'Refunds older than 30 days cannot be entered');
      }
      const mode = input.mode ?? r.mode;
      if (mode !== 'cash' && input.reference.trim().length < 4) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Enter the cheque number or transaction reference',
          {
            fields: { reference: 'Required' },
          },
        );
      }
      const books = await ensureFeeBooks(tx, access.tenantId);
      const myParts = (
        await tx.execute(sql`
          select rp.amount::bigint as amount, h.income_account_id as "accountId"
          from fee_refund_parts rp
          left join fee_invoice_lines l on l.tenant_id = rp.tenant_id and l.id = rp.line_id
          left join fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id
          where rp.refund_id = ${id}`)
      ).rows as Array<{ amount: string; accountId: string | null }>;
      const debits = new Map<string, number>();
      for (const p of myParts) {
        const acct = r.source === 'advance' ? books.accounts.advance : p.accountId!;
        debits.set(acct, (debits.get(acct) ?? 0) + Number(p.amount));
      }
      const fy = financialYear(paidOn);
      const [{ last }] = (
        await tx.execute(sql`
          insert into number_counters (tenant_id, counter_key, last_value)
          values (${access.tenantId}, ${`refund:${r.campusId}:${fy}`}, 1)
          on conflict (tenant_id, counter_key) do update set last_value = number_counters.last_value + 1
          returning last_value as last`)
      ).rows as [{ last: number }];
      const refundNumber = `RF/${c!.code}/${fy}/${String(last).padStart(5, '0')}`;
      const [journalId] = await postJournals(tx, this.ctx(access), [
        {
          campusId: r.campusId,
          postedOn: paidOn,
          sourceType: 'refund',
          sourceId: id,
          memo: `Refund ${refundNumber}`,
          entries: [
            ...[...debits].map(([accountId, debit]) => ({
              accountId,
              studentId: r.studentId,
              debit,
            })),
            { accountId: books.accounts[mode === 'cash' ? 'cash' : 'bank'], credit: r.amount },
          ],
        },
      ]);
      await tx
        .update(rf)
        .set({
          status: 'paid',
          refundNumber,
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: input.note,
          paidOn,
          journalId: journalId!,
          reference: input.reference.trim(),
        })
        .where(eq(rf.id, id));
      await this.outbox.emit(
        tx,
        { tenantId: access.tenantId, requestId: access.requestId },
        'fees.refund_paid',
        { refundId: id, studentId: r.studentId, refundNumber, amount: r.amount },
      );
      await this.audit.record(tx, access, {
        action: 'fees.refund_paid',
        entity: 'fee_refund',
        entityId: id,
        campusId: r.campusId,
        diff: { refundNumber, amount: r.amount, source: r.source, mode },
      });
      return { id, status: 'paid', refundNumber, amount: r.amount };
    });
  }

  reject(access: TenantAccess, id: string, note: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`refund:${id}`}, 0))`);
      const r = await this.row(tx, access, id, 'fees.cancel_receipt');
      if (r.status !== 'requested')
        throw new AppError('CONFLICT', `The refund is already ${r.status}`);
      await tx
        .update(rf)
        .set({
          status: 'rejected',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: note,
        })
        .where(eq(rf.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.refund_rejected',
        entity: 'fee_refund',
        entityId: id,
        campusId: r.campusId,
        diff: { amount: r.amount, note },
      });
      return { id, status: 'rejected' };
    });
  }

  list(access: TenantAccess, q: { campusId: string; status?: string; studentId?: string }) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (
          !VIEW.some((p) => access.has(p, q.campusId)) &&
          !access.has('fees.refund', q.campusId)
        ) {
          throw notFound('Campus');
        }
        const [campus] = await tx
          .select({ id: schema.campuses.id })
          .from(schema.campuses)
          .where(eq(schema.campuses.id, q.campusId));
        if (!campus) throw notFound('Campus');
        const rows = (
          await tx.execute(sql`
            select r.id, r.refund_number as "refundNumber", r.student_id as "studentId",
              trim(s.first_name || ' ' || s.last_name) as "studentName", s.admission_number as "admissionNumber",
              r.amount::bigint as amount, r.source, r.mode, r.reference, r.reason, r.status,
              r.created_at as "createdAt", r.paid_on::text as "paidOn", r.decision_note as "decisionNote",
              r.requested_by as "requestedBy", rq.full_name as "requestedByName", dc.full_name as "decidedByName"
            from fee_refunds r
            join students s on s.tenant_id = r.tenant_id and s.id = r.student_id
            left join users rq on rq.id = r.requested_by
            left join users dc on dc.id = r.decided_by
            where r.campus_id = ${q.campusId}
              ${q.status ? sql`and r.status = ${q.status}` : sql``}
              ${q.studentId ? sql`and r.student_id = ${q.studentId}` : sql``}
            order by r.created_at desc limit 200`)
        ).rows as Rows;
        return {
          items: rows.map((r) => ({
            ...r,
            amount: Number(r.amount),
            mine: r.requestedBy === access.userId,
          })),
        };
      },
      { readOnly: true },
    );
  }
}
