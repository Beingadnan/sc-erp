import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { notFound } from '@school-erp/shared';
import type { ReportQuery } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { todayIn } from '../attendance/attendance.service.js';
import type { Table } from '../common/tabular.js';

const VIEW = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const MODE: Record<string, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  dd: 'DD',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  opening: 'Old balance (brought forward)',
  online: 'Online',
};
type Rows = Array<Record<string, unknown>>;
const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class FeeReportsService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}

  private async scope(tx: Transaction, access: TenantAccess, q: ReportQuery) {
    if (!VIEW.some((p) => access.has(p, q.campusId))) throw notFound('Campus');
    const [c] = await tx
      .select({ tz: schema.campuses.timezone, name: schema.campuses.name })
      .from(schema.campuses)
      .where(eq(schema.campuses.id, q.campusId));
    if (!c) throw notFound('Campus');
    const today = todayIn(c.tz);
    return { from: q.from ?? today, to: q.to ?? today, campusName: c.name };
  }

  /** Receipts in a period, with totals by mode, cashier and fee head. */
  collection(access: TenantAccess, q: ReportQuery) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const { from, to, campusName } = await this.scope(tx, access, q);
        const receipts = (
          await tx.execute(sql`
            select p.receipt_number as "receiptNumber", p.received_on::text as date, p.mode, p.reference,
              p.amount::bigint as amount, p.status, trim(s.first_name || ' ' || s.last_name) as student,
              s.admission_number as "admissionNumber", g.name || ' ' || sec.name as class, u.full_name as cashier
            from fee_payments p
            join students s on s.tenant_id = p.tenant_id and s.id = p.student_id
            join student_enrollments e on e.tenant_id = p.tenant_id and e.id = p.enrollment_id
            join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
            join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
            left join users u on u.id = p.collected_by
            where p.campus_id = ${q.campusId} and p.received_on between ${from} and ${to}
              and p.mode <> 'opening'
            order by p.received_on, p.receipt_number`)
        ).rows as Rows;
        const live = receipts.filter((r) => r.status === 'cleared' || r.status === 'pending');
        const group = (key: string) => {
          const m = new Map<string, { receipts: number; amount: number }>();
          for (const r of live) {
            const k = String(r[key] ?? '—');
            const x = m.get(k) ?? { receipts: 0, amount: 0 };
            m.set(k, { receipts: x.receipts + 1, amount: x.amount + n(r.amount) });
          }
          return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.amount - a.amount);
        };
        const byHead = (
          await tx.execute(sql`
            select h.name as head, sum(x.amount)::bigint as amount
            from fee_allocations x
            join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
            join fee_invoice_lines l on l.tenant_id = x.tenant_id and l.id = x.line_id
            join fee_heads h on h.tenant_id = l.tenant_id and h.id = l.fee_head_id
            where p.campus_id = ${q.campusId} and p.received_on between ${from} and ${to}
              and x.released_at is null and p.status in ('cleared', 'pending') and x.source = 'payment'
            group by h.name, h.sort_order order by h.sort_order, h.name`)
        ).rows as Rows;
        const total = live.reduce((s, r) => s + n(r.amount), 0);
        const allocatedTotal = byHead.reduce((s, r) => s + n(r.amount), 0);
        const data = {
          campusName,
          from,
          to,
          total,
          receipts: receipts.map(
            (r) => ({ ...r, amount: n(r.amount) }) as Record<string, unknown> & { amount: number },
          ),
          byMode: group('mode').map((g) => ({
            mode: g.key,
            receipts: g.receipts,
            amount: g.amount,
          })),
          byCashier: group('cashier').map((g) => ({
            cashier: g.key,
            receipts: g.receipts,
            amount: g.amount,
          })),
          byHead: [
            ...byHead.map((h) => ({ head: h.head as string, amount: n(h.amount) })),
            ...(total - allocatedTotal > 0
              ? [{ head: 'Advance (not yet due)', amount: total - allocatedTotal }]
              : []),
          ],
        };
        const table: Table = {
          title: `Collection ${from} to ${to}`,
          columns: [
            { key: 'date', label: 'Date', width: 12 },
            { key: 'receiptNumber', label: 'Receipt no.', width: 22 },
            { key: 'student', label: 'Student', width: 26 },
            { key: 'admissionNumber', label: 'Admission no.' },
            { key: 'class', label: 'Class', width: 12 },
            { key: 'mode', label: 'Mode', width: 12 },
            { key: 'reference', label: 'Reference' },
            { key: 'status', label: 'Status', width: 12 },
            { key: 'cashier', label: 'Received by', width: 20 },
            { key: 'amount', label: 'Amount (Rs.)', money: true },
          ],
          rows: data.receipts.map((r) => ({
            ...(r as Record<string, string | number | null>),
            mode: MODE[r.mode as string] ?? (r.mode as string),
            amount: r.status === 'cleared' || r.status === 'pending' ? r.amount : 0,
          })),
          totals: { date: 'Total', amount: total },
        };
        return { data, table };
      },
      { readOnly: true },
    );
  }

  /** Outstanding by class and section for a year (active demands). */
  outstanding(access: TenantAccess, q: ReportQuery) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const { campusName } = await this.scope(tx, access, q);
        const [c] = await tx
          .select({ tz: schema.campuses.timezone })
          .from(schema.campuses)
          .where(eq(schema.campuses.id, q.campusId));
        const today = todayIn(c!.tz);
        const rows = (
          await tx.execute(sql`
            with t as (
              select v.id, v.enrollment_id, v.due_on,
                (select coalesce(sum(l.amount), 0) from fee_invoice_lines l where l.tenant_id = v.tenant_id and l.invoice_id = v.id) as billed,
                (select coalesce(sum(a.amount), 0) from fee_adjustments a where a.tenant_id = v.tenant_id and a.invoice_id = v.id and a.status = 'approved') as reduced,
                (select coalesce(sum(x.amount), 0) from fee_allocations x join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
                  where x.tenant_id = v.tenant_id and x.invoice_id = v.id and x.released_at is null and p.status in ('cleared', 'pending')) as paid
              from fee_invoices v
              where v.campus_id = ${q.campusId} and v.status = 'active'
                ${q.academicYearId ? sql`and v.academic_year_id = ${q.academicYearId}` : sql``}
            )
            select g.name as "className", sec.name as "sectionName", g.sort_order as sort,
              count(distinct e.student_id)::int as students,
              sum(t.billed)::bigint as billed, sum(t.reduced)::bigint as reduced, sum(t.paid)::bigint as paid,
              sum(greatest(t.billed - t.reduced - t.paid, 0))::bigint as outstanding,
              sum(case when t.due_on < ${today} then greatest(t.billed - t.reduced - t.paid, 0) else 0 end)::bigint as overdue,
              count(distinct e.student_id) filter (where t.due_on < ${today} and t.billed - t.reduced - t.paid > 0)::int as defaulters
            from t
            join student_enrollments e on e.tenant_id = ${access.tenantId} and e.id = t.enrollment_id
            join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
            join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
            group by g.name, g.sort_order, sec.name
            order by g.sort_order, sec.name`)
        ).rows as Rows;
        const list = rows.map((r) => ({
          className: r.className as string,
          sectionName: r.sectionName as string,
          students: n(r.students),
          billed: n(r.billed),
          reduced: n(r.reduced),
          paid: n(r.paid),
          outstanding: n(r.outstanding),
          overdue: n(r.overdue),
          defaulters: n(r.defaulters),
        }));
        const sum = (k: keyof (typeof list)[number]) =>
          list.reduce((s, r) => s + (r[k] as number), 0);
        const totals = {
          students: sum('students'),
          billed: sum('billed'),
          reduced: sum('reduced'),
          paid: sum('paid'),
          outstanding: sum('outstanding'),
          overdue: sum('overdue'),
          defaulters: sum('defaulters'),
        };
        const table: Table = {
          title: 'Outstanding by class',
          columns: [
            { key: 'className', label: 'Class', width: 14 },
            { key: 'sectionName', label: 'Section', width: 10 },
            { key: 'students', label: 'Students', width: 10 },
            { key: 'billed', label: 'Billed (Rs.)', money: true },
            { key: 'reduced', label: 'Concessions & waivers (Rs.)', money: true, width: 22 },
            { key: 'paid', label: 'Paid (Rs.)', money: true },
            { key: 'outstanding', label: 'Outstanding (Rs.)', money: true, width: 16 },
            { key: 'overdue', label: 'Overdue (Rs.)', money: true },
            { key: 'defaulters', label: 'Students overdue', width: 16 },
          ],
          rows: list,
          totals: { className: 'Total', ...totals },
        };
        return { data: { campusName, today, classes: list, totals }, table };
      },
      { readOnly: true },
    );
  }

  /** Concessions and waivers decided in a period. */
  concessions(access: TenantAccess, q: ReportQuery) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const { from, to, campusName } = await this.scope(tx, access, q);
        const rows = (
          await tx.execute(sql`
            select a.decided_at::date::text as date, a.kind, a.reason, a.status, sum(a.amount)::bigint as amount,
              trim(s.first_name || ' ' || s.last_name) as student, s.admission_number as "admissionNumber",
              g.name || ' ' || sec.name as class, u.full_name as "approvedBy"
            from fee_adjustments a
            join fee_invoices v on v.tenant_id = a.tenant_id and v.id = a.invoice_id
            join students s on s.tenant_id = v.tenant_id and s.id = v.student_id
            join student_enrollments e on e.tenant_id = v.tenant_id and e.id = v.enrollment_id
            join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
            join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
            left join users u on u.id = a.decided_by
            where v.campus_id = ${q.campusId} and a.status in ('approved', 'reversed')
              and a.decided_at::date between ${from} and ${to}
            group by a.decided_at::date, a.kind, a.reason, a.status, s.first_name, s.last_name, s.admission_number,
              g.name, g.sort_order, sec.name, u.full_name
            order by a.decided_at::date, g.sort_order, s.first_name`)
        ).rows as Rows;
        const list = rows.map((r) => ({ ...r, amount: n(r.amount) })) as Array<
          Record<string, string | number | null>
        >;
        const total = list
          .filter((r) => r.status === 'approved')
          .reduce((s, r) => s + (r.amount as number), 0);
        const table: Table = {
          title: `Concessions ${from} to ${to}`,
          columns: [
            { key: 'date', label: 'Date', width: 12 },
            { key: 'student', label: 'Student', width: 26 },
            { key: 'admissionNumber', label: 'Admission no.' },
            { key: 'class', label: 'Class', width: 12 },
            { key: 'kind', label: 'Kind', width: 12 },
            { key: 'reason', label: 'Concession / reason', width: 30 },
            { key: 'status', label: 'Status', width: 12 },
            { key: 'approvedBy', label: 'Decided by', width: 20 },
            { key: 'amount', label: 'Amount (Rs.)', money: true },
          ],
          rows: list,
          totals: { date: 'Total (standing)', amount: total },
        };
        return { data: { campusName, from, to, total, rows: list }, table };
      },
      { readOnly: true },
    );
  }
}
