import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { applyConcessions, lateFeeDue } from '@school-erp/validation';
import type {
  DemandListQuery,
  GenerateDemandsInput,
  StudentConcessionInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { assertCampus } from '../academic/campus-check.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import { todayIn } from '../attendance/attendance.service.js';
import { FeeSetupService } from './fee-setup.service.js';
import { ensureFeeBooks, loadBooks, newIds, postJournals, reverseJournals } from './ledger.js';
import type { FeeBooks, JournalInput } from './ledger.js';

const fs = schema.feeStructures;
const fi = schema.feeInstallments;
const fit = schema.feeStructureItems;
const fh = schema.feeHeads;
const inv = schema.feeInvoices;
const line = schema.feeInvoiceLines;
const adj = schema.feeAdjustments;
const sc = schema.studentConcessions;
const ct = schema.concessionTypes;
const en = schema.studentEnrollments;
const sec = schema.sections;
const gl = schema.gradeLevels;
const cp = schema.campuses;
const yr = schema.academicYears;

const PAGE = 50;
const VIEW = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];

/**
 * Per demand (alias `v`): billed (all lines), reduced (approved adjustments), paid (live
 * receipts). Used as `join lateral (${invoiceTotals}) t on true`, so it is worked out once per
 * demand row; joining it as a plain derived table made PostgreSQL recompute it per row.
 */
const invoiceTotals = sql`
  select
    coalesce((select sum(l.amount) from fee_invoice_lines l
      where l.tenant_id = v.tenant_id and l.invoice_id = v.id), 0)::bigint as billed,
    coalesce((select sum(a.amount) from fee_adjustments a
      where a.tenant_id = v.tenant_id and a.invoice_id = v.id and a.status = 'approved'), 0)::bigint as reduced,
    coalesce((select sum(x.amount) from fee_allocations x
      join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
      where x.tenant_id = v.tenant_id and x.invoice_id = v.id and x.released_at is null and p.status in ('cleared', 'pending')), 0)::bigint as paid`;

type Ctx = { tenantId: string; userId: string };

@Injectable()
export class DemandsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly setup: FeeSetupService,
  ) {}

  private ctx(access: TenantAccess): Ctx {
    return { tenantId: access.tenantId, userId: access.userId };
  }

  private async today(tx: Transaction, campusId: string) {
    const [c] = await tx.select({ tz: cp.timezone }).from(cp).where(eq(cp.id, campusId));
    return todayIn(c?.tz ?? 'Asia/Kolkata');
  }

  /* ------------------------------------- generation ------------------------------------- */

  /**
   * Raises demands for a published structure: one per student per installment, with the
   * student's approved concessions applied. Students already billed are skipped, so it is
   * safe to run again (e.g. after new admissions). When no students are named, students
   * who joined after an installment's due date are not billed for it.
   */
  generate(access: TenantAccess, input: GenerateDemandsInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.setup.structureRow(tx, access, input.structureId, 'fees.configure');
      if (s.status !== 'published') {
        throw new AppError('CONFLICT', 'Publish the structure before raising demands');
      }
      const books = await ensureFeeBooks(tx, access.tenantId);
      const installments = await tx
        .select({ id: fi.id, label: fi.label, dueOn: fi.dueOn })
        .from(fi)
        .where(
          and(
            eq(fi.structureId, s.id),
            input.installmentIds ? inArray(fi.id, input.installmentIds) : undefined,
          ),
        )
        .orderBy(asc(fi.seq));
      if (input.installmentIds && installments.length !== new Set(input.installmentIds).size) {
        throw notFound('Installment');
      }
      const items = await tx
        .select({
          installmentId: fit.installmentId,
          feeHeadId: fit.feeHeadId,
          amount: fit.amount,
          gstRate: fh.gstRate,
          accountId: fh.incomeAccountId,
          headName: fh.name,
        })
        .from(fit)
        .innerJoin(fh, and(eq(fh.tenantId, fit.tenantId), eq(fh.id, fit.feeHeadId)))
        .where(eq(fit.structureId, s.id));

      const targets = await this.targets(tx, s, input.studentIds);
      if (input.studentIds) {
        const found = new Set(targets.map((t) => t.studentId));
        const missing = input.studentIds.filter((id) => !found.has(id));
        if (missing.length) {
          throw new AppError(
            'VALIDATION_FAILED',
            s.kind === 'optional'
              ? 'Some students are not on this fee'
              : 'Some students are not in the classes of this structure',
            { studentIds: missing },
          );
        }
      }
      const enrollmentIds = targets.map((t) => t.enrollmentId);
      const existing = enrollmentIds.length
        ? await tx
            .select({ enrollmentId: inv.enrollmentId, installmentId: inv.installmentId })
            .from(inv)
            .where(
              and(
                inArray(inv.enrollmentId, enrollmentIds),
                inArray(
                  inv.installmentId,
                  installments.map((i) => i.id),
                ),
                eq(inv.status, 'active'),
              ),
            )
        : [];
      const billed = new Set(existing.map((x) => `${x.enrollmentId}|${x.installmentId}`));
      const concessions = await this.approvedConcessions(tx, enrollmentIds);

      type Plan = {
        target: (typeof targets)[number];
        inst: (typeof installments)[number];
      };
      const plans: Plan[] = [];
      let joinedLater = 0;
      for (const inst of installments) {
        for (const t of targets) {
          if (billed.has(`${t.enrollmentId}|${inst.id}`)) continue;
          if (!input.studentIds && t.enrolledOn > inst.dueOn) {
            joinedLater++;
            continue;
          }
          if (!items.some((x) => x.installmentId === inst.id)) continue;
          plans.push({ target: t, inst });
        }
      }
      const postedOn = await this.today(tx, s.campusId);
      const result = await this.raise(tx, access, books, s, plans, items, concessions, postedOn);
      await this.audit.record(tx, access, {
        action: 'fees.demands_raised',
        entity: 'fee_structure',
        entityId: s.id,
        campusId: s.campusId,
        diff: {
          installments: installments.map((i) => i.label),
          created: result.created,
          billed: result.billed,
          concessions: result.concessions,
          skippedExisting: existing.length,
          skippedJoinedLater: joinedLater,
        },
      });
      return { ...result, skippedExisting: existing.length, skippedJoinedLater: joinedLater };
    });
  }

  /** Students a structure applies to: its classes' active enrollments, or assigned students. */
  private async targets(
    tx: Transaction,
    s: { id: string; kind: string; campusId: string; academicYearId: string },
    studentIds?: string[],
  ) {
    const base = {
      enrollmentId: en.id,
      studentId: en.studentId,
      enrolledOn: en.enrolledOn,
    };
    const only = studentIds ? inArray(en.studentId, studentIds) : undefined;
    if (s.kind === 'optional') {
      return tx
        .select(base)
        .from(schema.feeAssignments)
        .innerJoin(
          en,
          and(
            eq(en.tenantId, schema.feeAssignments.tenantId),
            eq(en.id, schema.feeAssignments.enrollmentId),
          ),
        )
        .where(
          and(
            eq(schema.feeAssignments.structureId, s.id),
            sql`${schema.feeAssignments.removedAt} is null`,
            eq(en.status, 'active'),
            only,
          ),
        );
    }
    return tx
      .select(base)
      .from(en)
      .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
      .innerJoin(
        schema.feeStructureClasses,
        and(
          eq(schema.feeStructureClasses.tenantId, sec.tenantId),
          eq(schema.feeStructureClasses.gradeLevelId, sec.gradeLevelId),
          eq(schema.feeStructureClasses.structureId, s.id),
        ),
      )
      .where(
        and(
          eq(en.academicYearId, s.academicYearId),
          eq(en.campusId, s.campusId),
          eq(en.status, 'active'),
          only,
        ),
      );
  }

  private async approvedConcessions(tx: Transaction, enrollmentIds: string[]) {
    if (!enrollmentIds.length)
      return new Map<
        string,
        Array<{
          id: string;
          mode: 'percent' | 'fixed';
          value: number;
          feeHeadIds: string[];
          name: string;
        }>
      >();
    const rows = await tx
      .select({
        id: sc.id,
        enrollmentId: sc.enrollmentId,
        mode: sc.mode,
        value: sc.value,
        feeHeadIds: ct.feeHeadIds,
        name: ct.name,
      })
      .from(sc)
      .innerJoin(ct, and(eq(ct.tenantId, sc.tenantId), eq(ct.id, sc.concessionTypeId)))
      .where(and(inArray(sc.enrollmentId, enrollmentIds), eq(sc.status, 'approved')))
      .orderBy(asc(sc.createdAt));
    const map = new Map<
      string,
      Array<{
        id: string;
        mode: 'percent' | 'fixed';
        value: number;
        feeHeadIds: string[];
        name: string;
      }>
    >();
    for (const r of rows) {
      map.set(r.enrollmentId, [
        ...(map.get(r.enrollmentId) ?? []),
        {
          id: r.id,
          mode: r.mode as 'percent' | 'fixed',
          value: r.value,
          feeHeadIds: r.feeHeadIds,
          name: r.name,
        },
      ]);
    }
    return map;
  }

  /** Inserts demands, lines, concession adjustments and their journals in bulk. */
  private async raise(
    tx: Transaction,
    access: TenantAccess,
    books: FeeBooks,
    s: { id: string; campusId: string; academicYearId: string; name: string },
    plans: Array<{
      target: { enrollmentId: string; studentId: string };
      inst: { id: string; label: string; dueOn: string };
    }>,
    items: Array<{
      installmentId: string;
      feeHeadId: string;
      amount: number;
      gstRate: number;
      accountId: string;
    }>,
    concessions: Map<
      string,
      Array<{
        id: string;
        mode: 'percent' | 'fixed';
        value: number;
        feeHeadIds: string[];
        name: string;
      }>
    >,
    postedOn: string,
  ) {
    if (!plans.length) return { created: 0, billed: 0, concessions: 0 };
    const lineCount = plans.reduce(
      (n, p) => n + items.filter((x) => x.installmentId === p.inst.id).length,
      0,
    );
    const ids = await newIds(tx, plans.length + lineCount);
    const invoices: Array<typeof inv.$inferInsert> = [];
    const lines: Array<typeof line.$inferInsert> = [];
    const adjustments: Array<typeof adj.$inferInsert & { _journal: number }> = [];
    const journals: JournalInput[] = [];
    let billedTotal = 0;
    let concessionTotal = 0;

    for (const p of plans) {
      const invoiceId = ids.pop()!;
      invoices.push({
        id: invoiceId,
        tenantId: access.tenantId,
        campusId: s.campusId,
        academicYearId: s.academicYearId,
        enrollmentId: p.target.enrollmentId,
        studentId: p.target.studentId,
        structureId: s.id,
        installmentId: p.inst.id,
        dueOn: p.inst.dueOn,
        createdBy: access.userId,
      });
      const mine = items
        .filter((x) => x.installmentId === p.inst.id)
        .map((x) => ({ ...x, lineId: ids.pop()! }));
      const credits = new Map<string, number>();
      let gross = 0;
      for (const x of mine) {
        lines.push({
          id: x.lineId,
          tenantId: access.tenantId,
          invoiceId,
          feeHeadId: x.feeHeadId,
          amount: x.amount,
          gstRate: x.gstRate,
        });
        credits.set(x.accountId, (credits.get(x.accountId) ?? 0) + x.amount);
        gross += x.amount;
      }
      billedTotal += gross;
      journals.push({
        campusId: s.campusId,
        postedOn,
        sourceType: 'invoice',
        sourceId: invoiceId,
        memo: `${s.name} — ${p.inst.label}`,
        entries: [
          { accountId: books.accounts.receivable, studentId: p.target.studentId, debit: gross },
          ...[...credits].map(([accountId, credit]) => ({ accountId, credit })),
        ],
      });
      const rules = concessions.get(p.target.enrollmentId) ?? [];
      if (rules.length) {
        const split = applyConcessions(
          mine.map((x) => ({ key: x.lineId, feeHeadId: x.feeHeadId, amount: x.amount })),
          rules,
        );
        for (const rule of rules) {
          const parts = split.filter((x) => x.concessionId === rule.id);
          const total = parts.reduce((n, x) => n + x.amount, 0);
          if (!total) continue;
          concessionTotal += total;
          const j = journals.length;
          journals.push({
            campusId: s.campusId,
            postedOn,
            sourceType: 'concession',
            sourceId: rule.id,
            memo: `${rule.name} — ${s.name} — ${p.inst.label}`,
            entries: [
              { accountId: books.accounts.concessions, debit: total },
              {
                accountId: books.accounts.receivable,
                studentId: p.target.studentId,
                credit: total,
              },
            ],
          });
          for (const part of parts) {
            adjustments.push({
              tenantId: access.tenantId,
              invoiceId,
              lineId: part.lineKey,
              kind: 'concession',
              amount: part.amount,
              studentConcessionId: rule.id,
              reason: rule.name,
              status: 'approved',
              requestedBy: access.userId,
              decidedBy: access.userId,
              decidedAt: new Date(),
              _journal: j,
            });
          }
        }
      }
    }
    for (let i = 0; i < invoices.length; i += 2000)
      await tx.insert(inv).values(invoices.slice(i, i + 2000));
    for (let i = 0; i < lines.length; i += 2000)
      await tx.insert(line).values(lines.slice(i, i + 2000));
    const journalIds = await postJournals(tx, this.ctx(access), journals);
    if (adjustments.length) {
      const rows = adjustments.map(({ _journal, ...a }) => ({
        ...a,
        journalId: journalIds[_journal]!,
      }));
      for (let i = 0; i < rows.length; i += 2000)
        await tx.insert(adj).values(rows.slice(i, i + 2000));
    }
    return { created: invoices.length, billed: billedTotal, concessions: concessionTotal };
  }

  /* -------------------------------------- late fees -------------------------------------- */

  /** Adds late fees owed as of a date to overdue demands of a campus. Safe to run daily. */
  applyLateFees(access: TenantAccess, campusId: string, asOf?: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await assertCampus(tx, access, campusId, 'fees.configure');
      const books = await ensureFeeBooks(tx, access.tenantId);
      const today = await this.today(tx, campusId);
      const on = asOf ?? today;
      if (on > today)
        throw new AppError('VALIDATION_FAILED', 'Late fees cannot be charged for a future date');
      const res = await tx.execute(sql`
        select v.id, v.student_id as "studentId", v.due_on::text as "dueOn",
          s.late_fee_kind as kind, s.late_fee_amount::bigint as amount,
          s.late_fee_grace_days as "graceDays", s.late_fee_cap::bigint as cap, s.name,
          coalesce((select sum(l.amount) from fee_invoice_lines l
            where l.tenant_id = v.tenant_id and l.invoice_id = v.id and l.kind = 'fee'), 0)::bigint as fees,
          coalesce((select sum(a.amount) from fee_adjustments a join fee_invoice_lines l
            on l.tenant_id = a.tenant_id and l.id = a.line_id
            where a.tenant_id = v.tenant_id and a.invoice_id = v.id and a.status = 'approved' and l.kind = 'fee'), 0)::bigint as reduced,
          coalesce((select sum(x.amount) from fee_allocations x
            join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
            join fee_invoice_lines l on l.tenant_id = x.tenant_id and l.id = x.line_id
            where x.tenant_id = v.tenant_id and x.invoice_id = v.id and l.kind = 'fee'
              and x.released_at is null and p.status in ('cleared', 'pending')), 0)::bigint as paid,
          coalesce((select sum(l.amount) from fee_invoice_lines l
            where l.tenant_id = v.tenant_id and l.invoice_id = v.id and l.kind = 'late_fee'), 0)::bigint as charged
        from fee_invoices v
        join fee_structures s on s.tenant_id = v.tenant_id and s.id = v.structure_id
        where v.campus_id = ${campusId} and v.status = 'active' and s.late_fee_kind <> 'none'
          and v.due_on + s.late_fee_grace_days < ${on}::date`);
      type Row = {
        id: string;
        studentId: string;
        dueOn: string;
        kind: 'fixed' | 'per_day';
        amount: string;
        graceDays: number;
        cap: string;
        name: string;
        fees: string;
        reduced: string;
        paid: string;
        charged: string;
      };
      const due = (res.rows as Row[])
        .filter((r) => Number(r.fees) - Number(r.reduced) - Number(r.paid) > 0)
        .map((r) => ({
          ...r,
          delta:
            lateFeeDue(
              {
                kind: r.kind,
                amount: Number(r.amount),
                graceDays: r.graceDays,
                cap: Number(r.cap),
              },
              r.dueOn,
              on,
            ) - Number(r.charged),
        }))
        .filter((r) => r.delta > 0);
      if (!due.length) return { demands: 0, amount: 0, asOf: on };
      const [late] = await tx
        .select({ accountId: fh.incomeAccountId })
        .from(fh)
        .where(eq(fh.id, books.lateFeeHeadId));
      await tx.insert(line).values(
        due.map((d) => ({
          tenantId: access.tenantId,
          invoiceId: d.id,
          feeHeadId: books.lateFeeHeadId,
          kind: 'late_fee',
          amount: d.delta,
        })),
      );
      await postJournals(
        tx,
        this.ctx(access),
        due.map((d) => ({
          campusId,
          postedOn: on,
          sourceType: 'late_fee',
          sourceId: d.id,
          memo: `Late fee — ${d.name}`,
          entries: [
            { accountId: books.accounts.receivable, studentId: d.studentId, debit: d.delta },
            { accountId: late!.accountId, credit: d.delta },
          ],
        })),
      );
      const amount = due.reduce((n, d) => n + d.delta, 0);
      await this.audit.record(tx, access, {
        action: 'fees.late_fees_applied',
        entity: 'campus',
        entityId: campusId,
        campusId,
        diff: { asOf: on, demands: due.length, amount },
      });
      return { demands: due.length, amount, asOf: on };
    });
  }

  /* ------------------------------------ demand reads ------------------------------------ */

  /** The campus must be this school's and the caller must hold a fee right there; else 404. */
  private async visibleCampus(tx: Transaction, access: TenantAccess, campusId: string) {
    if (!VIEW.some((p) => access.has(p, campusId))) throw notFound('Campus');
    const [c] = await tx.select({ id: cp.id }).from(cp).where(eq(cp.id, campusId));
    if (!c) throw notFound('Campus');
  }

  listDemands(access: TenantAccess, q: DemandListQuery) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.visibleCampus(tx, access, q.campusId);
        const today = await this.today(tx, q.campusId);
        const conds: SQL[] = [sql`v.campus_id = ${q.campusId}`];
        if (q.academicYearId) conds.push(sql`v.academic_year_id = ${q.academicYearId}`);
        if (q.structureId) conds.push(sql`v.structure_id = ${q.structureId}`);
        if (q.installmentId) conds.push(sql`v.installment_id = ${q.installmentId}`);
        if (q.sectionId) conds.push(sql`e.section_id = ${q.sectionId}`);
        if (q.q) {
          const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          conds.push(
            sql`(s.admission_number ilike ${like} or (s.first_name || ' ' || s.last_name) ilike ${like})`,
          );
        }
        const status =
          q.status === 'cancelled'
            ? sql`x.status = 'cancelled'`
            : q.status === 'settled'
              ? sql`x.status = 'active' and x.balance <= 0`
              : q.status === 'overdue'
                ? sql`x.status = 'active' and x.balance > 0 and x."dueOn" < ${today}`
                : q.status === 'due'
                  ? sql`x.status = 'active' and x.balance > 0`
                  : sql`true`;
        const base = sql`
          select v.id, v.status, v.due_on::text as "dueOn", v.student_id as "studentId",
            trim(s.first_name || ' ' || s.last_name) as "studentName", s.admission_number as "admissionNumber",
            g.name as "className", sec.name as "sectionName", g.sort_order as "classSort",
            fs.name as "structureName", i.label as "installmentLabel",
            t.billed, t.reduced, t.paid, (t.billed - t.reduced - t.paid) as balance
          from fee_invoices v
          join lateral (${invoiceTotals}) t on true
          join students s on s.tenant_id = v.tenant_id and s.id = v.student_id
          join student_enrollments e on e.tenant_id = v.tenant_id and e.id = v.enrollment_id
          join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
          join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
          join fee_structures fs on fs.tenant_id = v.tenant_id and fs.id = v.structure_id
          join fee_installments i on i.tenant_id = v.tenant_id and i.id = v.installment_id
          where ${sql.join(conds, sql` and `)}`;
        const rows = await tx.execute(sql`
          select x.*, count(*) over() as "totalCount",
            sum(x.billed) over() as "sumBilled", sum(x.reduced) over() as "sumReduced", sum(x.paid) over() as "sumPaid",
            sum(greatest(x.balance, 0)) filter (where x.status = 'active') over() as "sumBalance"
          from (${base}) x where ${status}
          order by x."dueOn", x."classSort", x."sectionName", x."studentName"
          limit ${PAGE} offset ${(q.page - 1) * PAGE}`);
        type R = Record<string, unknown>;
        const list = rows.rows as R[];
        const first = list[0];
        return {
          page: q.page,
          pageSize: PAGE,
          total: first ? Number(first.totalCount) : 0,
          totals: {
            billed: first ? Number(first.sumBilled) : 0,
            reduced: first ? Number(first.sumReduced) : 0,
            paid: first ? Number(first.sumPaid) : 0,
            balance: first ? Number(first.sumBalance ?? 0) : 0,
          },
          today,
          data: list.map((r) => {
            const balance = Number(r.balance);
            return {
              id: r.id as string,
              studentId: r.studentId as string,
              studentName: r.studentName as string,
              admissionNumber: r.admissionNumber as string,
              className: r.className as string,
              sectionName: r.sectionName as string,
              structureName: r.structureName as string,
              installmentLabel: r.installmentLabel as string,
              dueOn: r.dueOn as string,
              billed: Number(r.billed),
              reduced: Number(r.reduced),
              paid: Number(r.paid),
              balance,
              status:
                r.status === 'cancelled'
                  ? 'cancelled'
                  : balance <= 0
                    ? 'settled'
                    : (r.dueOn as string) < today
                      ? 'overdue'
                      : 'due',
            };
          }),
        };
      },
      { readOnly: true },
    );
  }

  /** Per installment of a structure: how many students are billed and what is outstanding. */
  structureDemands(access: TenantAccess, structureId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const s = await this.setup.structureRow(tx, access, structureId);
        const eligible = (await this.targets(tx, s)).length;
        const res = await tx.execute(sql`
          select i.id, i.label, i.due_on::text as "dueOn",
            count(v.id) filter (where v.status = 'active')::int as raised,
            coalesce(sum(t.billed) filter (where v.status = 'active'), 0)::bigint as billed,
            coalesce(sum(t.reduced) filter (where v.status = 'active'), 0)::bigint as reduced,
            coalesce(sum(t.paid) filter (where v.status = 'active'), 0)::bigint as paid
          from fee_installments i
          left join fee_invoices v on v.tenant_id = i.tenant_id and v.installment_id = i.id
          left join lateral (${invoiceTotals}) t on true
          where i.structure_id = ${structureId}
          group by i.id order by i.seq`);
        return {
          eligible,
          installments: (res.rows as Array<Record<string, unknown>>).map((r) => ({
            id: r.id as string,
            label: r.label as string,
            dueOn: r.dueOn as string,
            raised: Number(r.raised),
            billed: Number(r.billed),
            reduced: Number(r.reduced),
            paid: Number(r.paid),
            balance: Number(r.billed) - Number(r.reduced) - Number(r.paid),
          })),
        };
      },
      { readOnly: true },
    );
  }

  private async invoiceRow(tx: Transaction, access: TenantAccess, id: string, need?: string) {
    const [row] = await tx.select().from(inv).where(eq(inv.id, id));
    if (!row || !VIEW.some((p) => access.has(p, row.campusId))) throw notFound('Demand');
    if (need && !access.has(need, row.campusId)) {
      throw new AppError('FORBIDDEN', 'You cannot do this for this campus');
    }
    return row;
  }

  /** Cancels a demand raised by mistake: everything it posted is reversed. */
  cancelDemand(access: TenantAccess, id: string, reason: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const v = await this.invoiceRow(tx, access, id, 'fees.configure');
      if (v.status !== 'active') throw new AppError('CONFLICT', 'The demand is already cancelled');
      const refunded = await tx.execute(sql`
        select 1 from fee_refund_parts rp join fee_refunds r on r.tenant_id = rp.tenant_id and r.id = rp.refund_id
        where rp.invoice_id = ${id} and r.status <> 'rejected' limit 1`);
      if (refunded.rows.length) {
        throw new AppError(
          'CONFLICT',
          'A deposit on this demand has been refunded; it cannot be cancelled',
        );
      }
      const postedOn = await this.today(tx, v.campusId);
      // Money already paid against this demand goes back to the student's advance.
      const live = (
        await tx.execute(sql`
          select x.id, x.payment_id as "paymentId", x.amount::bigint as amount, p.receipt_number as "receiptNumber"
          from fee_allocations x
          join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
          where x.invoice_id = ${id} and x.released_at is null and p.status in ('cleared', 'pending')`)
      ).rows as Array<{ id: string; paymentId: string; amount: string; receiptNumber: string }>;
      let released = 0;
      if (live.length) {
        const books = await ensureFeeBooks(tx, access.tenantId);
        const byPayment = new Map<string, { total: number; ids: string[]; receipt: string }>();
        for (const r of live) {
          const g = byPayment.get(r.paymentId) ?? { total: 0, ids: [], receipt: r.receiptNumber };
          g.total += Number(r.amount);
          g.ids.push(r.id);
          byPayment.set(r.paymentId, g);
        }
        const entries = [...byPayment];
        const journalIds = await postJournals(
          tx,
          this.ctx(access),
          entries.map(([paymentId, g]) => ({
            campusId: v.campusId,
            postedOn,
            sourceType: 'release',
            sourceId: paymentId,
            memo: `Paid on a cancelled demand, kept as advance (${g.receipt})`,
            entries: [
              { accountId: books.accounts.receivable, studentId: v.studentId, debit: g.total },
              { accountId: books.accounts.advance, studentId: v.studentId, credit: g.total },
            ],
          })),
        );
        for (const [i, [, g]] of entries.entries()) {
          await tx
            .update(schema.feeAllocations)
            .set({ releasedAt: new Date(), releaseJournalId: journalIds[i]! })
            .where(inArray(schema.feeAllocations.id, g.ids));
          released += g.total;
        }
      }
      const adjs = await tx
        .select({ id: adj.id, status: adj.status, journalId: adj.journalId })
        .from(adj)
        .where(eq(adj.invoiceId, id));
      const journals = await tx
        .select({ id: schema.ledgerJournals.id })
        .from(schema.ledgerJournals)
        .where(
          and(
            sql`${schema.ledgerJournals.reversesId} is null`,
            sql`${schema.ledgerJournals.sourceType} in ('invoice', 'late_fee')`,
            eq(schema.ledgerJournals.sourceId, id),
          ),
        );
      const adjJournals = adjs
        .filter((a) => a.status === 'approved' && a.journalId)
        .map((a) => a.journalId!);
      // Concession journals cover a whole demand per concession; reverse each once.
      await reverseJournals(
        tx,
        this.ctx(access),
        [...new Set([...journals.map((j) => j.id), ...adjJournals])],
        postedOn,
        `Demand cancelled: ${reason}`,
      );
      if (adjs.length) {
        await tx
          .update(adj)
          .set({
            status: sql`case when ${adj.status} = 'approved' then 'reversed' else 'rejected' end`,
            decidedBy: access.userId,
            decidedAt: new Date(),
            decisionNote: 'Demand cancelled',
          })
          .where(and(eq(adj.invoiceId, id), inArray(adj.status, ['approved', 'pending'])));
      }
      await tx
        .update(inv)
        .set({
          status: 'cancelled',
          cancelReason: reason,
          cancelledBy: access.userId,
          cancelledAt: new Date(),
        })
        .where(eq(inv.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.demand_cancelled',
        entity: 'fee_invoice',
        entityId: id,
        campusId: v.campusId,
        diff: { reason, studentId: v.studentId, movedToAdvance: released },
      });
      return { id, status: 'cancelled', movedToAdvance: released };
    });
  }

  /* --------------------------------------- waivers --------------------------------------- */

  requestWaiver(
    access: TenantAccess,
    invoiceId: string,
    input: { lineId: string; amount: number; reason: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const v = await this.invoiceRow(tx, access, invoiceId);
      const canApprove = access.has('fees.concession.approve', v.campusId);
      if (
        !canApprove &&
        !access.has('fees.configure', v.campusId) &&
        !access.has('fees.collect', v.campusId)
      ) {
        throw new AppError('FORBIDDEN', 'You cannot request waivers');
      }
      if (v.status !== 'active') throw new AppError('CONFLICT', 'The demand is cancelled');
      const [l] = await tx
        .select({ id: line.id, amount: line.amount })
        .from(line)
        .where(and(eq(line.id, input.lineId), eq(line.invoiceId, invoiceId)));
      if (!l) throw notFound('Demand line');
      const [{ taken }] = (
        await tx.execute(sql`
        select (coalesce((select sum(amount) from fee_adjustments
          where line_id = ${l.id} and status in ('approved', 'pending')), 0)
          + coalesce((select sum(x.amount) from fee_allocations x
            join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
            where x.line_id = ${l.id} and x.released_at is null and p.status in ('cleared', 'pending')), 0))::bigint as taken`)
      ).rows as [{ taken: string }];
      const left = l.amount - Number(taken);
      if (input.amount > left) {
        throw new AppError(
          'VALIDATION_FAILED',
          'The waiver is more than what is left on this fee',
          {
            fields: { amount: `At most ${left} paise` },
          },
        );
      }
      const [row] = await tx
        .insert(adj)
        .values({
          tenantId: access.tenantId,
          invoiceId,
          lineId: l.id,
          kind: 'waiver',
          amount: input.amount,
          reason: input.reason,
          requestedBy: access.userId,
        })
        .returning({ id: adj.id });
      await this.audit.record(tx, access, {
        action: 'fees.waiver_requested',
        entity: 'fee_invoice',
        entityId: invoiceId,
        campusId: v.campusId,
        diff: input,
      });
      if (canApprove) {
        await this.approveAdjustment(tx, access, row!.id, 'Requested by an approver');
        return { id: row!.id, status: 'approved' };
      }
      return { id: row!.id, status: 'pending' };
    });
  }

  private async approveAdjustment(tx: Transaction, access: TenantAccess, id: string, note: string) {
    const [a] = await tx
      .select({ adj, v: inv })
      .from(adj)
      .innerJoin(inv, and(eq(inv.tenantId, adj.tenantId), eq(inv.id, adj.invoiceId)))
      .where(eq(adj.id, id));
    if (!a) throw notFound('Waiver');
    const books = await ensureFeeBooks(tx, access.tenantId);
    const [journalId] = await postJournals(tx, this.ctx(access), [
      {
        campusId: a.v.campusId,
        postedOn: await this.today(tx, a.v.campusId),
        sourceType: 'adjustment',
        sourceId: id,
        memo: `Waiver: ${a.adj.reason}`,
        entries: [
          { accountId: books.accounts.concessions, debit: a.adj.amount },
          { accountId: books.accounts.receivable, studentId: a.v.studentId, credit: a.adj.amount },
        ],
      },
    ]);
    try {
      await tx
        .update(adj)
        .set({
          status: 'approved',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: note,
          journalId,
        })
        .where(eq(adj.id, id));
    } catch (err) {
      const msg =
        err instanceof Error
          ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}`
          : '';
      if (/exceed the fee line/.test(msg)) {
        throw new AppError('CONFLICT', 'Waivers and concessions would exceed this fee');
      }
      throw err;
    }
  }

  decideWaiver(
    access: TenantAccess,
    id: string,
    input: { status: 'approved' | 'rejected'; note: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [a] = await tx.select().from(adj).where(eq(adj.id, id));
      if (!a || a.kind !== 'waiver') throw notFound('Waiver');
      const v = await this.invoiceRow(tx, access, a.invoiceId, 'fees.concession.approve');
      if (a.status !== 'pending')
        throw new AppError('CONFLICT', `The waiver is already ${a.status}`);
      if (input.status === 'approved') {
        await this.approveAdjustment(tx, access, id, input.note);
      } else {
        await tx
          .update(adj)
          .set({
            status: 'rejected',
            decidedBy: access.userId,
            decidedAt: new Date(),
            decisionNote: input.note,
          })
          .where(eq(adj.id, id));
      }
      await this.audit.record(tx, access, {
        action: `fees.waiver_${input.status}`,
        entity: 'fee_invoice',
        entityId: a.invoiceId,
        campusId: v.campusId,
        diff: { waiverId: id, amount: a.amount, note: input.note },
      });
      return { id, status: input.status };
    });
  }

  /* ------------------------------------- concessions ------------------------------------- */

  listConcessions(access: TenantAccess, campusId: string, status?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.visibleCampus(tx, access, campusId);
        const res = await tx.execute(sql`
          select c.id, c.student_id as "studentId", trim(s.first_name || ' ' || s.last_name) as "studentName",
            s.admission_number as "admissionNumber", g.name as "className", sec.name as "sectionName",
            y.name as "yearName", t.name as "typeName", t.kind, c.mode, c.value::bigint as value, c.reason, c.status,
            c.decision_note as "decisionNote", c.created_at as "createdAt", c.decided_at as "decidedAt",
            ru.full_name as "requestedBy", du.full_name as "decidedBy"
          from student_concessions c
          join concession_types t on t.tenant_id = c.tenant_id and t.id = c.concession_type_id
          join student_enrollments e on e.tenant_id = c.tenant_id and e.id = c.enrollment_id
          join students s on s.tenant_id = c.tenant_id and s.id = c.student_id
          join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
          join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
          join academic_years y on y.tenant_id = e.tenant_id and y.id = e.academic_year_id
          left join users ru on ru.id = c.requested_by
          left join users du on du.id = c.decided_by
          where e.campus_id = ${campusId} ${status ? sql`and c.status = ${status}` : sql``}
          order by c.status = 'pending' desc, c.created_at desc limit 500`);
        const canDecide = access.has('fees.concession.approve', campusId);
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          value: Number(r.value),
          canDecide,
        }));
      },
      { readOnly: true },
    );
  }

  requestConcession(access: TenantAccess, input: StudentConcessionInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [e] = await tx
        .select({ id: en.id, campusId: en.campusId, status: en.status })
        .from(en)
        .where(and(eq(en.studentId, input.studentId), eq(en.academicYearId, input.academicYearId)));
      if (!e || !VIEW.some((p) => access.has(p, e.campusId))) throw notFound('Student');
      const canApprove = access.has('fees.concession.approve', e.campusId);
      if (!canApprove && !access.has('fees.configure', e.campusId)) {
        throw new AppError('FORBIDDEN', 'You cannot give concessions');
      }
      const [type] = await tx.select().from(ct).where(eq(ct.id, input.concessionTypeId));
      if (!type || !type.active) throw notFound('Concession type');
      const value = input.value ?? type.value;
      if (type.mode === 'percent' && value > 100) {
        throw new AppError('VALIDATION_FAILED', 'At most 100%', {
          fields: { value: 'At most 100%' },
        });
      }
      try {
        const [row] = await tx
          .insert(sc)
          .values({
            tenantId: access.tenantId,
            enrollmentId: e.id,
            studentId: input.studentId,
            concessionTypeId: type.id,
            mode: type.mode,
            value,
            reason: input.reason,
            requestedBy: access.userId,
          })
          .returning({ id: sc.id });
        await this.audit.record(tx, access, {
          action: 'fees.concession_requested',
          entity: 'student',
          entityId: input.studentId,
          campusId: e.campusId,
          diff: { type: type.name, mode: type.mode, value, reason: input.reason },
        });
        if (canApprove) {
          const applied = await this.approveConcession(tx, access, row!.id, 'Given by an approver');
          return { id: row!.id, status: 'approved', ...applied };
        }
        return { id: row!.id, status: 'pending', demands: 0, amount: 0 };
      } catch (err) {
        return rethrowConflicts(err, {
          student_concessions_live_uq:
            'The student already has this concession (or a request for it)',
        });
      }
    });
  }

  /** Approves and applies the concession to the student's demands raised so far. */
  private async approveConcession(tx: Transaction, access: TenantAccess, id: string, note: string) {
    const [c] = await tx
      .select({
        id: sc.id,
        enrollmentId: sc.enrollmentId,
        studentId: sc.studentId,
        mode: sc.mode,
        value: sc.value,
        feeHeadIds: ct.feeHeadIds,
        name: ct.name,
      })
      .from(sc)
      .innerJoin(ct, and(eq(ct.tenantId, sc.tenantId), eq(ct.id, sc.concessionTypeId)))
      .where(eq(sc.id, id));
    await tx
      .update(sc)
      .set({
        status: 'approved',
        decidedBy: access.userId,
        decidedAt: new Date(),
        decisionNote: note,
      })
      .where(eq(sc.id, id));
    const books = await ensureFeeBooks(tx, access.tenantId);
    const res = await tx.execute(sql`
      select v.id as "invoiceId", v.campus_id as "campusId", fs.name || ' — ' || i.label as label,
        l.id as "lineId", l.fee_head_id as "feeHeadId",
        (l.amount - coalesce((select sum(a.amount) from fee_adjustments a
          where a.tenant_id = l.tenant_id and a.line_id = l.id and a.status in ('approved', 'pending')), 0)
          - coalesce((select sum(x.amount) from fee_allocations x
            join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
            where x.tenant_id = l.tenant_id and x.line_id = l.id and x.released_at is null and p.status in ('cleared', 'pending')), 0))::bigint as left
      from fee_invoices v
      join fee_invoice_lines l on l.tenant_id = v.tenant_id and l.invoice_id = v.id and l.kind = 'fee'
      join fee_structures fs on fs.tenant_id = v.tenant_id and fs.id = v.structure_id
      join fee_installments i on i.tenant_id = v.tenant_id and i.id = v.installment_id
      where v.enrollment_id = ${c!.enrollmentId} and v.status = 'active'
      order by v.due_on, l.created_at`);
    type R = {
      invoiceId: string;
      campusId: string;
      label: string;
      lineId: string;
      feeHeadId: string;
      left: string;
    };
    const byInvoice = new Map<string, R[]>();
    for (const r of res.rows as R[]) {
      if (Number(r.left) <= 0) continue;
      byInvoice.set(r.invoiceId, [...(byInvoice.get(r.invoiceId) ?? []), r]);
    }
    const journals: JournalInput[] = [];
    const rows: Array<typeof adj.$inferInsert & { _j: number }> = [];
    const rule = {
      id: c!.id,
      mode: c!.mode as 'percent' | 'fixed',
      value: c!.value,
      feeHeadIds: c!.feeHeadIds,
    };
    for (const [invoiceId, ls] of byInvoice) {
      const split = applyConcessions(
        ls.map((l) => ({ key: l.lineId, feeHeadId: l.feeHeadId, amount: Number(l.left) })),
        [rule],
      );
      const total = split.reduce((n, x) => n + x.amount, 0);
      if (!total) continue;
      const j = journals.length;
      journals.push({
        campusId: ls[0]!.campusId,
        postedOn: await this.today(tx, ls[0]!.campusId),
        sourceType: 'concession',
        sourceId: c!.id,
        memo: `${c!.name} — ${ls[0]!.label}`,
        entries: [
          { accountId: books.accounts.concessions, debit: total },
          { accountId: books.accounts.receivable, studentId: c!.studentId, credit: total },
        ],
      });
      for (const x of split) {
        rows.push({
          tenantId: access.tenantId,
          invoiceId,
          lineId: x.lineKey,
          kind: 'concession',
          amount: x.amount,
          studentConcessionId: c!.id,
          reason: c!.name,
          status: 'approved',
          requestedBy: access.userId,
          decidedBy: access.userId,
          decidedAt: new Date(),
          _j: j,
        });
      }
    }
    const ids = await postJournals(tx, this.ctx(access), journals);
    if (rows.length) {
      await tx.insert(adj).values(rows.map(({ _j, ...r }) => ({ ...r, journalId: ids[_j]! })));
    }
    return { demands: journals.length, amount: rows.reduce((n, r) => n + r.amount, 0) };
  }

  private async concessionRow(tx: Transaction, access: TenantAccess, id: string) {
    const [c] = await tx
      .select({ c: sc, campusId: en.campusId })
      .from(sc)
      .innerJoin(en, and(eq(en.tenantId, sc.tenantId), eq(en.id, sc.enrollmentId)))
      .where(eq(sc.id, id));
    if (!c || !VIEW.some((p) => access.has(p, c.campusId))) throw notFound('Concession');
    if (!access.has('fees.concession.approve', c.campusId)) {
      throw new AppError('FORBIDDEN', 'You cannot approve concessions');
    }
    return c;
  }

  decideConcession(
    access: TenantAccess,
    id: string,
    input: { status: 'approved' | 'rejected'; note: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { c, campusId } = await this.concessionRow(tx, access, id);
      if (c.status !== 'pending')
        throw new AppError('CONFLICT', `The concession is already ${c.status}`);
      let applied = { demands: 0, amount: 0 };
      if (input.status === 'approved') {
        applied = await this.approveConcession(tx, access, id, input.note);
      } else {
        await tx
          .update(sc)
          .set({
            status: 'rejected',
            decidedBy: access.userId,
            decidedAt: new Date(),
            decisionNote: input.note,
          })
          .where(eq(sc.id, id));
      }
      await this.audit.record(tx, access, {
        action: `fees.concession_${input.status}`,
        entity: 'student',
        entityId: c.studentId,
        campusId,
        diff: { concessionId: id, note: input.note, ...applied },
      });
      return { id, status: input.status, ...applied };
    });
  }

  /** Ends an approved concession; what it took off existing demands is put back. */
  revokeConcession(access: TenantAccess, id: string, note: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { c, campusId } = await this.concessionRow(tx, access, id);
      if (c.status !== 'approved')
        throw new AppError('CONFLICT', 'Only approved concessions can be revoked');
      const adjs = await tx
        .select({
          id: adj.id,
          journalId: adj.journalId,
          amount: adj.amount,
          invoiceStatus: inv.status,
        })
        .from(adj)
        .innerJoin(inv, and(eq(inv.tenantId, adj.tenantId), eq(inv.id, adj.invoiceId)))
        .where(
          and(
            eq(adj.studentConcessionId, id),
            eq(adj.status, 'approved'),
            eq(inv.status, 'active'),
          ),
        );
      await reverseJournals(
        tx,
        this.ctx(access),
        [...new Set(adjs.map((a) => a.journalId!).filter(Boolean))],
        await this.today(tx, campusId),
        `Concession revoked: ${note}`,
      );
      if (adjs.length) {
        await tx
          .update(adj)
          .set({
            status: 'reversed',
            decidedBy: access.userId,
            decidedAt: new Date(),
            decisionNote: note,
          })
          .where(
            inArray(
              adj.id,
              adjs.map((a) => a.id),
            ),
          );
      }
      await tx
        .update(sc)
        .set({
          status: 'revoked',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: note,
        })
        .where(eq(sc.id, id));
      const amount = adjs.reduce((n, a) => n + a.amount, 0);
      await this.audit.record(tx, access, {
        action: 'fees.concession_revoked',
        entity: 'student',
        entityId: c.studentId,
        campusId,
        diff: { concessionId: id, note, amount },
      });
      return { id, status: 'revoked', amount };
    });
  }

  /* ----------------------------------- student account ----------------------------------- */

  /** `trusted`: the caller has already checked the student may be seen (parent portal). */
  studentAccount(
    access: TenantAccess,
    studentId: string,
    academicYearId?: string,
    opts: { trusted?: boolean } = {},
  ) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const enrollments = await tx
          .select({
            id: en.id,
            campusId: en.campusId,
            academicYearId: en.academicYearId,
            yearName: yr.name,
            status: en.status,
            className: gl.name,
            sectionName: sec.name,
          })
          .from(en)
          .innerJoin(yr, and(eq(yr.tenantId, en.tenantId), eq(yr.id, en.academicYearId)))
          .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .where(eq(en.studentId, studentId))
          .orderBy(sql`${yr.startsOn} desc`);
        const visible = opts.trusted
          ? enrollments
          : enrollments.filter((e) => VIEW.some((p) => access.has(p, e.campusId)));
        if (!visible.length) throw notFound('Student');
        const e = academicYearId
          ? visible.find((x) => x.academicYearId === academicYearId)
          : visible[0];
        if (!e) throw notFound('Enrollment');
        const today = await this.today(tx, e.campusId);

        const invoices = await tx
          .select({
            id: inv.id,
            status: inv.status,
            dueOn: inv.dueOn,
            structureName: fs.name,
            installmentLabel: fi.label,
            cancelReason: inv.cancelReason,
          })
          .from(inv)
          .innerJoin(fs, and(eq(fs.tenantId, inv.tenantId), eq(fs.id, inv.structureId)))
          .innerJoin(fi, and(eq(fi.tenantId, inv.tenantId), eq(fi.id, inv.installmentId)))
          .where(eq(inv.enrollmentId, e.id))
          .orderBy(asc(inv.dueOn), asc(fs.name));
        const ids = invoices.map((i) => i.id);
        const lines = ids.length
          ? await tx
              .select({
                id: line.id,
                invoiceId: line.invoiceId,
                headName: fh.name,
                kind: line.kind,
                amount: line.amount,
              })
              .from(line)
              .innerJoin(fh, and(eq(fh.tenantId, line.tenantId), eq(fh.id, line.feeHeadId)))
              .where(inArray(line.invoiceId, ids))
              .orderBy(asc(fh.sortOrder), asc(line.createdAt))
          : [];
        const adjs = ids.length
          ? await tx
              .select({
                id: adj.id,
                invoiceId: adj.invoiceId,
                lineId: adj.lineId,
                kind: adj.kind,
                amount: adj.amount,
                reason: adj.reason,
                status: adj.status,
                decisionNote: adj.decisionNote,
                createdAt: adj.createdAt,
              })
              .from(adj)
              .where(inArray(adj.invoiceId, ids))
              .orderBy(asc(adj.createdAt))
          : [];
        const concessions = await tx
          .select({
            id: sc.id,
            typeName: ct.name,
            kind: ct.kind,
            mode: sc.mode,
            value: sc.value,
            reason: sc.reason,
            status: sc.status,
            decisionNote: sc.decisionNote,
            createdAt: sc.createdAt,
          })
          .from(sc)
          .innerJoin(ct, and(eq(ct.tenantId, sc.tenantId), eq(ct.id, sc.concessionTypeId)))
          .where(eq(sc.enrollmentId, e.id))
          .orderBy(asc(sc.createdAt));
        const optional = await tx
          .select({
            id: fs.id,
            name: fs.name,
            assignmentId: schema.feeAssignments.id,
          })
          .from(fs)
          .leftJoin(
            schema.feeAssignments,
            and(
              eq(schema.feeAssignments.tenantId, fs.tenantId),
              eq(schema.feeAssignments.structureId, fs.id),
              eq(schema.feeAssignments.enrollmentId, e.id),
              sql`${schema.feeAssignments.removedAt} is null`,
            ),
          )
          .where(
            and(
              eq(fs.campusId, e.campusId),
              eq(fs.academicYearId, e.academicYearId),
              eq(fs.kind, 'optional'),
              sql`${fs.status} <> 'archived'`,
            ),
          )
          .orderBy(asc(fs.name));

        const books = await loadBooks(tx);
        const statement = books
          ? ((
              await tx.execute(sql`
                select j.posted_on::text as date, j.memo, j.source_type as "sourceType",
                  e.debit::bigint as debit, e.credit::bigint as credit, j.created_at as "createdAt",
                  j.reverses_id is not null as reversal
                from ledger_entries e
                join ledger_journals j on j.tenant_id = e.tenant_id and j.id = e.journal_id
                where e.student_id = ${studentId}
                  and e.account_id in (${books.accounts.receivable}, ${books.accounts.advance})
                  and j.campus_id = ${e.campusId}
                order by j.posted_on, j.created_at, j.id`)
            ).rows as Array<Record<string, unknown>>)
          : [];
        let running = 0;

        // Receipts of this student at this campus, and what each settles.
        const payments = (
          await tx.execute(sql`
            select p.id, p.receipt_number as "receiptNumber", p.received_on::text as "receivedOn",
              p.mode, p.amount::bigint as amount, p.reference, p.status, p.cancel_reason as "cancelReason",
              p.bounce_reason as "bounceReason",
              app.payment_used(p.tenant_id, p.id)::bigint as allocated
            from fee_payments p
            where p.student_id = ${studentId} and p.campus_id = ${e.campusId}
            order by p.received_on desc, p.created_at desc`)
        ).rows.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          receiptNumber: r.receiptNumber as string,
          receivedOn: r.receivedOn as string,
          mode: r.mode as string,
          amount: Number(r.amount),
          allocated: Number(r.allocated),
          reference: r.reference as string,
          status: r.status as string,
          cancelReason: (r.cancelReason ?? r.bounceReason ?? null) as string | null,
        }));
        const livePayments = payments.filter(
          (p) => p.status === 'cleared' || p.status === 'pending',
        );
        const allocations = ids.length
          ? (
              await tx.execute(sql`
                select x.line_id as "lineId", x.invoice_id as "invoiceId", x.amount::bigint as amount,
                  p.status
                from fee_allocations x
                join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
                where x.invoice_id in (${sql.join(
                  ids.map((i) => sql`${i}`),
                  sql`, `,
                )}) and x.released_at is null and p.status in ('cleared', 'pending')`)
            ).rows.map((r: Record<string, unknown>) => ({
              lineId: r.lineId as string,
              invoiceId: r.invoiceId as string,
              amount: Number(r.amount),
              pending: r.status === 'pending',
            }))
          : [];

        const invoiceViews = invoices.map((v) => {
          const ls = lines.filter((l) => l.invoiceId === v.id);
          const as = adjs.filter((a) => a.invoiceId === v.id);
          const al = allocations.filter((a) => a.invoiceId === v.id);
          const billed = ls.reduce((n, l) => n + l.amount, 0);
          const reduced = as
            .filter((a) => a.status === 'approved')
            .reduce((n, a) => n + a.amount, 0);
          const paid = al.reduce((n, a) => n + a.amount, 0);
          const balance = billed - reduced - paid;
          return {
            ...v,
            billed,
            reduced,
            paid,
            chequePending: al.some((a) => a.pending),
            balance,
            state:
              v.status === 'cancelled'
                ? 'cancelled'
                : balance <= 0
                  ? 'settled'
                  : v.dueOn < today
                    ? 'overdue'
                    : 'due',
            lines: ls.map((l) => {
              const la = as.filter((a) => a.lineId === l.id);
              return {
                id: l.id,
                headName: l.headName,
                kind: l.kind,
                amount: l.amount,
                reduced: la
                  .filter((a) => a.status === 'approved')
                  .reduce((n, a) => n + a.amount, 0),
                pending: la.filter((a) => a.status === 'pending').reduce((n, a) => n + a.amount, 0),
                paid: al.filter((a) => a.lineId === l.id).reduce((n, a) => n + a.amount, 0),
              };
            }),
            adjustments: as,
          };
        });
        const active = invoiceViews.filter((v) => v.status === 'active');
        return {
          enrollment: e,
          years: visible.map((x) => ({ academicYearId: x.academicYearId, yearName: x.yearName })),
          today,
          totals: {
            billed: active.reduce((n, v) => n + v.billed, 0),
            reduced: active.reduce((n, v) => n + v.reduced, 0),
            paid: active.reduce((n, v) => n + v.paid, 0),
            balance: active.reduce((n, v) => n + v.balance, 0),
            advance: livePayments.reduce((n, p) => n + p.amount - p.allocated, 0),
            overdue: active.filter((v) => v.state === 'overdue').reduce((n, v) => n + v.balance, 0),
          },
          invoices: invoiceViews,
          payments,
          concessions,
          optional: optional.map((o) => ({
            structureId: o.id,
            name: o.name,
            assignmentId: o.assignmentId,
          })),
          statement: statement.map((r) => {
            const debit = Number(r.debit);
            const credit = Number(r.credit);
            running += debit - credit;
            return {
              date: r.date as string,
              memo: r.memo as string,
              sourceType: r.sourceType as string,
              reversal: r.reversal as boolean,
              debit,
              credit,
              balance: running,
            };
          }),
          can: {
            collect: access.has('fees.collect', e.campusId),
            cancelReceipt: access.has('fees.cancel_receipt', e.campusId),
            configure: access.has('fees.configure', e.campusId),
            approve: access.has('fees.concession.approve', e.campusId),
            waive:
              access.has('fees.concession.approve', e.campusId) ||
              access.has('fees.configure', e.campusId) ||
              access.has('fees.collect', e.campusId),
          },
        };
      },
      { readOnly: true },
    );
  }

  /** Chart of accounts with balances for a campus (trial balance). */
  accounts(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.visibleCampus(tx, access, campusId);
        const res = await tx.execute(sql`
          select a.id, a.code, a.name, a.type, a.system_key as "systemKey",
            coalesce(sum(e.debit), 0)::bigint as debit, coalesce(sum(e.credit), 0)::bigint as credit
          from ledger_accounts a
          left join (ledger_entries e join ledger_journals j on j.tenant_id = e.tenant_id and j.id = e.journal_id
            and j.campus_id = ${campusId}) on e.tenant_id = a.tenant_id and e.account_id = a.id
          group by a.id order by a.code`);
        const rows = (res.rows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          code: r.code as string,
          name: r.name as string,
          type: r.type as string,
          systemKey: r.systemKey as string | null,
          debit: Number(r.debit),
          credit: Number(r.credit),
          balance: Number(r.debit) - Number(r.credit),
        }));
        return {
          accounts: rows,
          totals: {
            debit: rows.reduce((n, r) => n + r.debit, 0),
            credit: rows.reduce((n, r) => n + r.credit, 0),
          },
        };
      },
      { readOnly: true },
    );
  }
}
