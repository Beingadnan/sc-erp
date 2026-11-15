import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { maskAadhaar } from '@school-erp/validation';
import type {
  EnrollmentUpdateInput,
  GuardianInput,
  GuardianUpdateInput,
  StudentAdmitInput,
  StudentListQuery,
  StudentUpdateInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { AdmissionNumbersService } from './admission-numbers.service.js';
import { PiiVault } from './pii-vault.js';
import { CustomFieldsService } from '../records/custom-fields.service.js';

const st = schema.students;
const g = schema.guardians;
const sg = schema.studentGuardians;
const en = schema.studentEnrollments;
const sec = schema.sections;
const yr = schema.academicYears;
const gl = schema.gradeLevels;

const STUDENT_CONFLICTS = {
  students_tenant_pen_uq: 'Another student already has this PEN',
  students_tenant_apaar_uq: 'Another student already has this APAAR ID',
  students_tenant_aadhaar_uq: 'Another student already has this Aadhaar number',
  student_enrollments_roll_uq: 'This roll number is already used in the section',
  student_enrollments_student_year_uq: 'The student is already enrolled in this academic year',
  students_tenant_admission_no_uq: 'This admission number is already used',
};

const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');
const decodeCursor = (cursor: string): string => {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  return id;
};

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class StudentsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly numbers: AdmissionNumbersService,
    private readonly vault: PiiVault,
    private readonly customFields: CustomFieldsService,
  ) {}

  /* ------------------------------------ visibility ------------------------------------ */

  /**
   * Which students the caller may see, as a condition on `students`:
   *  - students.view for a campus → every student of that campus;
   *  - students.view_assigned → students actively enrolled in a section where the caller is
   *    the class teacher.
   * Returns null for "everything" and false for "nothing".
   */
  private visibility(access: TenantAccess): SQL | null | false {
    const parts: SQL[] = [];
    if (access.has('students.view')) {
      const scope = access.scopeOf('students.view');
      if (scope === null) return null;
      if (scope.size) parts.push(inArray(st.campusId, [...scope]));
    }
    if (access.has('students.view_assigned')) {
      parts.push(sql`exists (
        select 1 from student_enrollments e
        join sections s on s.tenant_id = e.tenant_id and s.id = e.section_id
        where e.tenant_id = ${st.tenantId} and e.student_id = ${st.id} and e.status = 'active'
          and s.class_teacher_membership_id = ${access.membershipId})`);
    }
    if (!parts.length) return false;
    return parts.length === 1 ? parts[0]! : sql`(${sql.join(parts, sql` or `)})`;
  }

  private async loadVisible(tx: Transaction, access: TenantAccess, id: string) {
    const vis = this.visibility(access);
    if (vis === false) throw notFound('Student');
    const [row] = await tx
      .select()
      .from(st)
      .where(vis ? and(eq(st.id, id), vis) : eq(st.id, id));
    if (!row) throw notFound('Student');
    return row;
  }

  /** Student the caller may change (students.manage for the student's campus). */
  private async loadManaged(tx: Transaction, access: TenantAccess, id: string) {
    const [row] = await tx.select().from(st).where(eq(st.id, id));
    if (!row || !access.has('students.manage', row.campusId)) throw notFound('Student');
    return row;
  }

  /** For other modules (documents): a student the caller may see / change, else 404. */
  visibleStudent(tx: Transaction, access: TenantAccess, id: string) {
    return this.loadVisible(tx, access, id);
  }
  managedStudent(tx: Transaction, access: TenantAccess, id: string) {
    return this.loadManaged(tx, access, id);
  }

  /* ---------------------------------- shared helpers ---------------------------------- */

  /** Section with its year, class and campus, checked for admissions/moves. */
  private async loadSectionForEnrollment(tx: Transaction, access: TenantAccess, sectionId: string) {
    const [row] = await tx
      .select({
        id: sec.id,
        name: sec.name,
        capacity: sec.capacity,
        campusId: sec.campusId,
        academicYearId: sec.academicYearId,
        yearName: yr.name,
        yearStatus: yr.status,
        yearStartsOn: yr.startsOn,
        gradeLevelId: sec.gradeLevelId,
        className: gl.name,
        classStatus: gl.status,
        campusCode: schema.campuses.code,
        campusStatus: schema.campuses.status,
      })
      .from(sec)
      .innerJoin(yr, and(eq(yr.tenantId, sec.tenantId), eq(yr.id, sec.academicYearId)))
      .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
      .innerJoin(
        schema.campuses,
        and(eq(schema.campuses.tenantId, sec.tenantId), eq(schema.campuses.id, sec.campusId)),
      )
      .where(eq(sec.id, sectionId));
    if (!row || !access.has('students.manage', row.campusId)) throw notFound('Section');
    if (row.yearStatus === 'closed') {
      throw new AppError('CONFLICT', `Academic year ${row.yearName} is closed`, {
        reason: 'year_closed',
      });
    }
    if (row.classStatus !== 'active' || row.campusStatus !== 'active') {
      throw new AppError('VALIDATION_FAILED', 'This class or campus is archived');
    }
    return row;
  }

  private async assertSeat(
    tx: Transaction,
    section: { id: string; capacity: number | null; className: string; name: string },
  ) {
    if (section.capacity === null) return;
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(en)
      .where(and(eq(en.sectionId, section.id), eq(en.status, 'active')));
    if (n >= section.capacity) {
      throw new AppError(
        'CONFLICT',
        `${section.className} ${section.name} is full (${section.capacity} seats)`,
        { reason: 'section_full' },
      );
    }
  }

  private async nextRoll(tx: Transaction, sectionId: string) {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${en.rollNumber})` })
      .from(en)
      .where(and(eq(en.sectionId, sectionId), eq(en.status, 'active')));
    return Math.min((row?.max ?? 0) + 1, 999);
  }

  private async aadhaarColumns(
    tx: Transaction,
    tenantId: string,
    studentId: string,
    aadhaar: string | null,
  ) {
    if (aadhaar === null) return { aadhaarSealed: null, aadhaarLast4: null, aadhaarIndex: null };
    const index = this.vault.index(aadhaar, tenantId, 'aadhaar');
    const [dup] = await tx
      .select({ id: st.id })
      .from(st)
      .where(and(eq(st.aadhaarIndex, index), ne(st.id, studentId)));
    if (dup) {
      throw new AppError('CONFLICT', 'Another student already has this Aadhaar number', {
        reason: 'aadhaar_exists',
        fields: { aadhaar: 'Already recorded for another student' },
      });
    }
    return {
      aadhaarSealed: this.vault.seal(aadhaar, tenantId, studentId, 'aadhaar'),
      aadhaarLast4: aadhaar.slice(-4),
      aadhaarIndex: index,
    };
  }

  /** Creates or reuses a guardian and links them; returns the guardian id. */
  private async linkGuardian(
    tx: Transaction,
    access: TenantAccess,
    studentId: string,
    input: GuardianInput,
  ) {
    let guardianId: string;
    if ('guardianId' in input) {
      const [existing] = await tx.select({ id: g.id }).from(g).where(eq(g.id, input.guardianId));
      if (!existing) throw notFound('Guardian');
      guardianId = existing.id;
    } else {
      const [row] = await tx
        .insert(g)
        .values({
          tenantId: access.tenantId,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          occupation: input.occupation,
        })
        .returning({ id: g.id });
      guardianId = row!.id;
    }
    if (input.isPrimary) {
      await tx
        .update(sg)
        .set({ isPrimary: false })
        .where(and(eq(sg.studentId, studentId), eq(sg.isPrimary, true)));
    }
    try {
      await tx.insert(sg).values({
        tenantId: access.tenantId,
        studentId,
        guardianId,
        relationship: input.relationship,
        isPrimary: input.isPrimary,
        isFeePayer: input.isFeePayer,
      });
    } catch (err) {
      return rethrowConflicts(err, { student_guardians_pk: 'This guardian is already linked' });
    }
    return guardianId;
  }

  /* ------------------------------------- admission ------------------------------------ */

  admit(access: TenantAccess, input: StudentAdmitInput) {
    return withTenant(this.handle.db, access.ctx, (tx) => this.admitInTx(tx, access, input));
  }

  /** The admission itself; also used when admitting an approved application. */
  async admitInTx(
    tx: Transaction,
    access: TenantAccess,
    input: StudentAdmitInput,
    /** Imports and applications may not carry every required custom field. */
    {
      requireCustomFields = true,
      admissionNumber: existingNumber,
    }: {
      requireCustomFields?: boolean;
      /** Keep the school's existing number (imports); otherwise one is allocated. */
      admissionNumber?: string | null;
    } = {},
  ) {
    {
      const section = await this.loadSectionForEnrollment(tx, access, input.sectionId);
      await this.assertSeat(tx, section);
      const id = newId();
      const admissionDate = input.admissionDate ?? today();
      const customFields = await this.customFields.check(
        tx,
        'student',
        input.customFields,
        {},
        {
          partial: !requireCustomFields,
        },
      );
      const admissionNumber =
        existingNumber ??
        (await this.numbers.allocate(tx, access.tenantId, {
          campusId: section.campusId,
          campusCode: section.campusCode,
          year: Number(section.yearStartsOn.slice(0, 4)),
        }));
      try {
        await tx.insert(st).values({
          id,
          tenantId: access.tenantId,
          campusId: section.campusId,
          admissionNumber,
          admissionDate,
          firstName: input.firstName,
          lastName: input.lastName,
          nameLocal: input.nameLocal,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          bloodGroup: input.bloodGroup,
          address: input.address,
          pen: input.pen,
          apaarId: input.apaarId,
          customFields,
          ...(await this.aadhaarColumns(tx, access.tenantId, id, input.aadhaar)),
        });
        let primaryGuardian = '';
        for (const gi of input.guardians) {
          const gid = await this.linkGuardian(tx, access, id, gi);
          if (gi.isPrimary) primaryGuardian = gid;
        }
        const rollNumber = input.rollNumber ?? (await this.nextRoll(tx, section.id));
        const [enrollment] = await tx
          .insert(en)
          .values({
            tenantId: access.tenantId,
            studentId: id,
            campusId: section.campusId,
            academicYearId: section.academicYearId,
            sectionId: section.id,
            rollNumber,
            // Admitted before the session starts → enrolled from its first day.
            enrolledOn: admissionDate > section.yearStartsOn ? admissionDate : section.yearStartsOn,
          })
          .returning({ id: en.id });
        await tx.insert(schema.privacyAcknowledgements).values({
          tenantId: access.tenantId,
          guardianId: primaryGuardian,
          studentId: id,
          noticeVersion: input.privacyNotice.version,
          channel: input.privacyNotice.channel,
          recordedBy: access.userId,
        });
        await this.audit.record(tx, access, {
          action: 'student.admitted',
          entity: 'student',
          entityId: id,
          campusId: section.campusId,
          diff: {
            admissionNumber,
            name: `${input.firstName} ${input.lastName}`.trim(),
            section: `${section.className} ${section.name}`,
            year: section.yearName,
            rollNumber,
            guardians: input.guardians.length,
            aadhaar: input.aadhaar ? 'recorded' : null,
          },
        });
        return {
          id,
          admissionNumber,
          enrollmentId: enrollment!.id,
          rollNumber,
          sectionCampusId: section.campusId,
          gradeLevelId: section.gradeLevelId,
          academicYearId: section.academicYearId,
        };
      } catch (err) {
        return rethrowConflicts(err, STUDENT_CONFLICTS);
      }
    }
  }

  /* --------------------------------------- reads -------------------------------------- */

  list(
    access: TenantAccess,
    q: StudentListQuery,
    /** Exports: every matching row (up to 10 000), limited to campuses `exportScope` allows. */
    { all = false, exportScope }: { all?: boolean; exportScope?: ReadonlySet<string> | null } = {},
  ) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const vis = this.visibility(access);
        if (vis === false) return { data: [], nextCursor: null };
        const filters: SQL[] = vis ? [vis] : [];
        if (exportScope) filters.push(inArray(st.campusId, [...exportScope]));
        if (q.campusId) filters.push(eq(st.campusId, q.campusId));
        if (q.status) filters.push(eq(st.status, q.status));
        const roster = Boolean(q.sectionId);
        if (q.q) {
          const term = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          const digits = q.q.replace(/\D/g, '');
          filters.push(sql`(
            ${st.firstName} ilike ${term} or ${st.lastName} ilike ${term}
            or (${st.firstName} || ' ' || ${st.lastName}) ilike ${term}
            or ${st.admissionNumber} ilike ${term}
            ${
              digits.length >= 4
                ? sql`or exists (select 1 from student_guardians x join guardians y
                     on y.tenant_id = x.tenant_id and y.id = x.guardian_id
                     where x.tenant_id = ${st.tenantId} and x.student_id = ${st.id}
                       and y.phone like ${`%${digits}%`})`
                : sql``
            })`);
        }
        // Enrollment shown: the requested year's, else the most recent one.
        const enrollmentJoin = q.academicYearId
          ? and(
              eq(en.tenantId, st.tenantId),
              eq(en.studentId, st.id),
              eq(en.academicYearId, q.academicYearId),
            )
          : and(
              eq(en.tenantId, st.tenantId),
              eq(en.studentId, st.id),
              sql`${en.id} = (select e2.id from student_enrollments e2 where e2.tenant_id = ${st.tenantId}
                  and e2.student_id = ${st.id} order by e2.enrolled_on desc, e2.id desc limit 1)`,
            );
        if (q.academicYearId || q.sectionId || q.gradeLevelId) {
          filters.push(sql`${en.id} is not null`);
        }
        if (q.sectionId) filters.push(eq(en.sectionId, q.sectionId));
        if (q.gradeLevelId) filters.push(eq(sec.gradeLevelId, q.gradeLevelId));
        if (!roster && q.cursor) filters.push(sql`${st.id} < ${decodeCursor(q.cursor)}`);

        const query = tx
          .select({
            id: st.id,
            admissionNumber: st.admissionNumber,
            firstName: st.firstName,
            lastName: st.lastName,
            gender: st.gender,
            dateOfBirth: st.dateOfBirth,
            status: st.status,
            campusId: st.campusId,
            enrollmentId: en.id,
            enrollmentStatus: en.status,
            rollNumber: en.rollNumber,
            sectionId: en.sectionId,
            sectionName: sec.name,
            className: gl.name,
            yearName: yr.name,
            guardianName: sql<
              string | null
            >`(select y.full_name from student_guardians x join guardians y
              on y.tenant_id = x.tenant_id and y.id = x.guardian_id
              where x.tenant_id = ${st.tenantId} and x.student_id = ${st.id} and x.is_primary limit 1)`,
            guardianPhone: sql<
              string | null
            >`(select y.phone from student_guardians x join guardians y
              on y.tenant_id = x.tenant_id and y.id = x.guardian_id
              where x.tenant_id = ${st.tenantId} and x.student_id = ${st.id} and x.is_primary limit 1)`,
          })
          .from(st)
          .leftJoin(en, enrollmentJoin)
          .leftJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .leftJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .leftJoin(yr, and(eq(yr.tenantId, en.tenantId), eq(yr.id, en.academicYearId)))
          .where(filters.length ? and(...filters) : undefined);

        if (all) {
          const rows = await query.orderBy(asc(st.admissionNumber)).limit(10_000);
          return { data: rows, nextCursor: null };
        }
        if (roster) {
          const rows = await query.orderBy(
            sql`${en.rollNumber} asc nulls last`,
            asc(st.firstName),
            asc(st.lastName),
          );
          return { data: rows, nextCursor: null };
        }
        const rows = await query.orderBy(desc(st.id)).limit(q.limit + 1);
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
        const s = await this.loadVisible(tx, access, id);
        const guardians = await tx
          .select({
            id: g.id,
            fullName: g.fullName,
            phone: g.phone,
            email: g.email,
            occupation: g.occupation,
            customFields: g.customFields,
            relationship: sg.relationship,
            isPrimary: sg.isPrimary,
            isFeePayer: sg.isFeePayer,
          })
          .from(sg)
          .innerJoin(g, and(eq(g.tenantId, sg.tenantId), eq(g.id, sg.guardianId)))
          .where(eq(sg.studentId, id))
          .orderBy(desc(sg.isPrimary), asc(g.fullName));
        const enrollments = await tx
          .select({
            id: en.id,
            academicYearId: en.academicYearId,
            yearName: yr.name,
            yearStatus: yr.status,
            sectionId: en.sectionId,
            sectionName: sec.name,
            gradeLevelId: sec.gradeLevelId,
            className: gl.name,
            rollNumber: en.rollNumber,
            status: en.status,
            enrolledOn: en.enrolledOn,
            leftOn: en.leftOn,
          })
          .from(en)
          .innerJoin(yr, and(eq(yr.tenantId, en.tenantId), eq(yr.id, en.academicYearId)))
          .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .where(eq(en.studentId, id))
          .orderBy(desc(yr.startsOn));
        const acknowledgements = await tx
          .select({
            id: schema.privacyAcknowledgements.id,
            guardianId: schema.privacyAcknowledgements.guardianId,
            noticeVersion: schema.privacyAcknowledgements.noticeVersion,
            channel: schema.privacyAcknowledgements.channel,
            acknowledgedAt: schema.privacyAcknowledgements.acknowledgedAt,
          })
          .from(schema.privacyAcknowledgements)
          .where(eq(schema.privacyAcknowledgements.studentId, id))
          .orderBy(desc(schema.privacyAcknowledgements.acknowledgedAt));
        const canManage = access.has('students.manage', s.campusId);
        return {
          id: s.id,
          campusId: s.campusId,
          admissionNumber: s.admissionNumber,
          admissionDate: s.admissionDate,
          firstName: s.firstName,
          lastName: s.lastName,
          nameLocal: s.nameLocal,
          dateOfBirth: s.dateOfBirth,
          gender: s.gender,
          bloodGroup: s.bloodGroup,
          address: s.address,
          pen: s.pen,
          apaarId: s.apaarId,
          aadhaarMasked: s.aadhaarLast4 ? maskAadhaar(s.aadhaarLast4) : null,
          status: s.status,
          customFields: s.customFields,
          guardians,
          enrollments,
          acknowledgements,
          permissions: {
            manage: canManage,
            viewSensitive: access.has('students.sensitive.view', s.campusId),
          },
        };
      },
      { readOnly: true },
    );
  }

  /** Full Aadhaar for one student; every view is written to the audit log. */
  revealAadhaar(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadVisible(tx, access, id);
      if (!access.has('students.sensitive.view', s.campusId)) {
        throw new AppError('FORBIDDEN', 'You do not have permission to see Aadhaar numbers');
      }
      if (!s.aadhaarSealed) throw notFound('Aadhaar number');
      const aadhaar = this.vault.open(s.aadhaarSealed, access.tenantId, s.id, 'aadhaar');
      await this.audit.record(tx, access, {
        action: 'student.aadhaar_viewed',
        entity: 'student',
        entityId: id,
        campusId: s.campusId,
      });
      return { aadhaar };
    });
  }

  /* --------------------------------------- edits -------------------------------------- */

  update(access: TenantAccess, id: string, input: StudentUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadManaged(tx, access, id);
      const { aadhaar, customFields: cfInput, ...fields } = input;
      const aadhaarCols =
        aadhaar === undefined ? {} : await this.aadhaarColumns(tx, access.tenantId, id, aadhaar);
      const customFields =
        cfInput === undefined
          ? undefined
          : await this.customFields.check(tx, 'student', cfInput, s.customFields, {
              partial: true,
            });
      try {
        await tx
          .update(st)
          .set({
            ...fields,
            ...aadhaarCols,
            ...(customFields ? { customFields } : {}),
            updatedAt: new Date(),
          })
          .where(eq(st.id, id));
      } catch (err) {
        return rethrowConflicts(err, STUDENT_CONFLICTS);
      }
      await this.audit.record(tx, access, {
        action: 'student.updated',
        entity: 'student',
        entityId: id,
        campusId: s.campusId,
        diff: {
          ...fields,
          ...(aadhaar === undefined ? {} : { aadhaar: aadhaar ? 'changed' : 'removed' }),
        },
      });
      return this.getInTx(tx, id);
    });
  }

  private async getInTx(tx: Transaction, id: string) {
    const [row] = await tx
      .select({ id: st.id, admissionNumber: st.admissionNumber, aadhaarLast4: st.aadhaarLast4 })
      .from(st)
      .where(eq(st.id, id));
    return {
      id: row!.id,
      admissionNumber: row!.admissionNumber,
      aadhaarMasked: row!.aadhaarLast4 ? maskAadhaar(row!.aadhaarLast4) : null,
    };
  }

  /* ------------------------------------- guardians ------------------------------------ */

  /** Existing guardians with this phone number (to link siblings). */
  findGuardians(access: TenantAccess, phone: string) {
    if (!access.has('students.manage')) throw new AppError('FORBIDDEN', 'Not allowed');
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const vis = this.visibility(access);
        const rows = await tx
          .select({ id: g.id, fullName: g.fullName, phone: g.phone, email: g.email })
          .from(g)
          .where(eq(g.phone, phone))
          .limit(10);
        return Promise.all(
          rows.map(async (row) => ({
            ...row,
            children: await tx
              .select({
                id: st.id,
                name: sql<string>`trim(${st.firstName} || ' ' || ${st.lastName})`,
                admissionNumber: st.admissionNumber,
              })
              .from(sg)
              .innerJoin(st, and(eq(st.tenantId, sg.tenantId), eq(st.id, sg.studentId)))
              .where(vis ? and(eq(sg.guardianId, row.id), vis) : eq(sg.guardianId, row.id)),
          })),
        );
      },
      { readOnly: true },
    );
  }

  addGuardian(access: TenantAccess, studentId: string, input: GuardianInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadManaged(tx, access, studentId);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sg)
        .where(eq(sg.studentId, studentId));
      if (n >= 4)
        throw new AppError('CONFLICT', 'A student can have at most 4 guardians', {
          reason: 'too_many',
        });
      const guardianId = await this.linkGuardian(tx, access, studentId, input);
      await this.audit.record(tx, access, {
        action: 'student.guardian_added',
        entity: 'student',
        entityId: studentId,
        campusId: s.campusId,
        diff: { guardianId, relationship: input.relationship, isPrimary: input.isPrimary },
      });
      return { guardianId };
    });
  }

  updateGuardianLink(
    access: TenantAccess,
    studentId: string,
    guardianId: string,
    input: { relationship?: string; isPrimary?: true; isFeePayer?: boolean },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadManaged(tx, access, studentId);
      const where = and(eq(sg.studentId, studentId), eq(sg.guardianId, guardianId));
      const [link] = await tx.select({ isPrimary: sg.isPrimary }).from(sg).where(where);
      if (!link) throw notFound('Guardian');
      if (input.isPrimary) {
        await tx
          .update(sg)
          .set({ isPrimary: false })
          .where(and(eq(sg.studentId, studentId), eq(sg.isPrimary, true)));
      }
      await tx.update(sg).set(input).where(where);
      await this.audit.record(tx, access, {
        action: 'student.guardian_updated',
        entity: 'student',
        entityId: studentId,
        campusId: s.campusId,
        diff: { guardianId, ...input },
      });
    });
  }

  removeGuardian(access: TenantAccess, studentId: string, guardianId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadManaged(tx, access, studentId);
      const links = await tx
        .select({ guardianId: sg.guardianId, isPrimary: sg.isPrimary })
        .from(sg)
        .where(eq(sg.studentId, studentId));
      const link = links.find((l) => l.guardianId === guardianId);
      if (!link) throw notFound('Guardian');
      if (link.isPrimary) {
        throw new AppError('CONFLICT', 'Make another guardian the primary contact first', {
          reason: 'primary_guardian',
        });
      }
      if (links.length <= 1) {
        throw new AppError('CONFLICT', 'A student needs at least one guardian', {
          reason: 'last_guardian',
        });
      }
      await tx.delete(sg).where(and(eq(sg.studentId, studentId), eq(sg.guardianId, guardianId)));
      await this.audit.record(tx, access, {
        action: 'student.guardian_removed',
        entity: 'student',
        entityId: studentId,
        campusId: s.campusId,
        diff: { guardianId },
      });
    });
  }

  /** Edit a guardian's details: the caller must manage at least one of their children. */
  updateGuardian(access: TenantAccess, guardianId: string, input: GuardianUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const children = await tx
        .select({ campusId: st.campusId })
        .from(sg)
        .innerJoin(st, and(eq(st.tenantId, sg.tenantId), eq(st.id, sg.studentId)))
        .where(eq(sg.guardianId, guardianId));
      if (!children.some((c) => access.has('students.manage', c.campusId)))
        throw notFound('Guardian');
      await tx
        .update(g)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(g.id, guardianId));
      await this.audit.record(tx, access, {
        action: 'guardian.updated',
        entity: 'guardian',
        entityId: guardianId,
        diff: input,
      });
    });
  }

  recordAcknowledgement(
    access: TenantAccess,
    studentId: string,
    guardianId: string,
    input: { version: string; channel: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadManaged(tx, access, studentId);
      const [link] = await tx
        .select({ id: sg.guardianId })
        .from(sg)
        .where(and(eq(sg.studentId, studentId), eq(sg.guardianId, guardianId)));
      if (!link) throw notFound('Guardian');
      await tx.insert(schema.privacyAcknowledgements).values({
        tenantId: access.tenantId,
        guardianId,
        studentId,
        noticeVersion: input.version,
        channel: input.channel,
        recordedBy: access.userId,
      });
      await this.audit.record(tx, access, {
        action: 'privacy.acknowledged',
        entity: 'student',
        entityId: studentId,
        campusId: s.campusId,
        diff: { guardianId, ...input },
      });
    });
  }

  /* ------------------------------------ enrollments ----------------------------------- */

  updateEnrollment(access: TenantAccess, enrollmentId: string, input: EnrollmentUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [e] = await tx.select().from(en).where(eq(en.id, enrollmentId));
      if (!e || !access.has('students.manage', e.campusId)) throw notFound('Enrollment');
      if (e.status !== 'active') {
        throw new AppError('CONFLICT', 'Only a current enrollment can be changed', {
          reason: 'enrollment_closed',
        });
      }
      const current = await this.loadSectionForEnrollment(tx, access, e.sectionId);
      let target = current;
      if (input.sectionId && input.sectionId !== e.sectionId) {
        target = await this.loadSectionForEnrollment(tx, access, input.sectionId);
        if (target.academicYearId !== e.academicYearId || target.campusId !== e.campusId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Move within the same campus and academic year only',
          );
        }
        await this.assertSeat(tx, target);
      }
      const moving = target.id !== e.sectionId;
      const rollNumber =
        input.rollNumber !== undefined
          ? input.rollNumber
          : moving
            ? await this.nextRoll(tx, target.id)
            : e.rollNumber;
      try {
        await tx
          .update(en)
          .set({ sectionId: target.id, rollNumber, updatedAt: new Date() })
          .where(eq(en.id, enrollmentId));
      } catch (err) {
        return rethrowConflicts(err, STUDENT_CONFLICTS);
      }
      await this.audit.record(tx, access, {
        action: moving ? 'enrollment.section_changed' : 'enrollment.roll_changed',
        entity: 'student',
        entityId: e.studentId,
        campusId: e.campusId,
        diff: {
          from: `${current.className} ${current.name}`,
          to: `${target.className} ${target.name}`,
          rollNumber,
        },
      });
      return { sectionId: target.id, rollNumber };
    });
  }

  /** Re-assigns roll numbers 1…n in a section, by name or admission number. */
  renumber(access: TenantAccess, sectionId: string, order: 'name' | 'admission_number') {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const section = await this.loadSectionForEnrollment(tx, access, sectionId);
      const rows = await tx
        .select({ id: en.id })
        .from(en)
        .innerJoin(st, and(eq(st.tenantId, en.tenantId), eq(st.id, en.studentId)))
        .where(and(eq(en.sectionId, sectionId), eq(en.status, 'active')))
        .orderBy(
          ...(order === 'name'
            ? [asc(st.firstName), asc(st.lastName), asc(st.admissionNumber)]
            : [asc(st.admissionNumber)]),
        );
      // Clear first so the unique roll index never sees two rows with the same number.
      await tx
        .update(en)
        .set({ rollNumber: null })
        .where(and(eq(en.sectionId, sectionId), eq(en.status, 'active')));
      for (const [i, row] of rows.entries()) {
        await tx
          .update(en)
          .set({ rollNumber: i + 1, updatedAt: new Date() })
          .where(eq(en.id, row.id));
      }
      await this.audit.record(tx, access, {
        action: 'section.renumbered',
        entity: 'section',
        entityId: sectionId,
        campusId: section.campusId,
        diff: { order, students: rows.length },
      });
      return { students: rows.length };
    });
  }
}
