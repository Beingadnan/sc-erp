import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { StructureTemplateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { GradingService } from './grading.service.js';
import {
  OPTIONAL_SUBJECTS,
  STAGE_SUBJECTS,
  TEMPLATE_SUBJECTS,
  scaleKeyFor,
  templateClasses,
  templateScales,
} from './templates.js';

@Injectable()
export class AcademicSetupService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly grading: GradingService,
  ) {}

  /**
   * Adds the starter classes, subjects, grading scales and class–subject lists for a
   * campus. Idempotent: anything that already exists (same code / name) is left alone,
   * and classes that already have subjects or a scale keep them.
   */
  applyTemplate(access: TenantAccess, input: StructureTemplateInput) {
    if (!access.hasTenantWide('academic.manage')) {
      throw new AppError(
        'FORBIDDEN',
        'Only school-wide academic staff can apply a starter structure (it adds shared subjects and grading scales)',
      );
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [campus] = await tx
        .select({ id: schema.campuses.id, status: schema.campuses.status })
        .from(schema.campuses)
        .where(eq(schema.campuses.id, input.campusId));
      if (!campus) throw notFound('Campus');
      if (campus.status !== 'active') {
        throw new AppError('VALIDATION_FAILED', 'Restore the campus before setting up its classes');
      }

      // Subjects (tenant-wide).
      const subjects = await tx
        .insert(schema.subjects)
        .values(TEMPLATE_SUBJECTS.map((s) => ({ tenantId: access.tenantId, ...s })))
        .onConflictDoNothing()
        .returning({ id: schema.subjects.id });
      const subjectIds = new Map(
        (
          await tx
            .select({ id: schema.subjects.id, code: schema.subjects.code })
            .from(schema.subjects)
            .where(
              inArray(
                schema.subjects.code,
                TEMPLATE_SUBJECTS.map((s) => s.code),
              ),
            )
        ).map((s) => [s.code, s.id]),
      );

      // Grading scales (tenant-wide), matched by name.
      const scaleIds = new Map<string, string>();
      let scalesCreated = 0;
      for (const scale of templateScales(input.board)) {
        const [existing] = await tx
          .select({ id: schema.gradingScales.id })
          .from(schema.gradingScales)
          .where(eq(schema.gradingScales.name, scale.name));
        if (existing) {
          scaleIds.set(scale.key, existing.id);
          continue;
        }
        const [row] = await tx
          .insert(schema.gradingScales)
          .values({ tenantId: access.tenantId, name: scale.name, description: scale.description })
          .returning({ id: schema.gradingScales.id });
        await this.grading.insertBands(tx, access.tenantId, row!.id, scale.bands);
        scaleIds.set(scale.key, row!.id);
        scalesCreated++;
      }

      // Classes for the campus.
      const wanted = templateClasses(input.includePrePrimary, input.highestClass);
      const createdClasses = await tx
        .insert(schema.gradeLevels)
        .values(
          wanted.map((c) => ({
            tenantId: access.tenantId,
            campusId: input.campusId,
            ...c,
            gradingScaleId: scaleIds.get(scaleKeyFor(c.stage)) ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.gradeLevels.id, stage: schema.gradeLevels.stage });

      // Subject lists, only for the classes created now.
      let mappings = 0;
      const rows = createdClasses.flatMap((cls) =>
        STAGE_SUBJECTS[cls.stage as keyof typeof STAGE_SUBJECTS].flatMap((code, i) => {
          const subjectId = subjectIds.get(code);
          return subjectId
            ? [
                {
                  tenantId: access.tenantId,
                  gradeLevelId: cls.id,
                  subjectId,
                  isOptional: OPTIONAL_SUBJECTS.has(code),
                  sortOrder: i,
                },
              ]
            : [];
        }),
      );
      if (rows.length) {
        const inserted = await tx
          .insert(schema.classSubjects)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: schema.classSubjects.id });
        mappings = inserted.length;
      }

      const result = {
        classesCreated: createdClasses.length,
        classesSkipped: wanted.length - createdClasses.length,
        subjectsCreated: subjects.length,
        gradingScalesCreated: scalesCreated,
        classSubjectsCreated: mappings,
      };
      await this.audit.record(tx, access, {
        action: 'academic.template_applied',
        entity: 'campus',
        entityId: input.campusId,
        campusId: input.campusId,
        diff: { ...input, ...result },
      });
      return result;
    });
  }
}
