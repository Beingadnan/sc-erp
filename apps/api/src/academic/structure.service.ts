import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type {
  ClassSubjectsInput,
  GradeLevelCreateInput,
  GradeLevelUpdateInput,
  SectionCreateInput,
  SectionUpdateInput,
  SubjectCreateInput,
  SubjectUpdateInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { pgErrorOf, rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { AcademicYearsService, assertYearOpen } from './academic-years.service.js';
import { assertCampus } from './campus-check.js';

const g = schema.gradeLevels;
const s = schema.sections;
const sub = schema.subjects;
const cs = schema.classSubjects;
const m = schema.tenantMemberships;

const classColumns = {
  id: g.id,
  campusId: g.campusId,
  code: g.code,
  name: g.name,
  stage: g.stage,
  sortOrder: g.sortOrder,
  gradingScaleId: g.gradingScaleId,
  status: g.status,
};
const sectionColumns = {
  id: s.id,
  campusId: s.campusId,
  academicYearId: s.academicYearId,
  gradeLevelId: s.gradeLevelId,
  name: s.name,
  capacity: s.capacity,
  room: s.room,
  classTeacherMembershipId: s.classTeacherMembershipId,
};
const subjectColumns = {
  id: sub.id,
  code: sub.code,
  name: sub.name,
  kind: sub.kind,
  status: sub.status,
};

const CLASS_CONFLICTS = {
  grade_levels_campus_code_uq: 'This campus already has a class with that code',
  grade_levels_campus_name_uq: 'This campus already has a class with that name',
};
const SECTION_CONFLICTS = {
  sections_year_class_name_uq: 'This class already has a section with that name this year',
};
const SUBJECT_CONFLICTS = { subjects_tenant_code_uq: 'A subject with this code already exists' };

@Injectable()
export class StructureService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly years: AcademicYearsService,
  ) {}

  /* ------------------------------------ classes ------------------------------------ */

  async loadClass(tx: Transaction, access: TenantAccess, id: string, permission: string) {
    const [row] = await tx.select(classColumns).from(g).where(eq(g.id, id));
    if (!row || !access.has(permission, row.campusId)) throw notFound('Class');
    return row;
  }

  listClasses(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await assertCampus(tx, access, campusId, 'academic.view');
        return tx
          .select(classColumns)
          .from(g)
          .where(eq(g.campusId, campusId))
          .orderBy(asc(g.sortOrder), asc(g.name));
      },
      { readOnly: true },
    );
  }

  createClass(access: TenantAccess, input: GradeLevelCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await assertCampus(tx, access, input.campusId, 'academic.manage');
      try {
        const [row] = await tx
          .insert(g)
          .values({ tenantId: access.tenantId, ...input })
          .returning(classColumns);
        await this.audit.record(tx, access, {
          action: 'class.created',
          entity: 'grade_level',
          entityId: row!.id,
          campusId: row!.campusId,
          diff: input,
        });
        return row!;
      } catch (err) {
        if (pgErrorOf(err)?.constraint === 'grade_levels_scale_fk') throw notFound('Grading scale');
        return rethrowConflicts(err, CLASS_CONFLICTS);
      }
    });
  }

  updateClass(access: TenantAccess, id: string, input: GradeLevelUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const cls = await this.loadClass(tx, access, id, 'academic.manage');
      try {
        const [row] = await tx
          .update(g)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(g.id, id))
          .returning(classColumns);
        await this.audit.record(tx, access, {
          action: 'class.updated',
          entity: 'grade_level',
          entityId: id,
          campusId: cls.campusId,
          diff: input,
        });
        return row!;
      } catch (err) {
        if (pgErrorOf(err)?.constraint === 'grade_levels_scale_fk') throw notFound('Grading scale');
        return rethrowConflicts(err, CLASS_CONFLICTS);
      }
    });
  }

  listClassSubjects(access: TenantAccess, classId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.loadClass(tx, access, classId, 'academic.view');
        return tx
          .select({
            subjectId: sub.id,
            code: sub.code,
            name: sub.name,
            kind: sub.kind,
            isOptional: cs.isOptional,
          })
          .from(cs)
          .innerJoin(sub, and(eq(sub.tenantId, cs.tenantId), eq(sub.id, cs.subjectId)))
          .where(eq(cs.gradeLevelId, classId))
          .orderBy(asc(cs.sortOrder));
      },
      { readOnly: true },
    );
  }

  /** Replaces the subject list of a class (order = order given). */
  setClassSubjects(access: TenantAccess, classId: string, input: ClassSubjectsInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const cls = await this.loadClass(tx, access, classId, 'academic.manage');
      const ids = input.subjects.map((x) => x.subjectId);
      if (ids.length) {
        const found = await tx
          .select({ id: sub.id, status: sub.status })
          .from(sub)
          .where(inArray(sub.id, ids));
        if (found.length !== ids.length) throw notFound('Subject');
        if (found.some((f) => f.status !== 'active')) {
          throw new AppError('VALIDATION_FAILED', 'Archived subjects cannot be added to a class');
        }
      }
      await tx.delete(cs).where(eq(cs.gradeLevelId, classId));
      if (ids.length) {
        await tx.insert(cs).values(
          input.subjects.map((x, i) => ({
            tenantId: access.tenantId,
            gradeLevelId: classId,
            subjectId: x.subjectId,
            isOptional: x.isOptional,
            sortOrder: i,
          })),
        );
      }
      await this.audit.record(tx, access, {
        action: 'class.subjects_set',
        entity: 'grade_level',
        entityId: classId,
        campusId: cls.campusId,
        diff: { subjects: input.subjects },
      });
      return { count: ids.length };
    });
  }

  /* ----------------------------------- sections ------------------------------------ */

  listSections(access: TenantAccess, academicYearId: string, gradeLevelId?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.years.loadYear(tx, access, academicYearId, 'academic.view');
        return tx
          .select({ ...sectionColumns, classTeacherName: schema.users.fullName })
          .from(s)
          .leftJoin(m, and(eq(m.tenantId, s.tenantId), eq(m.id, s.classTeacherMembershipId)))
          .leftJoin(schema.users, eq(schema.users.id, m.userId))
          .where(
            gradeLevelId
              ? and(eq(s.academicYearId, academicYearId), eq(s.gradeLevelId, gradeLevelId))
              : eq(s.academicYearId, academicYearId),
          )
          .orderBy(asc(s.name));
      },
      { readOnly: true },
    );
  }

  private async assertClassTeacher(tx: Transaction, membershipId: string | null | undefined) {
    if (!membershipId) return;
    const [row] = await tx.select({ status: m.status }).from(m).where(eq(m.id, membershipId));
    if (!row) throw notFound('Staff member');
    // Invited staff may be named before they first sign in (schools fill the chart first).
    if (row.status === 'suspended') {
      throw new AppError('VALIDATION_FAILED', 'The class teacher must be a current staff member');
    }
  }

  createSection(access: TenantAccess, input: SectionCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const year = await this.years.loadYear(tx, access, input.academicYearId, 'academic.manage');
      assertYearOpen(year);
      const cls = await this.loadClass(tx, access, input.gradeLevelId, 'academic.manage');
      if (cls.campusId !== year.campusId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'The class and the academic year belong to different campuses',
        );
      }
      if (cls.status !== 'active') {
        throw new AppError('VALIDATION_FAILED', 'Sections cannot be added to an archived class');
      }
      await this.assertClassTeacher(tx, input.classTeacherMembershipId);
      try {
        const [row] = await tx
          .insert(s)
          .values({ tenantId: access.tenantId, campusId: year.campusId, ...input })
          .returning(sectionColumns);
        await this.audit.record(tx, access, {
          action: 'section.created',
          entity: 'section',
          entityId: row!.id,
          campusId: year.campusId,
          diff: { year: year.name, class: cls.name, ...input },
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, SECTION_CONFLICTS);
      }
    });
  }

  private async loadSection(tx: Transaction, access: TenantAccess, id: string) {
    const [row] = await tx.select(sectionColumns).from(s).where(eq(s.id, id));
    if (!row || !access.has('academic.manage', row.campusId)) throw notFound('Section');
    const year = await this.years.loadYear(tx, access, row.academicYearId, 'academic.manage');
    assertYearOpen(year);
    return row;
  }

  updateSection(access: TenantAccess, id: string, input: SectionUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const section = await this.loadSection(tx, access, id);
      await this.assertClassTeacher(tx, input.classTeacherMembershipId);
      try {
        const [row] = await tx
          .update(s)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(s.id, id))
          .returning(sectionColumns);
        await this.audit.record(tx, access, {
          action: 'section.updated',
          entity: 'section',
          entityId: id,
          campusId: section.campusId,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, SECTION_CONFLICTS);
      }
    });
  }

  removeSection(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const section = await this.loadSection(tx, access, id);
      try {
        await tx.delete(s).where(eq(s.id, id));
      } catch (err) {
        // Phase 4+: enrollments reference sections and block deletion.
        return rethrowConflicts(err, {});
      }
      await this.audit.record(tx, access, {
        action: 'section.deleted',
        entity: 'section',
        entityId: id,
        campusId: section.campusId,
        diff: { name: section.name },
      });
    });
  }

  /* ----------------------------------- subjects ------------------------------------ */

  listSubjects(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      (tx) => tx.select(subjectColumns).from(sub).orderBy(asc(sub.kind), asc(sub.name)),
      { readOnly: true },
    );
  }

  private assertTenantWide(access: TenantAccess, what: string) {
    if (!access.hasTenantWide('academic.manage')) {
      throw new AppError('FORBIDDEN', `Only school-wide academic staff can change ${what}`);
    }
  }

  createSubject(access: TenantAccess, input: SubjectCreateInput) {
    this.assertTenantWide(access, 'subjects');
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      try {
        const [row] = await tx
          .insert(sub)
          .values({ tenantId: access.tenantId, ...input })
          .returning(subjectColumns);
        await this.audit.record(tx, access, {
          action: 'subject.created',
          entity: 'subject',
          entityId: row!.id,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, SUBJECT_CONFLICTS);
      }
    });
  }

  updateSubject(access: TenantAccess, id: string, input: SubjectUpdateInput) {
    this.assertTenantWide(access, 'subjects');
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [row] = await tx
        .update(sub)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(sub.id, id))
        .returning(subjectColumns);
      if (!row) throw notFound('Subject');
      await this.audit.record(tx, access, {
        action: 'subject.updated',
        entity: 'subject',
        entityId: id,
        diff: input,
      });
      return row;
    });
  }
}
