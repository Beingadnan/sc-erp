import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type {
  ConcessionTypeInput,
  FeeHeadInput,
  StructureCreateInput,
  StructurePlanInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { assertCampus } from '../academic/campus-check.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import { createIncomeAccount, ensureFeeBooks } from './ledger.js';

const fh = schema.feeHeads;
const fs = schema.feeStructures;
const fsc = schema.feeStructureClasses;
const fi = schema.feeInstallments;
const fit = schema.feeStructureItems;
const fa = schema.feeAssignments;
const ct = schema.concessionTypes;
const inv = schema.feeInvoices;
const gl = schema.gradeLevels;
const en = schema.studentEnrollments;
const st = schema.students;
const sec = schema.sections;

const headColumns = {
  id: fh.id,
  code: fh.code,
  name: fh.name,
  category: fh.category,
  gstRate: fh.gstRate,
  refundable: fh.refundable,
  system: fh.system,
  active: fh.active,
  sortOrder: fh.sortOrder,
};

const FEE_PERMS = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];

@Injectable()
export class FeeSetupService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /** Heads and concession types are shared by every campus, so changing them is school-wide. */
  private assertSchoolWide(access: TenantAccess) {
    if (!access.hasTenantWide('fees.configure')) {
      throw new AppError(
        'FORBIDDEN',
        'Fee heads and concession types are shared by all campuses; only school-wide fee managers can change them',
      );
    }
  }

  /* ------------------------------------- heads ------------------------------------- */

  listHeads(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      (tx) => tx.select(headColumns).from(fh).orderBy(asc(fh.sortOrder), asc(fh.name)),
      { readOnly: true },
    );
  }

  createHead(access: TenantAccess, input: FeeHeadInput) {
    this.assertSchoolWide(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await ensureFeeBooks(tx, access.tenantId);
      const [dup] = await tx
        .select({ id: fh.id })
        .from(fh)
        .where(sql`${fh.code} = ${input.code} or lower(${fh.name}) = lower(${input.name})`);
      if (dup) throw new AppError('CONFLICT', 'A fee head with this code or name already exists');
      const incomeAccountId = await createIncomeAccount(
        tx,
        access.tenantId,
        input.name,
        input.category === 'deposit',
      );
      try {
        const [row] = await tx
          .insert(fh)
          .values({
            tenantId: access.tenantId,
            ...input,
            refundable: input.category === 'deposit' ? true : input.refundable,
            incomeAccountId,
          })
          .returning(headColumns);
        await this.audit.record(tx, access, {
          action: 'fees.head_created',
          entity: 'fee_head',
          entityId: row!.id,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          fee_heads_code_uq: 'A fee head with this code already exists',
          fee_heads_name_uq: 'A fee head with this name already exists',
        });
      }
    });
  }

  updateHead(
    access: TenantAccess,
    id: string,
    input: Partial<Pick<FeeHeadInput, 'name' | 'gstRate' | 'refundable' | 'sortOrder'>> & {
      active?: boolean;
    },
  ) {
    this.assertSchoolWide(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [current] = await tx.select(headColumns).from(fh).where(eq(fh.id, id));
      if (!current) throw notFound('Fee head');
      if (current.system && (input.active === false || input.gstRate !== undefined)) {
        throw new AppError('CONFLICT', 'The late fee head cannot be switched off or taxed');
      }
      try {
        const [row] = await tx
          .update(fh)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(fh.id, id))
          .returning(headColumns);
        await this.audit.record(tx, access, {
          action: 'fees.head_updated',
          entity: 'fee_head',
          entityId: id,
          diff: { before: current, after: input },
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          fee_heads_name_uq: 'A fee head with this name already exists',
        });
      }
    });
  }

  /* ----------------------------------- structures ----------------------------------- */

  listStructures(access: TenantAccess, campusId: string, academicYearId?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!FEE_PERMS.some((p) => access.has(p, campusId))) throw notFound('Campus');
        const [campus] = await tx
          .select({ id: schema.campuses.id })
          .from(schema.campuses)
          .where(eq(schema.campuses.id, campusId));
        if (!campus) throw notFound('Campus');
        const rows = await tx
          .select({
            id: fs.id,
            name: fs.name,
            kind: fs.kind,
            status: fs.status,
            academicYearId: fs.academicYearId,
            yearName: schema.academicYears.name,
            total: sql<number>`(select coalesce(sum(amount), 0)::bigint from fee_structure_items i
              where i.tenant_id = ${fs.tenantId} and i.structure_id = ${fs.id})`.mapWith(Number),
            installments: sql<number>`(select count(*)::int from fee_installments i
              where i.tenant_id = ${fs.tenantId} and i.structure_id = ${fs.id})`,
            classes: sql<string[]>`coalesce((select array_agg(g.name order by g.sort_order)
              from fee_structure_classes c join grade_levels g on g.tenant_id = c.tenant_id and g.id = c.grade_level_id
              where c.tenant_id = ${fs.tenantId} and c.structure_id = ${fs.id}), '{}')`,
            assigned: sql<number>`(select count(*)::int from fee_assignments a
              where a.tenant_id = ${fs.tenantId} and a.structure_id = ${fs.id} and a.removed_at is null)`,
            demands: sql<number>`(select count(*)::int from fee_invoices v
              where v.tenant_id = ${fs.tenantId} and v.structure_id = ${fs.id} and v.status = 'active')`,
          })
          .from(fs)
          .innerJoin(
            schema.academicYears,
            and(
              eq(schema.academicYears.tenantId, fs.tenantId),
              eq(schema.academicYears.id, fs.academicYearId),
            ),
          )
          .where(
            and(
              eq(fs.campusId, campusId),
              academicYearId ? eq(fs.academicYearId, academicYearId) : undefined,
            ),
          )
          .orderBy(sql`${fs.status} = 'archived'`, asc(fs.kind), asc(fs.name));
        return rows;
      },
      { readOnly: true },
    );
  }

  /** Loads a structure the caller may see; `need` checks a permission at its campus. */
  async structureRow(tx: Transaction, access: TenantAccess, id: string, need?: string) {
    const [row] = await tx.select().from(fs).where(eq(fs.id, id));
    if (!row || !FEE_PERMS.some((p) => access.has(p, row.campusId)))
      throw notFound('Fee structure');
    if (need && !access.has(need, row.campusId)) {
      throw new AppError('FORBIDDEN', 'You cannot change fee structures of this campus');
    }
    return row;
  }

  getStructure(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const s = await this.structureRow(tx, access, id);
        const classes = await tx
          .select({ id: gl.id, name: gl.name })
          .from(fsc)
          .innerJoin(gl, and(eq(gl.tenantId, fsc.tenantId), eq(gl.id, fsc.gradeLevelId)))
          .where(eq(fsc.structureId, id))
          .orderBy(asc(gl.sortOrder));
        const installments = await tx
          .select({ id: fi.id, seq: fi.seq, label: fi.label, dueOn: fi.dueOn })
          .from(fi)
          .where(eq(fi.structureId, id))
          .orderBy(asc(fi.seq));
        const items = await tx
          .select({
            installmentId: fit.installmentId,
            feeHeadId: fit.feeHeadId,
            amount: fit.amount,
          })
          .from(fit)
          .where(eq(fit.structureId, id));
        const [{ n: demands }] = (await tx
          .select({ n: count() })
          .from(inv)
          .where(and(eq(inv.structureId, id), eq(inv.status, 'active')))) as [{ n: number }];
        return {
          id: s.id,
          campusId: s.campusId,
          academicYearId: s.academicYearId,
          name: s.name,
          kind: s.kind,
          status: s.status,
          lateFee: {
            kind: s.lateFeeKind,
            amount: s.lateFeeAmount,
            graceDays: s.lateFeeGraceDays,
            cap: s.lateFeeCap,
          },
          classes,
          installments: installments.map((i) => ({
            ...i,
            items: items
              .filter((x) => x.installmentId === i.id)
              .map(({ installmentId: _, ...x }) => x),
            total: items.filter((x) => x.installmentId === i.id).reduce((n, x) => n + x.amount, 0),
          })),
          total: items.reduce((n, x) => n + x.amount, 0),
          demands,
          canEdit: access.has('fees.configure', s.campusId),
        };
      },
      { readOnly: true },
    );
  }

  private async setClasses(
    tx: Transaction,
    access: TenantAccess,
    s: { id: string; campusId: string },
    ids: string[],
  ) {
    if (ids.length) {
      const found = await tx
        .select({ id: gl.id })
        .from(gl)
        .where(and(eq(gl.campusId, s.campusId), inArray(gl.id, ids)));
      if (found.length !== new Set(ids).size) {
        throw new AppError('VALIDATION_FAILED', 'Some classes are not in this campus', {
          fields: { gradeLevelIds: 'Choose classes of this campus' },
        });
      }
    }
    await tx.delete(fsc).where(eq(fsc.structureId, s.id));
    if (ids.length) {
      await tx.insert(fsc).values(
        [...new Set(ids)].map((g) => ({
          tenantId: access.tenantId,
          campusId: s.campusId,
          structureId: s.id,
          gradeLevelId: g,
        })),
      );
    }
  }

  createStructure(access: TenantAccess, input: StructureCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await assertCampus(tx, access, input.campusId, 'fees.configure');
      await ensureFeeBooks(tx, access.tenantId);
      const [year] = await tx
        .select({ id: schema.academicYears.id })
        .from(schema.academicYears)
        .where(
          and(
            eq(schema.academicYears.id, input.academicYearId),
            eq(schema.academicYears.campusId, input.campusId),
          ),
        );
      if (!year) throw notFound('Academic year');
      if (input.kind === 'optional' && input.gradeLevelIds.length) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Optional fees are assigned to students, not classes',
          {
            fields: { gradeLevelIds: 'Leave empty for optional fees' },
          },
        );
      }
      try {
        const [row] = await tx
          .insert(fs)
          .values({
            tenantId: access.tenantId,
            campusId: input.campusId,
            academicYearId: input.academicYearId,
            name: input.name,
            kind: input.kind,
            lateFeeKind: input.lateFee.kind,
            lateFeeAmount: input.lateFee.amount,
            lateFeeGraceDays: input.lateFee.graceDays,
            lateFeeCap: input.lateFee.cap,
          })
          .returning({ id: fs.id });
        await this.setClasses(
          tx,
          access,
          { id: row!.id, campusId: input.campusId },
          input.gradeLevelIds,
        );
        await this.audit.record(tx, access, {
          action: 'fees.structure_created',
          entity: 'fee_structure',
          entityId: row!.id,
          campusId: input.campusId,
          diff: input,
        });
        return { id: row!.id };
      } catch (err) {
        return rethrowConflicts(err, {
          fee_structures_name_uq: 'A fee structure with this name already exists for this year',
        });
      }
    });
  }

  updateStructure(
    access: TenantAccess,
    id: string,
    input: { name?: string; gradeLevelIds?: string[]; lateFee?: StructureCreateInput['lateFee'] },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.structureRow(tx, access, id, 'fees.configure');
      if (s.status === 'archived')
        throw new AppError('CONFLICT', 'Archived structures cannot be changed');
      if (input.gradeLevelIds) {
        if (s.kind === 'optional' && input.gradeLevelIds.length) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Optional fees are assigned to students, not classes',
          );
        }
        await this.setClasses(tx, access, s, input.gradeLevelIds);
      }
      try {
        await tx
          .update(fs)
          .set({
            ...(input.name ? { name: input.name } : {}),
            ...(input.lateFee
              ? {
                  lateFeeKind: input.lateFee.kind,
                  lateFeeAmount: input.lateFee.amount,
                  lateFeeGraceDays: input.lateFee.graceDays,
                  lateFeeCap: input.lateFee.cap,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(fs.id, id));
      } catch (err) {
        return rethrowConflicts(err, {
          fee_structures_name_uq: 'A fee structure with this name already exists for this year',
        });
      }
      await this.audit.record(tx, access, {
        action: 'fees.structure_updated',
        entity: 'fee_structure',
        entityId: id,
        campusId: s.campusId,
        diff: input,
      });
      return { id };
    });
  }

  /** Replaces installments and amounts. Only while a draft. */
  setPlan(access: TenantAccess, id: string, plan: StructurePlanInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.structureRow(tx, access, id, 'fees.configure');
      if (s.status !== 'draft') {
        throw new AppError(
          'CONFLICT',
          'Amounts can only be changed while the structure is a draft',
        );
      }
      const headIds = [
        ...new Set(plan.installments.flatMap((i) => i.items.map((x) => x.feeHeadId))),
      ];
      if (headIds.length) {
        const found = await tx
          .select({ id: fh.id, active: fh.active, system: fh.system })
          .from(fh)
          .where(inArray(fh.id, headIds));
        if (found.length !== headIds.length || found.some((h) => !h.active || h.system)) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Use active fee heads (late fees are added automatically)',
          );
        }
      }
      const [year] = await tx
        .select({ startsOn: schema.academicYears.startsOn, endsOn: schema.academicYears.endsOn })
        .from(schema.academicYears)
        .where(eq(schema.academicYears.id, s.academicYearId));
      const outside = plan.installments.find(
        (i) => i.dueOn < year!.startsOn || i.dueOn > year!.endsOn,
      );
      if (outside) {
        throw new AppError(
          'VALIDATION_FAILED',
          `“${outside.label}” is due outside the academic year`,
        );
      }
      await tx.delete(fi).where(eq(fi.structureId, id));
      const rows = await tx
        .insert(fi)
        .values(
          plan.installments.map((x, i) => ({
            tenantId: access.tenantId,
            structureId: id,
            seq: i + 1,
            label: x.label,
            dueOn: x.dueOn,
          })),
        )
        .returning({ id: fi.id, seq: fi.seq });
      const bySeq = new Map(rows.map((r) => [r.seq, r.id]));
      const items = plan.installments.flatMap((x, i) =>
        x.items.map((it) => ({
          tenantId: access.tenantId,
          structureId: id,
          installmentId: bySeq.get(i + 1)!,
          feeHeadId: it.feeHeadId,
          amount: it.amount,
        })),
      );
      if (items.length) await tx.insert(fit).values(items);
      await tx.update(fs).set({ updatedAt: new Date() }).where(eq(fs.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.structure_plan_set',
        entity: 'fee_structure',
        entityId: id,
        campusId: s.campusId,
        diff: {
          installments: plan.installments.length,
          total: items.reduce((n, x) => n + x.amount, 0),
        },
      });
      return { id };
    });
  }

  setStatus(access: TenantAccess, id: string, status: 'draft' | 'published' | 'archived') {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.structureRow(tx, access, id, 'fees.configure');
      if (s.status === status) return { id, status };
      if (status === 'published') {
        const [{ n }] = (await tx
          .select({ n: count() })
          .from(fit)
          .where(eq(fit.structureId, id))) as [{ n: number }];
        if (!n)
          throw new AppError('VALIDATION_FAILED', 'Add installments and amounts before publishing');
        if (s.kind === 'class') {
          const [{ c }] = (await tx
            .select({ c: count() })
            .from(fsc)
            .where(eq(fsc.structureId, id))) as [{ c: number }];
          if (!c)
            throw new AppError('VALIDATION_FAILED', 'Choose the classes this structure applies to');
        }
      }
      if (status === 'draft') {
        const [{ n }] = (await tx
          .select({ n: count() })
          .from(inv)
          .where(and(eq(inv.structureId, id), eq(inv.status, 'active')))) as [{ n: number }];
        if (n) {
          throw new AppError(
            'CONFLICT',
            'Demands have been raised from this structure; cancel them before changing amounts',
          );
        }
      }
      await tx.update(fs).set({ status, updatedAt: new Date() }).where(eq(fs.id, id));
      await this.audit.record(tx, access, {
        action: `fees.structure_${status}`,
        entity: 'fee_structure',
        entityId: id,
        campusId: s.campusId,
        diff: { from: s.status, to: status },
      });
      return { id, status };
    });
  }

  deleteStructure(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.structureRow(tx, access, id, 'fees.configure');
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(inv)
        .where(eq(inv.structureId, id))) as [{ n: number }];
      const [{ a }] = (await tx.select({ a: count() }).from(fa).where(eq(fa.structureId, id))) as [
        { a: number },
      ];
      if (s.status !== 'draft' || n || a) {
        throw new AppError(
          'CONFLICT',
          'Only unused draft structures can be deleted; archive it instead',
        );
      }
      await tx.delete(fs).where(eq(fs.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.structure_deleted',
        entity: 'fee_structure',
        entityId: id,
        campusId: s.campusId,
        diff: { name: s.name },
      });
    });
  }

  /* ------------------------------ optional fee students ------------------------------ */

  listAssigned(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.structureRow(tx, access, id);
        return tx
          .select({
            id: fa.id,
            studentId: st.id,
            name: sql<string>`trim(${st.firstName} || ' ' || ${st.lastName})`,
            admissionNumber: st.admissionNumber,
            className: gl.name,
            sectionName: sec.name,
            assignedAt: fa.assignedAt,
          })
          .from(fa)
          .innerJoin(st, and(eq(st.tenantId, fa.tenantId), eq(st.id, fa.studentId)))
          .innerJoin(en, and(eq(en.tenantId, fa.tenantId), eq(en.id, fa.enrollmentId)))
          .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .where(and(eq(fa.structureId, id), isNull(fa.removedAt)))
          .orderBy(asc(gl.sortOrder), asc(sec.name), asc(st.firstName));
      },
      { readOnly: true },
    );
  }

  assign(access: TenantAccess, id: string, studentId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.structureRow(tx, access, id, 'fees.configure');
      if (s.kind !== 'optional') {
        throw new AppError(
          'CONFLICT',
          'Class fees apply to whole classes; only optional fees are assigned',
        );
      }
      if (s.status === 'archived') throw new AppError('CONFLICT', 'This structure is archived');
      const [e] = await tx
        .select({ id: en.id })
        .from(en)
        .where(
          and(
            eq(en.studentId, studentId),
            eq(en.academicYearId, s.academicYearId),
            eq(en.campusId, s.campusId),
            eq(en.status, 'active'),
          ),
        );
      if (!e) throw notFound('Student enrolled in this year');
      try {
        const [row] = await tx
          .insert(fa)
          .values({
            tenantId: access.tenantId,
            structureId: id,
            enrollmentId: e.id,
            studentId,
            assignedBy: access.userId,
          })
          .returning({ id: fa.id });
        await this.audit.record(tx, access, {
          action: 'fees.assigned',
          entity: 'fee_structure',
          entityId: id,
          campusId: s.campusId,
          diff: { studentId },
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          fee_assignments_active_uq: 'The student is already on this fee',
        });
      }
    });
  }

  unassign(access: TenantAccess, id: string, assignmentId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.structureRow(tx, access, id, 'fees.configure');
      const [a] = await tx
        .select()
        .from(fa)
        .where(and(eq(fa.id, assignmentId), eq(fa.structureId, id), isNull(fa.removedAt)));
      if (!a) throw notFound('Assignment');
      await tx
        .update(fa)
        .set({ removedAt: new Date(), removedBy: access.userId })
        .where(eq(fa.id, assignmentId));
      await this.audit.record(tx, access, {
        action: 'fees.unassigned',
        entity: 'fee_structure',
        entityId: id,
        campusId: s.campusId,
        diff: { studentId: a.studentId },
      });
    });
  }

  /* --------------------------------- concession types --------------------------------- */

  listConcessionTypes(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      (tx) =>
        tx
          .select({
            id: ct.id,
            name: ct.name,
            kind: ct.kind,
            mode: ct.mode,
            value: ct.value,
            feeHeadIds: ct.feeHeadIds,
            active: ct.active,
          })
          .from(ct)
          .orderBy(sql`${ct.active} desc`, asc(ct.name)),
      { readOnly: true },
    );
  }

  private async checkHeads(tx: Transaction, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.select({ id: fh.id }).from(fh).where(inArray(fh.id, ids));
    if (found.length !== new Set(ids).size)
      throw new AppError('VALIDATION_FAILED', 'Unknown fee head');
  }

  createConcessionType(access: TenantAccess, input: ConcessionTypeInput) {
    this.assertSchoolWide(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await this.checkHeads(tx, input.feeHeadIds);
      try {
        const [row] = await tx
          .insert(ct)
          .values({ tenantId: access.tenantId, ...input })
          .returning({ id: ct.id });
        await this.audit.record(tx, access, {
          action: 'fees.concession_type_created',
          entity: 'concession_type',
          entityId: row!.id,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          concession_types_name_uq: 'A concession with this name already exists',
        });
      }
    });
  }

  updateConcessionType(
    access: TenantAccess,
    id: string,
    input: { name?: string; feeHeadIds?: string[]; active?: boolean },
  ) {
    this.assertSchoolWide(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [cur] = await tx.select({ id: ct.id }).from(ct).where(eq(ct.id, id));
      if (!cur) throw notFound('Concession type');
      if (input.feeHeadIds) await this.checkHeads(tx, input.feeHeadIds);
      try {
        await tx
          .update(ct)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(ct.id, id));
      } catch (err) {
        return rethrowConflicts(err, {
          concession_types_name_uq: 'A concession with this name already exists',
        });
      }
      await this.audit.record(tx, access, {
        action: 'fees.concession_type_updated',
        entity: 'concession_type',
        entityId: id,
        diff: input,
      });
      return { id };
    });
  }
}
