import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { APPLICATION_TRANSITIONS, formatAdmissionNumber } from '@school-erp/validation';
import type {
  ApplicationAdmitInput,
  ApplicationCreateInput,
  ApplicationListQuery,
  ApplicationStatus,
  ApplicationTransitionInput,
  ApplicationUpdateInput,
  GuardianInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { StudentsService } from '../students/students.service.js';
import { assertCampus } from '../academic/campus-check.js';

const ap = schema.admissionApplications;
const ev = schema.applicationEvents;
const yr = schema.academicYears;
const gl = schema.gradeLevels;

const FINAL: readonly string[] = ['withdrawn', 'admitted'];

const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');
const decodeCursor = (cursor: string): string => {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  return id;
};

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
  ) {}

  /** Campus filter for what the caller may see (null = all, false = nothing). */
  private scope(access: TenantAccess, permission: string): SQL | null | false {
    const s = access.scopeOf(permission);
    if (s === null) return null;
    if (!s.size) return false;
    return inArray(ap.campusId, [...s]);
  }

  async load(tx: Transaction, access: TenantAccess, id: string, permission: string) {
    const [row] = await tx.select().from(ap).where(eq(ap.id, id));
    if (!row || !access.has(permission, row.campusId)) throw notFound('Application');
    return row;
  }

  private async event(
    tx: Transaction,
    access: TenantAccess,
    applicationId: string,
    from: string | null,
    to: string,
    note = '',
  ) {
    await tx.insert(ev).values({
      tenantId: access.tenantId,
      applicationId,
      fromStatus: from,
      toStatus: to,
      note,
      actorUserId: access.userId,
    });
  }

  /* ------------------------------------- create ------------------------------------- */

  create(access: TenantAccess, input: ApplicationCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await assertCampus(tx, access, input.campusId, 'admissions.manage');
      const [ctx] = await tx
        .select({
          yearStatus: yr.status,
          startsOn: yr.startsOn,
          classStatus: gl.status,
          campusCode: schema.campuses.code,
        })
        .from(yr)
        .innerJoin(gl, and(eq(gl.tenantId, yr.tenantId), eq(gl.campusId, yr.campusId)))
        .innerJoin(
          schema.campuses,
          and(eq(schema.campuses.tenantId, yr.tenantId), eq(schema.campuses.id, yr.campusId)),
        )
        .where(
          and(
            eq(yr.id, input.academicYearId),
            eq(gl.id, input.gradeLevelId),
            eq(yr.campusId, input.campusId),
          ),
        );
      if (!ctx) throw notFound('Class or academic year');
      if (ctx.yearStatus === 'closed') {
        throw new AppError('CONFLICT', 'This academic year is closed', { reason: 'year_closed' });
      }
      if (ctx.classStatus !== 'active')
        throw new AppError('VALIDATION_FAILED', 'This class is archived');

      let source = input.source ?? 'walk_in';
      if (input.inquiryId) {
        const [inq] = await tx
          .select({
            source: schema.admissionInquiries.source,
            campusId: schema.admissionInquiries.campusId,
          })
          .from(schema.admissionInquiries)
          .where(eq(schema.admissionInquiries.id, input.inquiryId));
        if (!inq || (inq.campusId && !access.has('admissions.view', inq.campusId)))
          throw notFound('Inquiry');
        source = input.source ?? (inq.source as typeof source);
      }

      const year = Number(ctx.startsOn.slice(0, 4));
      const counter = await tx.execute<{ last_value: number }>(sql`
        insert into number_counters (tenant_id, counter_key, last_value)
        values (${access.tenantId}, ${`application:${year}`}, 1)
        on conflict (tenant_id, counter_key) do update set last_value = number_counters.last_value + 1
        returning last_value`);
      const applicationNumber = formatAdmissionNumber(
        'APP/{YYYY}/{SEQ:4}',
        counter.rows[0]!.last_value,
        {
          year,
          campusCode: ctx.campusCode,
        },
      );

      const { inquiryId, source: _s, ...fields } = input;
      const [row] = await tx
        .insert(ap)
        .values({
          tenantId: access.tenantId,
          ...fields,
          inquiryId,
          source,
          applicationNumber,
          createdBy: access.userId,
        })
        .returning({ id: ap.id, applicationNumber: ap.applicationNumber });
      await this.event(tx, access, row!.id, null, 'submitted');
      if (inquiryId) {
        await tx
          .update(schema.admissionInquiries)
          .set({ status: 'contacted', updatedAt: new Date() })
          .where(
            and(
              eq(schema.admissionInquiries.id, inquiryId),
              eq(schema.admissionInquiries.status, 'new'),
            ),
          );
      }
      await this.audit.record(tx, access, {
        action: 'application.created',
        entity: 'admission_application',
        entityId: row!.id,
        campusId: input.campusId,
        diff: { applicationNumber, source, inquiryId },
      });
      return row!;
    });
  }

  /* -------------------------------------- reads -------------------------------------- */

  list(access: TenantAccess, q: ApplicationListQuery) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const scope = this.scope(access, 'admissions.view');
        if (scope === false) return { data: [], nextCursor: null };
        const f: SQL[] = scope ? [scope] : [];
        if (q.campusId) f.push(eq(ap.campusId, q.campusId));
        if (q.academicYearId) f.push(eq(ap.academicYearId, q.academicYearId));
        if (q.gradeLevelId) f.push(eq(ap.gradeLevelId, q.gradeLevelId));
        if (q.status) f.push(eq(ap.status, q.status));
        if (q.q) {
          const term = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          const digits = q.q.replace(/\D/g, '');
          f.push(
            sql`(${ap.firstName} ilike ${term} or ${ap.lastName} ilike ${term} or ${ap.applicationNumber} ilike ${term}
              or ${ap.guardianName} ilike ${term}
              ${digits.length >= 4 ? sql`or ${ap.guardianPhone} like ${`%${digits}%`}` : sql``})`,
          );
        }
        if (q.cursor) f.push(sql`${ap.id} < ${decodeCursor(q.cursor)}`);
        const rows = await tx
          .select({
            id: ap.id,
            applicationNumber: ap.applicationNumber,
            firstName: ap.firstName,
            lastName: ap.lastName,
            dateOfBirth: ap.dateOfBirth,
            className: gl.name,
            yearName: yr.name,
            campusId: ap.campusId,
            guardianName: ap.guardianName,
            guardianPhone: ap.guardianPhone,
            source: ap.source,
            status: ap.status,
            assessmentAt: ap.assessmentAt,
            studentId: ap.studentId,
            createdAt: ap.createdAt,
          })
          .from(ap)
          .innerJoin(gl, and(eq(gl.tenantId, ap.tenantId), eq(gl.id, ap.gradeLevelId)))
          .innerJoin(yr, and(eq(yr.tenantId, ap.tenantId), eq(yr.id, ap.academicYearId)))
          .where(f.length ? and(...f) : undefined)
          .orderBy(desc(ap.id))
          .limit(q.limit + 1);
        const page = rows.slice(0, q.limit);
        const last = page.at(-1);
        return {
          data: page,
          nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null,
        };
      },
      { readOnly: true },
    );
  }

  get(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const a = await this.load(tx, access, id, 'admissions.view');
        const [names] = await tx
          .select({ className: gl.name, yearName: yr.name, yearStatus: yr.status })
          .from(gl)
          .innerJoin(yr, and(eq(yr.tenantId, gl.tenantId), eq(yr.id, a.academicYearId)))
          .where(eq(gl.id, a.gradeLevelId));
        const events = await tx
          .select({
            id: ev.id,
            fromStatus: ev.fromStatus,
            toStatus: ev.toStatus,
            note: ev.note,
            actorName: schema.users.fullName,
            createdAt: ev.createdAt,
          })
          .from(ev)
          .leftJoin(schema.users, eq(schema.users.id, ev.actorUserId))
          .where(eq(ev.applicationId, id))
          .orderBy(asc(ev.createdAt), asc(ev.id));
        let admissionNumber: string | null = null;
        if (a.studentId) {
          const [s] = await tx
            .select({ n: schema.students.admissionNumber })
            .from(schema.students)
            .where(eq(schema.students.id, a.studentId));
          admissionNumber = s?.n ?? null;
        }
        return {
          ...a,
          ...names,
          admissionNumber,
          events,
          nextStatuses: access.has('admissions.manage', a.campusId)
            ? APPLICATION_TRANSITIONS[a.status as ApplicationStatus]
            : [],
          permissions: {
            manage: access.has('admissions.manage', a.campusId),
            admit:
              access.has('admissions.manage', a.campusId) &&
              access.has('students.manage', a.campusId),
          },
        };
      },
      { readOnly: true },
    );
  }

  /** Counts by status, class and source for one campus and year (ADM-05). */
  summary(access: TenantAccess, campusId: string, academicYearId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await assertCampus(tx, access, campusId, 'admissions.view');
        const where = and(eq(ap.campusId, campusId), eq(ap.academicYearId, academicYearId));
        const byStatus = await tx
          .select({ status: ap.status, n: sql<number>`count(*)::int` })
          .from(ap)
          .where(where)
          .groupBy(ap.status);
        const bySource = await tx
          .select({ source: ap.source, n: sql<number>`count(*)::int` })
          .from(ap)
          .where(where)
          .groupBy(ap.source);
        const byClass = await tx
          .select({
            gradeLevelId: ap.gradeLevelId,
            className: gl.name,
            sortOrder: gl.sortOrder,
            total: sql<number>`count(*)::int`,
            admitted: sql<number>`count(*) filter (where ${ap.status} = 'admitted')::int`,
            pending: sql<number>`count(*) filter (where ${ap.status} in ('submitted','under_review','assessment','approved','waitlisted'))::int`,
          })
          .from(ap)
          .innerJoin(gl, and(eq(gl.tenantId, ap.tenantId), eq(gl.id, ap.gradeLevelId)))
          .where(where)
          .groupBy(ap.gradeLevelId, gl.name, gl.sortOrder)
          .orderBy(asc(gl.sortOrder));
        return {
          byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
          bySource: Object.fromEntries(bySource.map((r) => [r.source, r.n])),
          byClass: byClass.map(({ sortOrder: _o, ...r }) => r),
        };
      },
      { readOnly: true },
    );
  }

  /* ------------------------------------- changes ------------------------------------- */

  update(access: TenantAccess, id: string, input: ApplicationUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const a = await this.load(tx, access, id, 'admissions.manage');
      if (FINAL.includes(a.status)) {
        throw new AppError('CONFLICT', 'This application is closed', {
          reason: 'application_closed',
        });
      }
      await tx
        .update(ap)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(ap.id, id));
      await this.audit.record(tx, access, {
        action: 'application.updated',
        entity: 'admission_application',
        entityId: id,
        campusId: a.campusId,
        diff: input,
      });
    });
  }

  transition(access: TenantAccess, id: string, input: ApplicationTransitionInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      // Lock the row so two people cannot move it at the same time.
      const [locked] = await tx.select({ id: ap.id }).from(ap).where(eq(ap.id, id)).for('update');
      if (!locked) throw notFound('Application');
      const a = await this.load(tx, access, id, 'admissions.manage');
      const allowed = APPLICATION_TRANSITIONS[a.status as ApplicationStatus];
      if (!allowed.includes(input.status)) {
        throw new AppError(
          'CONFLICT',
          `An application that is ${a.status.replace('_', ' ')} cannot be moved to ${input.status.replace('_', ' ')}`,
          {
            reason: 'invalid_transition',
            from: a.status,
            to: input.status,
          },
        );
      }
      await tx
        .update(ap)
        .set({
          status: input.status,
          ...(input.status === 'assessment' ? { assessmentAt: new Date(input.assessmentAt!) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(ap.id, id));
      await this.event(tx, access, id, a.status, input.status, input.note);
      await this.audit.record(tx, access, {
        action: 'application.status_changed',
        entity: 'admission_application',
        entityId: id,
        campusId: a.campusId,
        diff: { from: a.status, to: input.status, note: input.note },
      });
      return { status: input.status };
    });
  }

  /** Approved application → student record, enrollment, guardians; documents move along. */
  admit(access: TenantAccess, id: string, input: ApplicationAdmitInput) {
    if (!access.has('students.manage')) {
      throw new AppError('FORBIDDEN', 'You need permission to admit students');
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.select({ id: ap.id }).from(ap).where(eq(ap.id, id)).for('update');
      const a = await this.load(tx, access, id, 'admissions.manage');
      if (a.status !== 'approved') {
        throw new AppError('CONFLICT', 'Only approved applications can be admitted', {
          reason: 'not_approved',
        });
      }
      const primary: GuardianInput = input.existingGuardianId
        ? {
            guardianId: input.existingGuardianId,
            relationship: a.guardianRelationship as never,
            isPrimary: true,
            isFeePayer: true,
          }
        : {
            fullName: a.guardianName,
            phone: a.guardianPhone,
            email: a.guardianEmail,
            occupation: null,
            relationship: a.guardianRelationship as never,
            isPrimary: true,
            isFeePayer: true,
          };
      const result = await this.students.admitInTx(
        tx,
        access,
        {
          firstName: a.firstName,
          lastName: a.lastName,
          nameLocal: null,
          dateOfBirth: a.dateOfBirth,
          gender: a.gender as never,
          bloodGroup: null,
          address: null,
          pen: null,
          apaarId: null,
          aadhaar: input.aadhaar,
          admissionDate: input.admissionDate,
          sectionId: input.sectionId,
          rollNumber: input.rollNumber,
          guardians: [
            primary,
            ...input.additionalGuardians.map((g) => ({ ...g, isPrimary: false })),
          ],
          privacyNotice: input.privacyNotice,
          customFields: {},
        },
        { requireCustomFields: false },
      );
      if (result.sectionCampusId !== a.campusId || result.academicYearId !== a.academicYearId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Choose a section of the campus and year applied for',
        );
      }
      try {
        await tx
          .update(ap)
          .set({ status: 'admitted', studentId: result.id, updatedAt: new Date() })
          .where(eq(ap.id, id));
      } catch (err) {
        return rethrowConflicts(err, {});
      }
      await tx
        .update(schema.documents)
        .set({ studentId: result.id })
        .where(eq(schema.documents.applicationId, id));
      if (a.inquiryId) {
        await tx
          .update(schema.admissionInquiries)
          .set({ status: 'closed', updatedAt: new Date() })
          .where(eq(schema.admissionInquiries.id, a.inquiryId));
      }
      await this.event(
        tx,
        access,
        id,
        a.status,
        'admitted',
        `Admission no. ${result.admissionNumber}`,
      );
      await this.audit.record(tx, access, {
        action: 'application.admitted',
        entity: 'admission_application',
        entityId: id,
        campusId: a.campusId,
        diff: { studentId: result.id, admissionNumber: result.admissionNumber },
      });
      return {
        studentId: result.id,
        admissionNumber: result.admissionNumber,
        rollNumber: result.rollNumber,
      };
    });
  }
}
