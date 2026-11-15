import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { normaliseHeader, parseRupees } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { todayIn } from '../attendance/attendance.service.js';
import { ensureFeeBooks, postJournals } from '../fees/ledger.js';
import { DemandsService } from '../fees/demands.service.js';
import { PaymentsService } from '../fees/payments.service.js';

const imp = schema.setupImports;
const MAX_ROWS = 5000;
const BOM_RE = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const HEAD_CODE = 'PREVDUE';

interface Row {
  row: number;
  studentId: string;
  enrollmentId: string;
  admissionNumber: string;
  name: string;
  className: string;
  dues: number;
  advance: number;
  note: string;
}
interface Created {
  invoices: string[];
  payments: string[];
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
  }
  return String(v);
};

/**
 * Old fee balances: what each student still owed from before (a "Previous year dues" demand,
 * credited to the Opening balances account, not income) and any advance they had paid (an
 * `OB/` entry, kept out of cash and collection reports). Preview, import and undo.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly demands: DemandsService,
    private readonly payments: PaymentsService,
  ) {}

  template() {
    return String.fromCharCode(0xfeff) + 'Admission no,Name,Previous dues,Advance,Note\r\nA-101,Riya Sharma,"4,500",0,Term 4 of last year\r\nA-102,Kabir Singh,0,1200,Paid extra in March\r\n';
  }

  private async read(file: { buffer: Buffer; originalname: string; size: number } | undefined) {
    if (!file?.buffer?.length) {
      throw new AppError('VALIDATION_FAILED', 'Choose a CSV or Excel file', {
        fields: { file: 'Required' },
      });
    }
    if (file.size > 2 * 1024 * 1024)
      throw new AppError('VALIDATION_FAILED', 'Files can be at most 2 MB');
    let rows: Array<Record<string, string>>;
    if (file.buffer.subarray(0, 2).toString('latin1') === 'PK') {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
      } catch {
        throw new AppError('VALIDATION_FAILED', 'This Excel file could not be read');
      }
      const ws = wb.worksheets[0];
      const headers: string[] = [];
      ws?.getRow(1).eachCell(
        { includeEmpty: true },
        (c, i) => (headers[i - 1] = normaliseHeader(cellText(c.value))),
      );
      rows = [];
      for (let r = 2; ws && r <= ws.rowCount; r++) {
        const rec: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (h) rec[h] = cellText(ws.getRow(r).getCell(i + 1).value).trim();
        });
        rows.push(rec);
      }
    } else {
      rows = Papa.parse<Record<string, string>>(file.buffer.toString('utf8').replace(BOM_RE, ''), {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: normaliseHeader,
        transform: (v) => v.trim(),
      }).data;
    }
    if (rows.length > MAX_ROWS) throw new AppError('VALIDATION_FAILED', `At most ${MAX_ROWS} rows`);
    return rows;
  }

  async preview(
    access: TenantAccess,
    campusId: string,
    academicYearId: string | undefined,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    if (!access.has('fees.configure', campusId)) throw notFound('Campus');
    const raw = await this.read(file);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [year] = (
        await tx.execute(sql`
          select id, name from academic_years where campus_id = ${campusId}
            ${academicYearId ? sql`and id = ${academicYearId}` : sql``}
          order by is_current desc, starts_on desc limit 1`)
      ).rows as Array<{ id: string; name: string }>;
      if (!year) throw new AppError('CONFLICT', 'Add the academic year first');
      const students = (
        await tx.execute(sql`
          select s.id, s.admission_number as "admissionNumber", trim(s.first_name || ' ' || s.last_name) as name,
            e.id as "enrollmentId", g.name || ' ' || sec.name as "className",
            exists (select 1 from fee_invoices v join fee_installments i on i.tenant_id = v.tenant_id and i.id = v.installment_id
                    join fee_structures fs on fs.tenant_id = v.tenant_id and fs.id = v.structure_id
                    where v.enrollment_id = e.id and v.status = 'active' and fs.name = 'Previous year dues') as "hasOpening"
          from student_enrollments e
          join students s on s.tenant_id = e.tenant_id and s.id = e.student_id
          join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
          join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
          where e.academic_year_id = ${year.id} and e.campus_id = ${campusId} and e.status = 'active'`)
      ).rows as Array<{
        id: string;
        admissionNumber: string;
        name: string;
        enrollmentId: string;
        className: string;
        hasOpening: boolean;
      }>;
      const byAdm = new Map(students.map((s) => [s.admissionNumber.toUpperCase(), s]));
      const problems: Array<{ row: number; message: string }> = [];
      const ok: Row[] = [];
      raw.forEach((r, i) => {
        const row = i + 2;
        if (!Object.values(r).some(Boolean)) return;
        const adm = (r.admission_number ?? r.admission ?? '').trim();
        const st = byAdm.get(adm.toUpperCase());
        const amt = (k: string[]) => {
          const t = k.map((x) => r[x]).find((x) => x !== undefined && x !== '') ?? '0';
          return parseRupees(t);
        };
        const dues = amt(['previous_dues', 'dues', 'balance', 'due', 'pending', 'outstanding']);
        const advance = amt(['advance', 'excess', 'extra', 'credit']);
        if (!adm) return void problems.push({ row, message: 'Admission number is empty' });
        if (!st)
          return void problems.push({
            row,
            message: `No active student with admission number ${adm} in ${year.name}`,
          });
        if (dues === null || advance === null)
          return void problems.push({
            row,
            message: 'Amounts must be numbers in rupees (e.g. 4500 or 4,500.50)',
          });
        if (!dues && !advance) return;
        if (ok.some((o) => o.studentId === st.id))
          return void problems.push({ row, message: `${adm} is listed twice` });
        if (dues && st.hasOpening) {
          return void problems.push({
            row,
            message: `${adm} already has previous dues imported; undo that import first`,
          });
        }
        ok.push({
          row,
          studentId: st.id,
          enrollmentId: st.enrollmentId,
          admissionNumber: st.admissionNumber,
          name: st.name,
          className: st.className,
          dues,
          advance,
          note: (r.note ?? r.remarks ?? '').slice(0, 200),
        });
      });
      const summary = {
        yearName: year.name,
        students: ok.length,
        dues: ok.reduce((n, o) => n + o.dues, 0),
        advance: ok.reduce((n, o) => n + o.advance, 0),
      };
      const [rec] = await tx
        .insert(imp)
        .values({
          tenantId: access.tenantId,
          campusId,
          academicYearId: year.id,
          kind: 'opening',
          fileName: (file!.originalname || 'balances').slice(0, 200),
          plan: { rows: ok } as unknown as Record<string, unknown>,
          problems,
          summary,
          createdBy: access.userId,
        })
        .returning({ id: imp.id });
      return {
        id: rec!.id,
        summary,
        problems: problems.slice(0, 500),
        problemCount: problems.length,
        rows: ok.slice(0, 500).map(({ studentId: _s, enrollmentId: _e, ...r }) => r),
      };
    });
  }

  /** The "Previous year dues" head, structure and installment for a campus and year. */
  private async scaffold(
    tx: Transaction,
    access: TenantAccess,
    campusId: string,
    yearId: string,
    dueOn: string,
  ) {
    const books = await ensureFeeBooks(tx, access.tenantId);
    let [head] = await tx
      .select({ id: schema.feeHeads.id })
      .from(schema.feeHeads)
      .where(eq(schema.feeHeads.code, HEAD_CODE));
    if (!head) {
      [head] = await tx
        .insert(schema.feeHeads)
        .values({
          tenantId: access.tenantId,
          code: HEAD_CODE,
          name: 'Previous year dues',
          category: 'other',
          incomeAccountId: books.accounts.opening,
          system: true,
          sortOrder: 99,
        })
        .returning({ id: schema.feeHeads.id });
    }
    let [st] = await tx
      .select({ id: schema.feeStructures.id })
      .from(schema.feeStructures)
      .where(
        and(
          eq(schema.feeStructures.campusId, campusId),
          eq(schema.feeStructures.academicYearId, yearId),
          eq(schema.feeStructures.name, 'Previous year dues'),
        ),
      );
    if (!st) {
      [st] = await tx
        .insert(schema.feeStructures)
        .values({
          tenantId: access.tenantId,
          campusId,
          academicYearId: yearId,
          name: 'Previous year dues',
          kind: 'optional',
          status: 'published',
        })
        .returning({ id: schema.feeStructures.id });
    }
    let [inst] = await tx
      .select({ id: schema.feeInstallments.id })
      .from(schema.feeInstallments)
      .where(eq(schema.feeInstallments.structureId, st!.id));
    if (!inst) {
      [inst] = await tx
        .insert(schema.feeInstallments)
        .values({
          tenantId: access.tenantId,
          structureId: st!.id,
          seq: 1,
          label: 'Opening balance',
          dueOn,
        })
        .returning({ id: schema.feeInstallments.id });
    }
    return { books, headId: head!.id, structureId: st!.id, installmentId: inst!.id };
  }

  private async row(tx: Transaction, access: TenantAccess, id: string) {
    const [r] = await tx
      .select()
      .from(imp)
      .where(and(eq(imp.id, id), eq(imp.kind, 'opening')));
    if (!r || !access.has('fees.configure', r.campusId)) throw notFound('Import');
    return r;
  }

  apply(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`opening:${access.tenantId}`}, 0))`,
      );
      const r = await this.row(tx, access, id);
      if (r.status !== 'previewed')
        throw new AppError('CONFLICT', `This import is already ${r.status}`);
      if ((r.problems as unknown[]).length) {
        throw new AppError('CONFLICT', 'Fix the problems in the file and upload it again');
      }
      const rows = (r.plan as unknown as { rows: Row[] }).rows;
      const [c] = await tx
        .select({ timezone: schema.campuses.timezone })
        .from(schema.campuses)
        .where(eq(schema.campuses.id, r.campusId));
      const today = todayIn(c!.timezone);
      const sc = await this.scaffold(tx, access, r.campusId, r.academicYearId, today);
      const created: Created = { invoices: [], payments: [] };
      const ctx = { tenantId: access.tenantId, userId: access.userId };
      for (const x of rows) {
        if (x.dues) {
          const invoiceId = newId();
          await tx.insert(schema.feeInvoices).values({
            id: invoiceId,
            tenantId: access.tenantId,
            campusId: r.campusId,
            academicYearId: r.academicYearId,
            enrollmentId: x.enrollmentId,
            studentId: x.studentId,
            structureId: sc.structureId,
            installmentId: sc.installmentId,
            dueOn: today,
            createdBy: access.userId,
          });
          await tx.insert(schema.feeInvoiceLines).values({
            tenantId: access.tenantId,
            invoiceId,
            feeHeadId: sc.headId,
            amount: x.dues,
          });
          await postJournals(tx, ctx, [
            {
              campusId: r.campusId,
              postedOn: today,
              sourceType: 'invoice',
              sourceId: invoiceId,
              memo: `Previous year dues — ${x.admissionNumber}${x.note ? ` — ${x.note}` : ''}`,
              entries: [
                { accountId: sc.books.accounts.receivable, studentId: x.studentId, debit: x.dues },
                { accountId: sc.books.accounts.opening, credit: x.dues },
              ],
            },
          ]);
          created.invoices.push(invoiceId);
        }
        if (x.advance) {
          const p = await this.payments.recordInTx(
            tx,
            access,
            {
              studentId: x.studentId,
              mode: 'opening',
              amount: x.advance,
              reference: '',
              bankName: '',
              payerName: '',
              note: ['Advance brought from old records', x.note].filter(Boolean).join('. '),
              idempotencyKey: `opening:${id}:${x.studentId}`,
              allocations: [],
            },
            { campusId: r.campusId, need: 'fees.configure' },
          );
          created.payments.push(p.id as string);
        }
      }
      await tx
        .update(imp)
        .set({
          status: 'applied',
          appliedAt: new Date(),
          created: created as unknown as Record<string, unknown>,
        })
        .where(eq(imp.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.opening_imported',
        entity: 'setup_import',
        entityId: id,
        campusId: r.campusId,
        diff: {
          demands: created.invoices.length,
          advances: created.payments.length,
          ...(r.summary as object),
        },
      });
      return {
        id,
        status: 'applied',
        demands: created.invoices.length,
        advances: created.payments.length,
      };
    });
  }

  /** Undo: only while nobody has paid those dues or used / refunded that advance. */
  async undo(access: TenantAccess, id: string) {
    const r = await withTenant(this.handle.db, access.ctx, async (tx) => {
      const r = await this.row(tx, access, id);
      if (r.status !== 'applied')
        throw new AppError('CONFLICT', `This import is ${r.status}; nothing to undo`);
      const c = r.created as unknown as Created;
      const list = (ids: string[]) =>
        sql.join(
          ids.map((x) => sql`${x}`),
          sql`, `,
        );
      if (c.invoices.length) {
        const paid = (
          await tx.execute(sql`
            select count(*)::int as n from fee_allocations a join fee_invoice_lines l on l.tenant_id = a.tenant_id and l.id = a.line_id
            where l.invoice_id in (${list(c.invoices)}) and a.released_at is null`)
        ).rows[0] as { n: number };
        if (paid.n) {
          throw new AppError(
            'CONFLICT',
            'Some of these previous dues have been paid since. Undo is no longer possible.',
          );
        }
      }
      if (c.payments.length) {
        const used = (
          await tx.execute(sql`
            select count(*)::int as n from fee_payments p
            where p.id in (${list(c.payments)}) and app.payment_used(p.tenant_id, p.id) > 0`)
        ).rows[0] as { n: number };
        if (used.n) {
          throw new AppError(
            'CONFLICT',
            'Some of these advances have been used or refunded. Undo is no longer possible.',
          );
        }
      }
      return r;
    });
    const c = r.created as unknown as Created;
    for (const inv of c.invoices)
      await this.demands.cancelDemand(access, inv, 'Undo of old fee balances import');
    for (const p of c.payments)
      await this.payments.cancel(access, p, 'Undo of old fee balances import');
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.update(imp).set({ status: 'undone', undoneAt: new Date() }).where(eq(imp.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.opening_undone',
        entity: 'setup_import',
        entityId: id,
        campusId: r.campusId,
      });
      return { id, status: 'undone' };
    });
  }

  cancel(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const r = await this.row(tx, access, id);
      if (r.status !== 'previewed')
        throw new AppError('CONFLICT', `This import is already ${r.status}`);
      await tx.update(imp).set({ status: 'cancelled' }).where(eq(imp.id, id));
      return { id, status: 'cancelled' };
    });
  }

  list(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!access.has('fees.configure', campusId)) throw notFound('Campus');
        const rows = (
          await tx.execute(sql`
            select i.id, i.status, i.file_name as "fileName", i.summary, jsonb_array_length(i.problems)::int as "problemCount",
              i.created_at as "createdAt", u.full_name as "byName"
            from setup_imports i left join users u on u.id = i.created_by
            where i.campus_id = ${campusId} and i.kind = 'opening' order by i.created_at desc limit 20`)
        ).rows;
        return { items: rows };
      },
      { readOnly: true },
    );
  }
}
