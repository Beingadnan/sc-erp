import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { GradingScaleCreateInput, GradingScaleUpdateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';

const gs = schema.gradingScales;
const gb = schema.gradingBands;

type Band = GradingScaleCreateInput['bands'][number];

const SCALE_CONFLICTS = {
  grading_scales_tenant_name_uq: 'A grading scale with this name already exists',
  grade_levels_scale_fk:
    'This scale is used by one or more classes. Assign them another scale first.',
};

export interface ScaleWithBands {
  id: string;
  name: string;
  description: string;
  bands: Array<{
    label: string;
    minPercent: number;
    maxPercent: number;
    gradePoint: number | null;
    remark: string;
  }>;
}

/** Highest band first, as report cards print them. */
const sortBands = <T extends { minPercent: number }>(bands: T[]) =>
  [...bands].sort((a, b) => b.minPercent - a.minPercent);

/** Grade for a percentage, or null if it falls in a gap between bands. */
export const gradeFor = (percent: number, bands: ScaleWithBands['bands']) =>
  bands.find((b) => percent >= b.minPercent && percent <= b.maxPercent) ?? null;

@Injectable()
export class GradingService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  list(access: TenantAccess): Promise<ScaleWithBands[]> {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const scales = await tx
          .select({ id: gs.id, name: gs.name, description: gs.description })
          .from(gs)
          .orderBy(asc(gs.name));
        const bands = await tx
          .select({
            scaleId: gb.scaleId,
            label: gb.label,
            minPercent: gb.minPercent,
            maxPercent: gb.maxPercent,
            gradePoint: gb.gradePoint,
            remark: gb.remark,
          })
          .from(gb);
        return scales.map((sc) => ({
          ...sc,
          bands: sortBands(
            bands
              .filter((b) => b.scaleId === sc.id)
              .map((b) => ({
                label: b.label,
                minPercent: Number(b.minPercent),
                maxPercent: Number(b.maxPercent),
                gradePoint: b.gradePoint === null ? null : Number(b.gradePoint),
                remark: b.remark,
              })),
          ),
        }));
      },
      { readOnly: true },
    );
  }

  private assertCanManage(access: TenantAccess) {
    if (!access.hasTenantWide('academic.manage')) {
      throw new AppError('FORBIDDEN', 'Only school-wide academic staff can change grading scales');
    }
  }

  async insertBands(tx: Transaction, tenantId: string, scaleId: string, bands: Band[]) {
    await tx.insert(gb).values(
      sortBands(bands).map((b, i) => ({
        tenantId,
        scaleId,
        label: b.label,
        minPercent: b.minPercent.toFixed(2),
        maxPercent: b.maxPercent.toFixed(2),
        gradePoint: b.gradePoint === null ? null : b.gradePoint.toFixed(2),
        remark: b.remark,
        sortOrder: i,
      })),
    );
  }

  create(access: TenantAccess, input: GradingScaleCreateInput) {
    this.assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      try {
        const [row] = await tx
          .insert(gs)
          .values({ tenantId: access.tenantId, name: input.name, description: input.description })
          .returning({ id: gs.id });
        await this.insertBands(tx, access.tenantId, row!.id, input.bands);
        await this.audit.record(tx, access, {
          action: 'grading_scale.created',
          entity: 'grading_scale',
          entityId: row!.id,
          diff: input,
        });
        return { id: row!.id };
      } catch (err) {
        return rethrowConflicts(err, SCALE_CONFLICTS);
      }
    });
  }

  update(access: TenantAccess, id: string, input: GradingScaleUpdateInput) {
    this.assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { bands, ...fields } = input;
      const [row] = await tx
        .update(gs)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(gs.id, id))
        .returning({ id: gs.id });
      if (!row) throw notFound('Grading scale');
      if (bands) {
        await tx.delete(gb).where(eq(gb.scaleId, id));
        await this.insertBands(tx, access.tenantId, id, bands);
      }
      await this.audit.record(tx, access, {
        action: 'grading_scale.updated',
        entity: 'grading_scale',
        entityId: id,
        diff: input,
      });
      return { id };
    }).catch((err: unknown) => rethrowConflicts(err, SCALE_CONFLICTS));
  }

  remove(access: TenantAccess, id: string) {
    this.assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [row] = await tx.delete(gs).where(eq(gs.id, id)).returning({ name: gs.name });
      if (!row) throw notFound('Grading scale');
      await this.audit.record(tx, access, {
        action: 'grading_scale.deleted',
        entity: 'grading_scale',
        entityId: id,
        diff: { name: row.name },
      });
    }).catch((err: unknown) => rethrowConflicts(err, SCALE_CONFLICTS));
  }
}
