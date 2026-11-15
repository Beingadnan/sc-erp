import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { formatAdmissionNumber } from '@school-erp/validation';
import type { PromotionInput, WithdrawInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { renderTcPdf } from './tc-pdf.js';
import type { TcDetails } from './tc-pdf.js';

const st = schema.students;
const en = schema.studentEnrollments;
const sec = schema.sections;
const yr = schema.academicYears;
const gl = schema.gradeLevels;
const tc = schema.transferCertificates;

const GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' };

@Injectable()
export class LifecycleService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  private async sectionInfo(tx: Transaction, sectionId: string) {
    const [row] = await tx
      .select({
        id: sec.id,
        name: sec.name,
        capacity: sec.capacity,
        campusId: sec.campusId,
        academicYearId: sec.academicYearId,
        gradeLevelId: sec.gradeLevelId,
        className: gl.name,
        classSort: gl.sortOrder,
        yearName: yr.name,
        yearStatus: yr.status,
        yearStartsOn: yr.startsOn,
        yearEndsOn: yr.endsOn,
      })
      .from(sec)
      .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
      .innerJoin(yr, and(eq(yr.tenantId, sec.tenantId), eq(yr.id, sec.academicYearId)))
      .where(eq(sec.id, sectionId));
    return row ?? null;
  }

  /* ------------------------------------ promotion ------------------------------------ */

  /**
   * What the promotion screen needs: the section's current students, and next year's
   * sections with the suggested next class (next by class order).
   */
  preview(access: TenantAccess, fromSectionId: string, toAcademicYearId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const from = await this.sectionInfo(tx, fromSectionId);
        if (!from || !access.has('students.promote', from.campusId)) throw notFound('Section');
        const [target] = await tx
          .select({
            id: yr.id,
            name: yr.name,
            campusId: yr.campusId,
            status: yr.status,
            startsOn: yr.startsOn,
          })
          .from(yr)
          .where(eq(yr.id, toAcademicYearId));
        if (!target || target.campusId !== from.campusId) throw notFound('Academic year');
        const students = await tx
          .select({
            enrollmentId: en.id,
            studentId: st.id,
            admissionNumber: st.admissionNumber,
            firstName: st.firstName,
            lastName: st.lastName,
            rollNumber: en.rollNumber,
            alreadyInTarget: sql<boolean>`exists (select 1 from student_enrollments x
              where x.tenant_id = ${en.tenantId} and x.student_id = ${en.studentId}
                and x.academic_year_id = ${toAcademicYearId})`,
          })
          .from(en)
          .innerJoin(st, and(eq(st.tenantId, en.tenantId), eq(st.id, en.studentId)))
          .where(and(eq(en.sectionId, fromSectionId), eq(en.status, 'active')))
          .orderBy(sql`${en.rollNumber} asc nulls last`, asc(st.firstName));
        const targetSections = await tx
          .select({
            id: sec.id,
            name: sec.name,
            capacity: sec.capacity,
            gradeLevelId: sec.gradeLevelId,
            className: gl.name,
            classSort: gl.sortOrder,
            enrolled: sql<number>`(select count(*)::int from student_enrollments x
              where x.tenant_id = ${sec.tenantId} and x.section_id = ${sec.id} and x.status = 'active')`,
          })
          .from(sec)
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .where(eq(sec.academicYearId, toAcademicYearId))
          .orderBy(asc(gl.sortOrder), asc(sec.name));
        const higher = targetSections.filter((s) => s.classSort > from.classSort);
        const nextClassSort = higher.length ? Math.min(...higher.map((s) => s.classSort)) : null;
        return {
          from: {
            sectionId: from.id,
            label: `${from.className} ${from.name}`,
            yearName: from.yearName,
            gradeLevelId: from.gradeLevelId,
          },
          target: { id: target.id, name: target.name, status: target.status },
          students,
          sections: targetSections.map(({ classSort, ...s }) => ({
            ...s,
            isNextClass: classSort === nextClassSort,
            isSameClass: s.gradeLevelId === from.gradeLevelId,
          })),
          highestClass: nextClassSort === null,
        };
      },
      { readOnly: true },
    );
  }

  promote(access: TenantAccess, input: PromotionInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const from = await this.sectionInfo(tx, input.fromSectionId);
      if (!from || !access.has('students.promote', from.campusId)) throw notFound('Section');
      const [target] = await tx.select().from(yr).where(eq(yr.id, input.toAcademicYearId));
      if (!target || target.campusId !== from.campusId) throw notFound('Academic year');
      if (target.status === 'closed') {
        throw new AppError('CONFLICT', `${target.name} is closed`, { reason: 'year_closed' });
      }
      if (target.startsOn <= from.yearStartsOn) {
        throw new AppError('VALIDATION_FAILED', 'Promote into a later academic year');
      }

      const ids = input.items.map((i) => i.enrollmentId);
      const enrollments = await tx
        .select({ id: en.id, studentId: en.studentId, status: en.status, sectionId: en.sectionId })
        .from(en)
        .where(inArray(en.id, ids))
        .for('update');
      if (enrollments.length !== ids.length || enrollments.some((e) => e.sectionId !== from.id)) {
        throw notFound('Enrollment');
      }
      if (enrollments.some((e) => e.status !== 'active')) {
        throw new AppError('CONFLICT', 'Some students were already moved on; reload the list', {
          reason: 'already_promoted',
        });
      }

      // Target sections: same campus and target year; class rules per action.
      const targetIds = [
        ...new Set(input.items.map((i) => i.toSectionId).filter((x): x is string => !!x)),
      ];
      const targets = new Map<
        string,
        NonNullable<Awaited<ReturnType<LifecycleService['sectionInfo']>>>
      >();
      for (const id of targetIds) {
        const t = await this.sectionInfo(tx, id);
        if (!t || t.academicYearId !== target.id) throw notFound('Section');
        targets.set(id, t);
      }
      const seatsNeeded = new Map<string, number>();
      for (const item of input.items) {
        if (item.action === 'skip' || item.action === 'complete') continue;
        const t = targets.get(item.toSectionId!)!;
        if (item.action === 'retain' && t.gradeLevelId !== from.gradeLevelId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'A student kept back must stay in the same class',
          );
        }
        if (item.action === 'promote' && t.classSort <= from.classSort) {
          throw new AppError(
            'VALIDATION_FAILED',
            `${t.className} is not a higher class than ${from.className}`,
          );
        }
        seatsNeeded.set(t.id, (seatsNeeded.get(t.id) ?? 0) + 1);
      }
      for (const [sectionId, n] of seatsNeeded) {
        const t = targets.get(sectionId)!;
        if (t.capacity === null) continue;
        const [{ used } = { used: 0 }] = await tx
          .select({ used: sql<number>`count(*)::int` })
          .from(en)
          .where(and(eq(en.sectionId, sectionId), eq(en.status, 'active')));
        if (used + n > t.capacity) {
          throw new AppError(
            'CONFLICT',
            `${t.className} ${t.name} has ${t.capacity - used} free seats; ${n} needed`,
            {
              reason: 'section_full',
            },
          );
        }
      }

      const nextRoll = new Map<string, number>();
      const counts = { promoted: 0, retained: 0, completed: 0, skipped: 0 };
      for (const item of input.items) {
        const e = enrollments.find((x) => x.id === item.enrollmentId)!;
        if (item.action === 'skip') {
          counts.skipped++;
          continue;
        }
        if (item.action === 'complete') {
          await tx
            .update(en)
            .set({ status: 'completed', leftOn: from.yearEndsOn, updatedAt: new Date() })
            .where(eq(en.id, e.id));
          await tx
            .update(st)
            .set({ status: 'alumni', updatedAt: new Date() })
            .where(eq(st.id, e.studentId));
          counts.completed++;
          continue;
        }
        const t = targets.get(item.toSectionId!)!;
        if (!nextRoll.has(t.id)) {
          const [r] = await tx
            .select({ max: sql<number | null>`max(${en.rollNumber})` })
            .from(en)
            .where(and(eq(en.sectionId, t.id), eq(en.status, 'active')));
          nextRoll.set(t.id, (r?.max ?? 0) + 1);
        }
        const roll = Math.min(nextRoll.get(t.id)!, 999);
        nextRoll.set(t.id, roll + 1);
        await tx
          .update(en)
          .set({
            status: item.action === 'promote' ? 'promoted' : 'completed',
            leftOn: from.yearEndsOn,
            updatedAt: new Date(),
          })
          .where(eq(en.id, e.id));
        try {
          await tx.insert(en).values({
            tenantId: access.tenantId,
            studentId: e.studentId,
            campusId: from.campusId,
            academicYearId: target.id,
            sectionId: t.id,
            rollNumber: roll,
            enrolledOn: target.startsOn,
          });
        } catch (err) {
          return rethrowConflicts(err, {
            student_enrollments_student_year_uq: 'A student is already enrolled in the next year',
          });
        }
        if (item.action === 'promote') counts.promoted++;
        else counts.retained++;
      }
      await this.audit.record(tx, access, {
        action: 'students.promoted',
        entity: 'section',
        entityId: from.id,
        campusId: from.campusId,
        diff: {
          from: `${from.className} ${from.name} (${from.yearName})`,
          to: target.name,
          ...counts,
        },
      });
      return counts;
    });
  }

  /* ----------------------------- withdrawal and certificates ---------------------------- */

  private async loadStudent(tx: Transaction, access: TenantAccess, id: string, permission: string) {
    const [s] = await tx.select().from(st).where(eq(st.id, id));
    if (!s || !access.has(permission, s.campusId)) throw notFound('Student');
    return s;
  }

  private async tcDetails(
    tx: Transaction,
    access: TenantAccess,
    s: typeof st.$inferSelect,
    leftOn: string,
    reason: string,
    conduct: string,
    remarks: string,
  ): Promise<{ details: TcDetails; yearStart: number }> {
    const [school] = await tx
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, access.tenantId));
    const [campus] = await tx
      .select()
      .from(schema.campuses)
      .where(eq(schema.campuses.id, s.campusId));
    const [last] = await tx
      .select({
        className: gl.name,
        sectionName: sec.name,
        yearName: yr.name,
        startsOn: yr.startsOn,
      })
      .from(en)
      .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
      .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
      .innerJoin(yr, and(eq(yr.tenantId, en.tenantId), eq(yr.id, en.academicYearId)))
      .where(eq(en.studentId, s.id))
      .orderBy(desc(yr.startsOn))
      .limit(1);
    const guardians = await tx
      .select({
        name: schema.guardians.fullName,
        relationship: schema.studentGuardians.relationship,
      })
      .from(schema.studentGuardians)
      .innerJoin(
        schema.guardians,
        and(
          eq(schema.guardians.tenantId, schema.studentGuardians.tenantId),
          eq(schema.guardians.id, schema.studentGuardians.guardianId),
        ),
      )
      .where(eq(schema.studentGuardians.studentId, s.id));
    const byRel = (r: string) => guardians.find((g) => g.relationship === r)?.name ?? null;
    const fatherName = byRel('father');
    const motherName = byRel('mother');
    return {
      yearStart: Number((last?.startsOn ?? leftOn).slice(0, 4)),
      details: {
        schoolName: school!.name,
        campusName: campus!.name,
        campusAddress: campus!.address,
        board: campus!.board,
        udiseCode: campus!.udiseCode,
        studentName: `${s.firstName} ${s.lastName}`.trim(),
        admissionNumber: s.admissionNumber,
        admissionDate: s.admissionDate,
        dateOfBirth: s.dateOfBirth,
        gender: GENDER[s.gender] ?? s.gender,
        fatherName,
        motherName,
        guardianName: !fatherName && !motherName ? (guardians[0]?.name ?? null) : null,
        lastClass: last ? `${last.className} ${last.sectionName}` : null,
        lastYear: last?.yearName ?? null,
        leftOn,
        reason,
        conduct,
        remarks,
        pen: s.pen,
        apaarId: s.apaarId,
      },
    };
  }

  private async issueInTx(
    tx: Transaction,
    access: TenantAccess,
    s: typeof st.$inferSelect,
    leftOn: string,
    reason: string,
    conduct: string,
    remarks: string,
  ) {
    const { details, yearStart } = await this.tcDetails(
      tx,
      access,
      s,
      leftOn,
      reason,
      conduct,
      remarks,
    );
    const counter = await tx.execute<{ last_value: number }>(sql`
      insert into number_counters (tenant_id, counter_key, last_value)
      values (${access.tenantId}, ${`tc:${yearStart}`}, 1)
      on conflict (tenant_id, counter_key) do update set last_value = number_counters.last_value + 1
      returning last_value`);
    const tcNumber = formatAdmissionNumber('TC/{YYYY}/{SEQ:4}', counter.rows[0]!.last_value, {
      year: yearStart,
      campusCode: '',
    });
    try {
      const [row] = await tx
        .insert(tc)
        .values({
          tenantId: access.tenantId,
          studentId: s.id,
          tcNumber,
          issuedOn: new Date().toISOString().slice(0, 10),
          details: details as unknown as Record<string, unknown>,
          issuedBy: access.userId,
        })
        .returning({ id: tc.id, tcNumber: tc.tcNumber });
      await this.audit.record(tx, access, {
        action: 'tc.issued',
        entity: 'student',
        entityId: s.id,
        campusId: s.campusId,
        diff: { tcNumber },
      });
      return row!;
    } catch (err) {
      return rethrowConflicts(err, {
        transfer_certificates_one_issued_uq:
          'A transfer certificate has already been issued; cancel it first',
      });
    }
  }

  withdraw(access: TenantAccess, studentId: string, input: WithdrawInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.select({ id: st.id }).from(st).where(eq(st.id, studentId)).for('update');
      const s = await this.loadStudent(tx, access, studentId, 'students.withdraw');
      if (s.status !== 'active') {
        throw new AppError('CONFLICT', 'Only current students can be withdrawn', {
          reason: 'not_active',
        });
      }
      if (input.leftOn < s.admissionDate) {
        throw new AppError('VALIDATION_FAILED', 'The leaving date is before the admission date', {
          fields: { leftOn: 'Before admission date' },
        });
      }
      const [active] = await tx
        .select({ id: en.id, enrolledOn: en.enrolledOn })
        .from(en)
        .where(and(eq(en.studentId, studentId), eq(en.status, 'active')));
      if (active) {
        if (input.leftOn < active.enrolledOn) {
          throw new AppError(
            'VALIDATION_FAILED',
            'The leaving date is before the current enrollment started',
            {
              fields: { leftOn: 'Too early' },
            },
          );
        }
        await tx
          .update(en)
          .set({
            status: 'withdrawn',
            leftOn: input.leftOn,
            exitReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(en.id, active.id));
      }
      await tx
        .update(st)
        .set({ status: 'withdrawn', updatedAt: new Date() })
        .where(eq(st.id, studentId));
      await this.audit.record(tx, access, {
        action: 'student.withdrawn',
        entity: 'student',
        entityId: studentId,
        campusId: s.campusId,
        diff: { leftOn: input.leftOn, reason: input.reason },
      });
      const certificate = input.issueTc
        ? await this.issueInTx(
            tx,
            access,
            { ...s, status: 'withdrawn' },
            input.leftOn,
            input.reason,
            input.conduct,
            input.remarks,
          )
        : null;
      return { status: 'withdrawn', certificate };
    });
  }

  /** TC for a student who already left (withdrawn) or finished (alumni). */
  issue(access: TenantAccess, studentId: string, input: WithdrawInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.loadStudent(tx, access, studentId, 'students.withdraw');
      if (s.status === 'active') {
        throw new AppError('CONFLICT', 'Withdraw the student first', { reason: 'still_active' });
      }
      return this.issueInTx(
        tx,
        access,
        s,
        input.leftOn,
        input.reason,
        input.conduct,
        input.remarks,
      );
    });
  }

  list(access: TenantAccess, studentId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.loadStudent(tx, access, studentId, 'students.view');
        return tx
          .select({
            id: tc.id,
            tcNumber: tc.tcNumber,
            issuedOn: tc.issuedOn,
            status: tc.status,
            cancelledReason: tc.cancelledReason,
            issuedByName: schema.users.fullName,
          })
          .from(tc)
          .leftJoin(schema.users, eq(schema.users.id, tc.issuedBy))
          .where(eq(tc.studentId, studentId))
          .orderBy(desc(tc.createdAt));
      },
      { readOnly: true },
    );
  }

  cancel(access: TenantAccess, id: string, reason: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [row] = await tx.select().from(tc).where(eq(tc.id, id));
      if (!row) throw notFound('Transfer certificate');
      const s = await this.loadStudent(tx, access, row.studentId, 'students.withdraw').catch(() => {
        throw notFound('Transfer certificate');
      });
      if (row.status !== 'issued') {
        throw new AppError('CONFLICT', 'This certificate is already cancelled', {
          reason: 'already_cancelled',
        });
      }
      await tx
        .update(tc)
        .set({ status: 'cancelled', cancelledReason: reason, cancelledAt: new Date() })
        .where(eq(tc.id, id));
      await this.audit.record(tx, access, {
        action: 'tc.cancelled',
        entity: 'student',
        entityId: s.id,
        campusId: s.campusId,
        diff: { tcNumber: row.tcNumber, reason },
      });
    });
  }

  pdf(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [row] = await tx.select().from(tc).where(eq(tc.id, id));
      if (!row) throw notFound('Transfer certificate');
      const s = await this.loadStudent(tx, access, row.studentId, 'students.view').catch(() => {
        throw notFound('Transfer certificate');
      });
      await this.audit.record(tx, access, {
        action: 'tc.printed',
        entity: 'student',
        entityId: s.id,
        campusId: s.campusId,
        diff: { tcNumber: row.tcNumber },
      });
      const bytes = await renderTcPdf(
        row.tcNumber,
        row.issuedOn,
        row.details as unknown as TcDetails,
        {
          cancelled: row.status === 'cancelled',
        },
      );
      return { bytes, fileName: `${row.tcNumber.replace(/\//g, '-')}.pdf` };
    });
  }
}
