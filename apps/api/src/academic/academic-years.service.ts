import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type {
  AcademicYearCreateInput,
  AcademicYearUpdateInput,
  TermCreateInput,
  TermUpdateInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { assertCampus } from './campus-check.js';
import { rangesOverlap } from './working-days.js';

const y = schema.academicYears;
const t = schema.academicTerms;

export const yearColumns = {
  id: y.id,
  campusId: y.campusId,
  name: y.name,
  startsOn: y.startsOn,
  endsOn: y.endsOn,
  isCurrent: y.isCurrent,
  status: y.status,
  weeklyOffDays: y.weeklyOffDays,
  saturdayOffWeeks: y.saturdayOffWeeks,
  createdAt: y.createdAt,
  updatedAt: y.updatedAt,
};
const termColumns = {
  id: t.id,
  academicYearId: t.academicYearId,
  name: t.name,
  startsOn: t.startsOn,
  endsOn: t.endsOn,
};

export type YearRow = Awaited<ReturnType<AcademicYearsService['loadYear']>>;

const YEAR_CONFLICTS = {
  academic_years_tenant_campus_name_uq: 'This campus already has an academic year with that name',
  academic_years_one_current_uq: 'Another year is already current for this campus',
};

/** A closed year is read-only: its classes, sections and (later) marks and fees are locked. */
export const assertYearOpen = (year: { status: string; name: string }) => {
  if (year.status === 'closed') {
    throw new AppError(
      'CONFLICT',
      `Academic year ${year.name} is closed. Reopen it to make changes.`,
      {
        reason: 'year_closed',
      },
    );
  }
};

@Injectable()
export class AcademicYearsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /**
   * Loads a year and checks the caller holds `permission` for its campus. Years of
   * campuses outside the caller's scope are reported as not found.
   */
  async loadYear(tx: Transaction, access: TenantAccess, id: string, permission: string) {
    const [row] = await tx.select(yearColumns).from(y).where(eq(y.id, id));
    if (!row || !access.has(permission, row.campusId)) throw notFound('Academic year');
    return row;
  }

  private async assertNoOverlap(
    tx: Transaction,
    campusId: string,
    startsOn: string,
    endsOn: string,
    exceptId?: string,
  ) {
    const others = await tx
      .select({ name: y.name, startsOn: y.startsOn, endsOn: y.endsOn })
      .from(y)
      .where(
        exceptId ? and(eq(y.campusId, campusId), ne(y.id, exceptId)) : eq(y.campusId, campusId),
      );
    const clash = others.find((o) => rangesOverlap(startsOn, endsOn, o.startsOn, o.endsOn));
    if (clash) {
      throw new AppError('CONFLICT', `These dates overlap academic year ${clash.name}`, {
        reason: 'year_overlap',
      });
    }
  }

  list(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await assertCampus(tx, access, campusId, 'academic.view');
        return tx
          .select(yearColumns)
          .from(y)
          .where(eq(y.campusId, campusId))
          .orderBy(asc(y.startsOn));
      },
      { readOnly: true },
    );
  }

  create(access: TenantAccess, input: AcademicYearCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await assertCampus(tx, access, input.campusId, 'academic.manage');
      await this.lockCampusYears(tx, input.campusId);
      await this.assertNoOverlap(tx, input.campusId, input.startsOn, input.endsOn);
      try {
        const [row] = await tx
          .insert(y)
          .values({ tenantId: access.tenantId, ...input })
          .returning(yearColumns);
        await this.audit.record(tx, access, {
          action: 'academic_year.created',
          entity: 'academic_year',
          entityId: row!.id,
          campusId: row!.campusId,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, YEAR_CONFLICTS);
      }
    });
  }

  update(access: TenantAccess, id: string, input: AcademicYearUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const year = await this.loadYear(tx, access, id, 'academic.manage');
      assertYearOpen(year);
      const startsOn = input.startsOn ?? year.startsOn;
      const endsOn = input.endsOn ?? year.endsOn;
      if (endsOn <= startsOn) {
        throw new AppError('VALIDATION_FAILED', 'End date must be after the start date');
      }
      if (input.startsOn || input.endsOn) {
        await this.lockCampusYears(tx, year.campusId);
        await this.assertNoOverlap(tx, year.campusId, startsOn, endsOn, id);
        const terms = await tx.select(termColumns).from(t).where(eq(t.academicYearId, id));
        const outside = terms.find((x) => x.startsOn < startsOn || x.endsOn > endsOn);
        if (outside) {
          throw new AppError('CONFLICT', `Term ${outside.name} would fall outside the year`, {
            reason: 'term_outside_year',
          });
        }
      }
      try {
        const [row] = await tx
          .update(y)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(y.id, id))
          .returning(yearColumns);
        await this.audit.record(tx, access, {
          action: 'academic_year.updated',
          entity: 'academic_year',
          entityId: id,
          campusId: year.campusId,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, YEAR_CONFLICTS);
      }
    });
  }

  /** Makes this the campus's current year (the one new admissions and attendance use). */
  makeCurrent(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const year = await this.loadYear(tx, access, id, 'academic.manage');
      assertYearOpen(year);
      await this.lockCampusYears(tx, year.campusId);
      await tx
        .update(y)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(and(eq(y.campusId, year.campusId), eq(y.isCurrent, true)));
      const [row] = await tx
        .update(y)
        .set({ isCurrent: true, status: 'active', updatedAt: new Date() })
        .where(eq(y.id, id))
        .returning(yearColumns);
      await this.audit.record(tx, access, {
        action: 'academic_year.made_current',
        entity: 'academic_year',
        entityId: id,
        campusId: year.campusId,
      });
      return row!;
    });
  }

  /** Close (lock) or reopen a year. Reopening needs school-wide rights. */
  setStatus(access: TenantAccess, id: string, status: 'active' | 'closed') {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const year = await this.loadYear(tx, access, id, 'academic.manage');
      if (year.status === status) return year;
      if (status === 'active' && !access.hasTenantWide('academic.manage')) {
        throw new AppError('FORBIDDEN', 'Only school-wide administrators can reopen a closed year');
      }
      if (status === 'closed' && year.status === 'planned') {
        throw new AppError(
          'CONFLICT',
          'A year that never started cannot be closed; delete it instead',
          {
            reason: 'year_not_started',
          },
        );
      }
      const [row] = await tx
        .update(y)
        .set({
          status,
          isCurrent: status === 'closed' ? false : year.isCurrent,
          updatedAt: new Date(),
        })
        .where(eq(y.id, id))
        .returning(yearColumns);
      await this.audit.record(tx, access, {
        action: status === 'closed' ? 'academic_year.closed' : 'academic_year.reopened',
        entity: 'academic_year',
        entityId: id,
        campusId: year.campusId,
      });
      return row!;
    });
  }

  /** Only planned years with no sections can be deleted. */
  remove(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const year = await this.loadYear(tx, access, id, 'academic.manage');
      if (year.status !== 'planned') {
        throw new AppError('CONFLICT', 'Only a year that has not started can be deleted', {
          reason: 'year_in_use',
        });
      }
      const [section] = await tx
        .select({ id: schema.sections.id })
        .from(schema.sections)
        .where(eq(schema.sections.academicYearId, id))
        .limit(1);
      if (section) {
        throw new AppError('CONFLICT', 'Remove the sections of this year first', {
          reason: 'year_has_sections',
        });
      }
      await tx.delete(y).where(eq(y.id, id));
      await this.audit.record(tx, access, {
        action: 'academic_year.deleted',
        entity: 'academic_year',
        entityId: id,
        campusId: year.campusId,
        diff: { name: year.name },
      });
    });
  }

  /* ------------------------------------- terms ------------------------------------- */

  listTerms(access: TenantAccess, yearId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.loadYear(tx, access, yearId, 'academic.view');
        return tx
          .select(termColumns)
          .from(t)
          .where(eq(t.academicYearId, yearId))
          .orderBy(asc(t.startsOn));
      },
      { readOnly: true },
    );
  }

  private async checkTermDates(
    tx: Transaction,
    year: YearRow,
    name: string,
    startsOn: string,
    endsOn: string,
    exceptId?: string,
  ) {
    if (startsOn < year.startsOn || endsOn > year.endsOn) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${name} must fall within ${year.name} (${year.startsOn} to ${year.endsOn})`,
        { reason: 'term_outside_year' },
      );
    }
    const others = await tx.select(termColumns).from(t).where(eq(t.academicYearId, year.id));
    const clash = others.find(
      (o) => o.id !== exceptId && rangesOverlap(startsOn, endsOn, o.startsOn, o.endsOn),
    );
    if (clash) {
      throw new AppError('CONFLICT', `${name} overlaps ${clash.name}`, { reason: 'term_overlap' });
    }
  }

  createTerm(access: TenantAccess, yearId: string, input: TermCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const year = await this.loadYear(tx, access, yearId, 'academic.manage');
      assertYearOpen(year);
      await this.lockCampusYears(tx, year.campusId);
      await this.checkTermDates(tx, year, input.name, input.startsOn, input.endsOn);
      try {
        const [row] = await tx
          .insert(t)
          .values({ tenantId: access.tenantId, academicYearId: yearId, ...input })
          .returning(termColumns);
        await this.audit.record(tx, access, {
          action: 'term.created',
          entity: 'academic_term',
          entityId: row!.id,
          campusId: year.campusId,
          diff: { year: year.name, ...input },
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          academic_terms_year_name_uq: 'This year already has a term with that name',
        });
      }
    });
  }

  private async loadTerm(tx: Transaction, access: TenantAccess, id: string) {
    const [term] = await tx.select(termColumns).from(t).where(eq(t.id, id));
    if (!term) throw notFound('Term');
    const year = await this.loadYear(tx, access, term.academicYearId, 'academic.manage').catch(
      () => {
        throw notFound('Term');
      },
    );
    return { term, year };
  }

  updateTerm(access: TenantAccess, id: string, input: TermUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { term, year } = await this.loadTerm(tx, access, id);
      assertYearOpen(year);
      await this.lockCampusYears(tx, year.campusId);
      const startsOn = input.startsOn ?? term.startsOn;
      const endsOn = input.endsOn ?? term.endsOn;
      if (endsOn < startsOn) {
        throw new AppError('VALIDATION_FAILED', 'End date must be on or after the start date');
      }
      await this.checkTermDates(tx, year, input.name ?? term.name, startsOn, endsOn, id);
      try {
        const [row] = await tx
          .update(t)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(t.id, id))
          .returning(termColumns);
        await this.audit.record(tx, access, {
          action: 'term.updated',
          entity: 'academic_term',
          entityId: id,
          campusId: year.campusId,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          academic_terms_year_name_uq: 'This year already has a term with that name',
        });
      }
    });
  }

  removeTerm(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { term, year } = await this.loadTerm(tx, access, id);
      assertYearOpen(year);
      await tx.delete(t).where(eq(t.id, id));
      await this.audit.record(tx, access, {
        action: 'term.deleted',
        entity: 'academic_term',
        entityId: id,
        campusId: year.campusId,
        diff: { name: term.name },
      });
    });
  }

  /**
   * Serialises date checks per campus so two concurrent requests cannot both pass the
   * overlap check. Transaction-scoped advisory lock keyed by campus id.
   */
  private async lockCampusYears(tx: Transaction, campusId: string) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'academic_years:' + campusId}, 0))`,
    );
  }
}
