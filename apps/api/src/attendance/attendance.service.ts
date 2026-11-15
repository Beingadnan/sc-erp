import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { attendancePercent } from '@school-erp/validation';
import type {
  AttendanceSettingsInput,
  LeaveCreateInput,
  MarkAttendanceInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { OutboxService } from '../tenancy/outbox.service.js';
import { assertCampus } from '../academic/campus-check.js';
import { describeDay, eachDate } from '../academic/working-days.js';
import type { DayInfo, OffEvent, YearRules } from '../academic/working-days.js';

const sec = schema.sections;
const gl = schema.gradeLevels;
const yr = schema.academicYears;
const en = schema.studentEnrollments;
const st = schema.students;
const ses = schema.attendanceSessions;
const rec = schema.studentAttendance;
const cor = schema.attendanceCorrections;
const lv = schema.leaveRequests;
const set = schema.attendanceSettings;
const ce = schema.calendarEvents;
const cp = schema.campuses;
const us = schema.users;

export const DEFAULT_SETTINGS = {
  mode: 'daily' as 'daily' | 'period',
  periodsPerDay: 8,
  cutoffHours: 12,
  lowThreshold: 75,
  leaveCountsAs: 'excluded' as 'absent' | 'excluded',
};
export type Settings = typeof DEFAULT_SETTINGS;

const HOUR = 3_600_000;

/** Today's date at the campus, as YYYY-MM-DD. */
export const todayIn = (timeZone: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** End of a school date (midnight that follows it), in UTC — campuses are IST by default. */
const offsetMs = (timeZone: string, at: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(at.getTime() / 1000) * 1000;
};
const endOfDate = (date: string, timeZone: string) => {
  const naive = Date.parse(`${date}T00:00:00Z`) + 24 * HOUR;
  return naive - offsetMs(timeZone, new Date(naive));
};

const fullName = (first: string, last: string) => (last ? `${first} ${last}` : first);

interface SectionRow {
  id: string;
  name: string;
  campusId: string;
  academicYearId: string;
  classTeacherMembershipId: string | null;
  className: string;
  classSort: number;
  yearStartsOn: string;
  yearEndsOn: string;
  timezone: string;
}

/** What the caller may do with one section's registers. */
interface SectionRights {
  view: boolean;
  /** Mark within the cut-off (class teacher, or anyone who may correct). */
  mark: boolean;
  /** Change after the cut-off. */
  correct: boolean;
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /* ------------------------------------- helpers ------------------------------------- */

  rights(access: TenantAccess, campusId: string, classTeacher: string | null): SectionRights {
    const own = classTeacher !== null && classTeacher === access.membershipId;
    const correct = access.has('attendance.correct', campusId);
    const mark = correct || (own && access.has('attendance.mark', campusId));
    return { view: mark || access.has('attendance.view', campusId), mark, correct };
  }

  private async section(tx: Transaction, access: TenantAccess, sectionId: string) {
    const [row] = await tx
      .select({
        id: sec.id,
        name: sec.name,
        campusId: sec.campusId,
        academicYearId: sec.academicYearId,
        classTeacherMembershipId: sec.classTeacherMembershipId,
        className: gl.name,
        classSort: gl.sortOrder,
        yearStartsOn: yr.startsOn,
        yearEndsOn: yr.endsOn,
        timezone: cp.timezone,
      })
      .from(sec)
      .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
      .innerJoin(yr, and(eq(yr.tenantId, sec.tenantId), eq(yr.id, sec.academicYearId)))
      .innerJoin(cp, and(eq(cp.tenantId, sec.tenantId), eq(cp.id, sec.campusId)))
      .where(eq(sec.id, sectionId));
    if (!row) throw notFound('Section');
    const rights = this.rights(access, row.campusId, row.classTeacherMembershipId);
    if (!rights.view) throw notFound('Section');
    return { section: row as SectionRow, rights };
  }

  async settingsFor(tx: Transaction, campusId: string): Promise<Settings> {
    const [row] = await tx
      .select({
        mode: set.mode,
        periodsPerDay: set.periodsPerDay,
        cutoffHours: set.cutoffHours,
        lowThreshold: set.lowThreshold,
        leaveCountsAs: set.leaveCountsAs,
      })
      .from(set)
      .where(eq(set.campusId, campusId));
    return row ? (row as Settings) : { ...DEFAULT_SETTINGS };
  }

  private async calendar(tx: Transaction, campusId: string, from: string, to: string) {
    const years: YearRules[] = await tx
      .select({
        id: yr.id,
        name: yr.name,
        startsOn: yr.startsOn,
        endsOn: yr.endsOn,
        weeklyOffDays: yr.weeklyOffDays,
        saturdayOffWeeks: yr.saturdayOffWeeks,
      })
      .from(yr)
      .where(and(eq(yr.campusId, campusId), lte(yr.startsOn, to), gte(yr.endsOn, from)));
    const events: OffEvent[] = await tx
      .select({ title: ce.title, kind: ce.kind, startsOn: ce.startsOn, endsOn: ce.endsOn })
      .from(ce)
      .where(
        and(
          or(eq(ce.campusId, campusId), isNull(ce.campusId)),
          lte(ce.startsOn, to),
          gte(ce.endsOn, from),
        ),
      );
    return { years, events };
  }

  private async dayInfo(tx: Transaction, campusId: string, date: string): Promise<DayInfo> {
    const { years, events } = await this.calendar(tx, campusId, date, date);
    return describeDay(date, years, events);
  }

  private checkPeriod(settings: Settings, period: number) {
    if (settings.mode === 'daily' && period !== 0) {
      throw new AppError('VALIDATION_FAILED', 'This campus takes one register a day (period 0)');
    }
    if (settings.mode === 'period' && (period < 1 || period > settings.periodsPerDay)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Choose a period from 1 to ${settings.periodsPerDay}`,
      );
    }
  }

  /** Students enrolled in the section on the date, in roll order. */
  private roster(tx: Transaction, sectionId: string, date: string) {
    return tx
      .select({
        enrollmentId: en.id,
        studentId: st.id,
        rollNumber: en.rollNumber,
        firstName: st.firstName,
        lastName: st.lastName,
        admissionNumber: st.admissionNumber,
      })
      .from(en)
      .innerJoin(st, and(eq(st.tenantId, en.tenantId), eq(st.id, en.studentId)))
      .where(
        and(
          eq(en.sectionId, sectionId),
          lte(en.enrolledOn, date),
          or(isNull(en.leftOn), gte(en.leftOn, date)),
        ),
      )
      .orderBy(sql`${en.rollNumber} asc nulls last`, asc(st.firstName), asc(st.lastName));
  }

  /** Students (of the list) on approved leave on the date. */
  private async onLeave(tx: Transaction, studentIds: string[], date: string) {
    if (!studentIds.length) return new Set<string>();
    const rows = await tx
      .select({ studentId: lv.studentId })
      .from(lv)
      .where(
        and(
          inArray(lv.studentId, studentIds),
          eq(lv.status, 'approved'),
          lte(lv.fromDate, date),
          gte(lv.toDate, date),
        ),
      );
    return new Set(rows.map((r) => r.studentId));
  }

  /**
   * Whether a register can still be changed freely: until `cutoffHours` after it was first
   * taken; a register never taken closes `cutoffHours` after the end of its date.
   */
  private lockState(
    settings: Settings,
    date: string,
    timezone: string,
    markedAt: Date | null,
    now = Date.now(),
  ) {
    const from = markedAt ? markedAt.getTime() : endOfDate(date, timezone);
    const lockedAt = from + settings.cutoffHours * HOUR;
    return { locked: now > lockedAt, lockedAt: new Date(lockedAt) };
  }

  private async validDate(tx: Transaction, s: SectionRow, date: string) {
    if (date < s.yearStartsOn || date > s.yearEndsOn) {
      throw new AppError('VALIDATION_FAILED', 'The date is outside this section’s academic year');
    }
    if (date > todayIn(s.timezone)) {
      throw new AppError('VALIDATION_FAILED', 'Attendance cannot be taken for a future date');
    }
    const day = await this.dayInfo(tx, s.campusId, date);
    if (!day.working) {
      const why =
        day.reason === 'holiday'
          ? `It is a holiday (${day.title})`
          : day.reason === 'weekly_off' || day.reason === 'saturday_off'
            ? 'It is a weekly off day'
            : 'It is outside the academic year';
      throw new AppError('VALIDATION_FAILED', `${why}; no attendance is taken`);
    }
    return day;
  }

  /* ------------------------------------- settings ------------------------------------- */

  getSettings(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        this.assertAnyAttendance(access, campusId);
        await this.campusExists(tx, campusId);
        return this.settingsFor(tx, campusId);
      },
      { readOnly: true },
    );
  }

  putSettings(access: TenantAccess, campusId: string, input: AttendanceSettingsInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await assertCampus(tx, access, campusId, 'attendance.correct');
      const before = await this.settingsFor(tx, campusId);
      await tx
        .insert(set)
        .values({ tenantId: access.tenantId, campusId, ...input })
        .onConflictDoUpdate({
          target: [set.tenantId, set.campusId],
          set: { ...input, updatedAt: new Date() },
        });
      await this.audit.record(tx, access, {
        action: 'attendance.settings_updated',
        entity: 'campus',
        entityId: campusId,
        campusId,
        diff: { before, after: input },
      });
      return input;
    });
  }

  /* ------------------------------------- register ------------------------------------- */

  register(access: TenantAccess, sectionId: string, date: string, period: number) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const { section: s, rights } = await this.section(tx, access, sectionId);
        const settings = await this.settingsFor(tx, s.campusId);
        this.checkPeriod(settings, period);
        const day = await this.dayInfo(tx, s.campusId, date);
        const [session] = await tx
          .select({
            id: ses.id,
            markedAt: ses.markedAt,
            updatedAt: ses.updatedAt,
            markedBy: us.fullName,
          })
          .from(ses)
          .leftJoin(us, eq(us.id, ses.markedBy))
          .where(and(eq(ses.sectionId, sectionId), eq(ses.onDate, date), eq(ses.period, period)));
        const students = await this.roster(tx, sectionId, date);
        const leave = await this.onLeave(
          tx,
          students.map((x) => x.studentId),
          date,
        );
        const marks = new Map<string, { status: string; remark: string }>();
        if (session) {
          const rows = await tx
            .select({ enrollmentId: rec.enrollmentId, status: rec.status, remark: rec.remark })
            .from(rec)
            .where(eq(rec.sessionId, session.id));
          for (const r of rows) marks.set(r.enrollmentId, r);
        }
        const lock = this.lockState(settings, date, s.timezone, session?.markedAt ?? null);
        const future = date > todayIn(s.timezone);
        const inYear = date >= s.yearStartsOn && date <= s.yearEndsOn;
        const open = day.working && !future && inYear;
        return {
          section: {
            id: s.id,
            name: s.name,
            className: s.className,
            campusId: s.campusId,
            academicYearId: s.academicYearId,
          },
          date,
          period,
          day,
          settings,
          session: session
            ? {
                id: session.id,
                markedAt: session.markedAt,
                markedBy: session.markedBy,
                updatedAt: session.updatedAt,
              }
            : null,
          locked: lock.locked,
          lockedAt: lock.lockedAt,
          canEdit: open && (lock.locked ? rights.correct : rights.mark),
          needsReason: open && lock.locked && !!session,
          students: students.map((x) => {
            const m = marks.get(x.enrollmentId);
            return {
              enrollmentId: x.enrollmentId,
              studentId: x.studentId,
              rollNumber: x.rollNumber,
              name: fullName(x.firstName, x.lastName),
              admissionNumber: x.admissionNumber,
              onLeave: leave.has(x.studentId),
              status: m?.status ?? (leave.has(x.studentId) ? 'leave' : 'present'),
              remark: m?.remark ?? '',
              marked: !!m,
            };
          }),
        };
      },
      { readOnly: true },
    );
  }

  /**
   * Saves a whole register in a handful of statements (session upsert, one insert for new
   * rows, one update for changed rows, corrections, outbox), so a 45-student class saves
   * well under a second even over a remote database.
   */
  mark(
    access: TenantAccess,
    sectionId: string,
    date: string,
    period: number,
    input: MarkAttendanceInput,
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { section: s, rights } = await this.section(tx, access, sectionId);
      if (!rights.mark && !rights.correct) {
        throw new AppError(
          'FORBIDDEN',
          'Only the class teacher can take this section’s attendance',
        );
      }
      const settings = await this.settingsFor(tx, s.campusId);
      this.checkPeriod(settings, period);
      await this.validDate(tx, s, date);

      const roster = await this.roster(tx, sectionId, date);
      const byEnrollment = new Map(roster.map((r) => [r.enrollmentId, r]));
      const unknown = input.records.filter((r) => !byEnrollment.has(r.enrollmentId));
      if (unknown.length) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Some students are not in this section on that date',
          {
            enrollmentIds: unknown.map((u) => u.enrollmentId),
          },
        );
      }
      if (input.records.length !== roster.length) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Mark every student: ${roster.length - input.records.length} not marked`,
        );
      }

      // Session: create, or lock the existing one so two saves don't interleave.
      const now = new Date();
      const [created] = await tx
        .insert(ses)
        .values({
          tenantId: access.tenantId,
          campusId: s.campusId,
          academicYearId: s.academicYearId,
          sectionId,
          onDate: date,
          period,
          markedBy: access.userId,
          markedAt: now,
          updatedBy: access.userId,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [ses.tenantId, ses.sectionId, ses.onDate, ses.period] })
        .returning({ id: ses.id });
      let sessionId: string;
      let markedAt: Date | null = null;
      if (created) {
        sessionId = created.id;
      } else {
        const [existing] = await tx
          .select({ id: ses.id, markedAt: ses.markedAt })
          .from(ses)
          .where(and(eq(ses.sectionId, sectionId), eq(ses.onDate, date), eq(ses.period, period)))
          .for('update');
        sessionId = existing!.id;
        markedAt = existing!.markedAt;
      }

      // First marking long after the date counts as late too.
      const lock = this.lockState(settings, date, s.timezone, markedAt);
      if (lock.locked && !rights.correct) {
        throw new AppError(
          'FORBIDDEN',
          'The register is closed for changes; ask someone who can correct attendance',
        );
      }

      const existingRows = created
        ? []
        : await tx
            .select({
              id: rec.id,
              enrollmentId: rec.enrollmentId,
              status: rec.status,
              remark: rec.remark,
            })
            .from(rec)
            .where(eq(rec.sessionId, sessionId));
      const existing = new Map(existingRows.map((r) => [r.enrollmentId, r]));

      const inserts = input.records.filter((r) => !existing.has(r.enrollmentId));
      const updates = input.records
        .map((r) => ({ r, old: existing.get(r.enrollmentId) }))
        .filter(
          (x): x is { r: (typeof input.records)[number]; old: (typeof existingRows)[number] } =>
            !!x.old && (x.old.status !== x.r.status || x.old.remark !== x.r.remark),
        );
      const statusChanges = updates.filter((u) => u.old.status !== u.r.status);
      const isCorrection = lock.locked && !created && statusChanges.length > 0;
      if (isCorrection && !input.reason) {
        throw new AppError('VALIDATION_FAILED', 'Give a reason for changing a closed register', {
          fields: { reason: 'Required after the cut-off' },
        });
      }

      if (inserts.length) {
        await tx.insert(rec).values(
          inserts.map((r) => ({
            tenantId: access.tenantId,
            sessionId,
            enrollmentId: r.enrollmentId,
            studentId: byEnrollment.get(r.enrollmentId)!.studentId,
            onDate: date,
            status: r.status,
            remark: r.remark,
          })),
        );
      }
      if (updates.length) {
        const values = sql.join(
          updates.map((u) => sql`(${u.old.id}::uuid, ${u.r.status}, ${u.r.remark})`),
          sql`, `,
        );
        await tx.execute(sql`
          update student_attendance as a set status = v.status, remark = v.remark
          from (values ${values}) as v(id, status, remark)
          where a.tenant_id = ${access.tenantId} and a.id = v.id`);
      }
      if (lock.locked && statusChanges.length) {
        await tx.insert(cor).values(
          statusChanges.map((u) => ({
            tenantId: access.tenantId,
            recordId: u.old.id,
            fromStatus: u.old.status,
            toStatus: u.r.status,
            reason: input.reason ?? 'Corrected',
            correctedBy: access.userId,
          })),
        );
      }
      if (!created && (updates.length || inserts.length)) {
        await tx
          .update(ses)
          .set({ updatedBy: access.userId, updatedAt: now })
          .where(eq(ses.id, sessionId));
      }

      // ATT-06: absence events (daily register, or the first period).
      if (period <= 1) {
        const newlyAbsent = input.records.filter(
          (r) => r.status === 'absent' && existing.get(r.enrollmentId)?.status !== 'absent',
        );
        await this.outbox.emitMany(
          tx,
          { tenantId: access.tenantId, requestId: access.requestId },
          'attendance.absent',
          newlyAbsent.map((r) => ({
            studentId: byEnrollment.get(r.enrollmentId)!.studentId,
            enrollmentId: r.enrollmentId,
            sectionId,
            campusId: s.campusId,
            date,
            period,
          })),
        );
      }

      const counts: Record<string, number> = {};
      for (const r of input.records) counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (created || updates.length || inserts.length) {
        await this.audit.record(tx, access, {
          action: isCorrection ? 'attendance.corrected' : 'attendance.marked',
          entity: 'attendance_session',
          entityId: sessionId,
          campusId: s.campusId,
          diff: {
            sectionId,
            date,
            period,
            counts,
            changed: updates.length,
            ...(isCorrection ? { reason: input.reason, corrected: statusChanges.length } : {}),
          },
        });
      }
      return {
        sessionId,
        created: !!created,
        changed: updates.length + inserts.length - (created ? inserts.length : 0),
        corrected: isCorrection ? statusChanges.length : 0,
        counts,
      };
    });
  }

  /** Correction history of one register. */
  history(access: TenantAccess, sectionId: string, date: string, period: number) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.section(tx, access, sectionId);
        return tx
          .select({
            id: cor.id,
            studentName: sql<string>`trim(${st.firstName} || ' ' || ${st.lastName})`,
            fromStatus: cor.fromStatus,
            toStatus: cor.toStatus,
            reason: cor.reason,
            correctedBy: us.fullName,
            createdAt: cor.createdAt,
          })
          .from(cor)
          .innerJoin(rec, and(eq(rec.tenantId, cor.tenantId), eq(rec.id, cor.recordId)))
          .innerJoin(ses, and(eq(ses.tenantId, rec.tenantId), eq(ses.id, rec.sessionId)))
          .innerJoin(st, and(eq(st.tenantId, rec.tenantId), eq(st.id, rec.studentId)))
          .leftJoin(us, eq(us.id, cor.correctedBy))
          .where(and(eq(ses.sectionId, sectionId), eq(ses.onDate, date), eq(ses.period, period)))
          .orderBy(asc(cor.createdAt));
      },
      { readOnly: true },
    );
  }

  /* -------------------------------------- reports -------------------------------------- */

  /** Monthly register: one row per student, one cell per day. */
  month(access: TenantAccess, sectionId: string, month: string, period?: number) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const { section: s } = await this.section(tx, access, sectionId);
        const settings = await this.settingsFor(tx, s.campusId);
        const p = period ?? (settings.mode === 'period' ? 1 : 0);
        const from = `${month}-01`;
        const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
        const to = last.toISOString().slice(0, 10);
        const { years, events } = await this.calendar(tx, s.campusId, from, to);
        const days = [...eachDate(from, to)].map((d) => describeDay(d, years, events));
        const marked = await tx
          .select({ date: ses.onDate })
          .from(ses)
          .where(
            and(
              eq(ses.sectionId, sectionId),
              eq(ses.period, p),
              gte(ses.onDate, from),
              lte(ses.onDate, to),
            ),
          );
        const rows = await tx
          .select({
            enrollmentId: rec.enrollmentId,
            date: rec.onDate,
            status: rec.status,
          })
          .from(rec)
          .innerJoin(ses, and(eq(ses.tenantId, rec.tenantId), eq(ses.id, rec.sessionId)))
          .where(
            and(
              eq(ses.sectionId, sectionId),
              eq(ses.period, p),
              gte(ses.onDate, from),
              lte(ses.onDate, to),
            ),
          );
        const students = await tx
          .select({
            enrollmentId: en.id,
            studentId: st.id,
            rollNumber: en.rollNumber,
            firstName: st.firstName,
            lastName: st.lastName,
            enrolledOn: en.enrolledOn,
            leftOn: en.leftOn,
          })
          .from(en)
          .innerJoin(st, and(eq(st.tenantId, en.tenantId), eq(st.id, en.studentId)))
          .where(
            and(
              eq(en.sectionId, sectionId),
              lte(en.enrolledOn, to),
              or(isNull(en.leftOn), gte(en.leftOn, from)),
            ),
          )
          .orderBy(sql`${en.rollNumber} asc nulls last`, asc(st.firstName));
        const cells = new Map<string, Record<string, string>>();
        for (const r of rows) {
          const m = cells.get(r.enrollmentId) ?? {};
          m[r.date] = r.status;
          cells.set(r.enrollmentId, m);
        }
        return {
          section: { id: s.id, name: s.name, className: s.className, campusId: s.campusId },
          month,
          period: p,
          settings,
          days,
          markedDates: marked.map((m) => m.date).sort(),
          students: students.map((x) => {
            const m = cells.get(x.enrollmentId) ?? {};
            const statuses = Object.values(m);
            return {
              enrollmentId: x.enrollmentId,
              studentId: x.studentId,
              rollNumber: x.rollNumber,
              name: fullName(x.firstName, x.lastName),
              days: m,
              present: statuses.filter((v) => v === 'present' || v === 'late').length,
              halfDays: statuses.filter((v) => v === 'half_day').length,
              absent: statuses.filter((v) => v === 'absent').length,
              leave: statuses.filter((v) => v === 'leave').length,
              percent: attendancePercent(statuses, settings.leaveCountsAs),
            };
          }),
        };
      },
      { readOnly: true },
    );
  }

  /** Visibility of one student's attendance: through the section they were enrolled in. */
  /** `trusted`: the caller has already checked the student may be seen (parent portal). */
  studentSummary(
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
            sectionId: en.sectionId,
            campusId: en.campusId,
            academicYearId: en.academicYearId,
            yearName: yr.name,
            yearStartsOn: yr.startsOn,
            classTeacher: sec.classTeacherMembershipId,
            sectionName: sec.name,
            className: gl.name,
          })
          .from(en)
          .innerJoin(yr, and(eq(yr.tenantId, en.tenantId), eq(yr.id, en.academicYearId)))
          .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .where(eq(en.studentId, studentId))
          .orderBy(sql`${yr.startsOn} desc`);
        const visible = opts.trusted
          ? enrollments
          : enrollments.filter((e) => this.rights(access, e.campusId, e.classTeacher).view);
        if (!visible.length) throw notFound('Student');
        const chosen = academicYearId
          ? visible.find((e) => e.academicYearId === academicYearId)
          : visible[0];
        if (!chosen) throw notFound('Enrollment');
        const settings = await this.settingsFor(tx, chosen.campusId);
        const p = settings.mode === 'period' ? 1 : 0;
        const rows = await tx
          .select({ date: rec.onDate, status: rec.status, remark: rec.remark })
          .from(rec)
          .innerJoin(ses, and(eq(ses.tenantId, rec.tenantId), eq(ses.id, rec.sessionId)))
          .where(and(eq(rec.enrollmentId, chosen.id), eq(ses.period, p)))
          .orderBy(asc(rec.onDate));
        const byMonth = new Map<string, string[]>();
        for (const r of rows) {
          const m = r.date.slice(0, 7);
          byMonth.set(m, [...(byMonth.get(m) ?? []), r.status]);
        }
        const leaves = await tx
          .select({
            id: lv.id,
            fromDate: lv.fromDate,
            toDate: lv.toDate,
            days: lv.days,
            reason: lv.reason,
            status: lv.status,
          })
          .from(lv)
          .where(and(eq(lv.studentId, studentId), eq(lv.academicYearId, chosen.academicYearId)))
          .orderBy(sql`${lv.fromDate} desc`);
        const all = rows.map((r) => r.status);
        return {
          enrollment: {
            id: chosen.id,
            academicYearId: chosen.academicYearId,
            yearName: chosen.yearName,
            className: chosen.className,
            sectionName: chosen.sectionName,
            sectionId: chosen.sectionId,
          },
          years: visible.map((e) => ({ academicYearId: e.academicYearId, yearName: e.yearName })),
          settings,
          totals: {
            days: all.length,
            present: all.filter((v) => v === 'present' || v === 'late').length,
            late: all.filter((v) => v === 'late').length,
            halfDays: all.filter((v) => v === 'half_day').length,
            absent: all.filter((v) => v === 'absent').length,
            leave: all.filter((v) => v === 'leave').length,
            percent: attendancePercent(all, settings.leaveCountsAs),
          },
          low: (attendancePercent(all, settings.leaveCountsAs) ?? 100) < settings.lowThreshold,
          months: [...byMonth].map(([month, statuses]) => ({
            month,
            days: statuses.length,
            absent: statuses.filter((v) => v === 'absent').length,
            percent: attendancePercent(statuses, settings.leaveCountsAs),
          })),
          records: rows,
          recentAbsences: rows
            .filter((r) => r.status === 'absent')
            .slice(-10)
            .reverse(),
          leaves,
        };
      },
      { readOnly: true },
    );
  }

  /** Sections of a campus the caller may see the attendance of. null = all of them. */
  private ownSectionsOnly(access: TenantAccess, campusId: string): boolean {
    return !access.has('attendance.view', campusId) && !access.has('attendance.correct', campusId);
  }

  private assertAnyAttendance(access: TenantAccess, campusId: string) {
    if (
      !['attendance.view', 'attendance.mark', 'attendance.correct'].some((p) =>
        access.has(p, campusId),
      )
    ) {
      throw notFound('Campus');
    }
  }

  private async campusExists(tx: Transaction, campusId: string) {
    const [row] = await tx
      .select({ id: cp.id, timezone: cp.timezone })
      .from(cp)
      .where(eq(cp.id, campusId));
    if (!row) throw notFound('Campus');
    return row;
  }

  /** Students below the threshold over the year so far. */
  low(
    access: TenantAccess,
    q: { campusId: string; academicYearId: string; threshold?: number; sectionId?: string },
  ) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        this.assertAnyAttendance(access, q.campusId);
        await this.campusExists(tx, q.campusId);
        const settings = await this.settingsFor(tx, q.campusId);
        const threshold = q.threshold ?? settings.lowThreshold;
        const p = settings.mode === 'period' ? 1 : 0;
        const conds: SQL[] = [
          eq(sec.campusId, q.campusId),
          eq(sec.academicYearId, q.academicYearId),
        ];
        if (q.sectionId) conds.push(eq(sec.id, q.sectionId));
        if (this.ownSectionsOnly(access, q.campusId)) {
          conds.push(eq(sec.classTeacherMembershipId, access.membershipId));
        }
        const excluded = settings.leaveCountsAs === 'excluded';
        const rows = await tx
          .select({
            studentId: st.id,
            enrollmentId: en.id,
            name: sql<string>`trim(${st.firstName} || ' ' || ${st.lastName})`,
            admissionNumber: st.admissionNumber,
            rollNumber: en.rollNumber,
            sectionId: sec.id,
            sectionName: sec.name,
            className: gl.name,
            classSort: gl.sortOrder,
            days: excluded
              ? sql<number>`count(${rec.id}) filter (where ${rec.status} <> 'leave')::int`
              : sql<number>`count(${rec.id})::int`,
            absent: sql<number>`count(${rec.id}) filter (where ${rec.status} = 'absent')::int`,
            attended: sql<number>`coalesce(sum(case ${rec.status}
              when 'present' then 1 when 'late' then 1 when 'half_day' then 0.5
              else 0 end), 0)::float`,
          })
          .from(en)
          .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .innerJoin(st, and(eq(st.tenantId, en.tenantId), eq(st.id, en.studentId)))
          .innerJoin(rec, and(eq(rec.tenantId, en.tenantId), eq(rec.enrollmentId, en.id)))
          .innerJoin(
            ses,
            and(eq(ses.tenantId, rec.tenantId), eq(ses.id, rec.sessionId), eq(ses.period, p)),
          )
          .where(and(...conds, eq(en.status, 'active')))
          .groupBy(st.id, en.id, sec.id, gl.id);
        const list = rows
          .map((r) => ({
            ...r,
            percent: r.days ? Math.round((r.attended / r.days) * 1000) / 10 : null,
          }))
          .filter((r) => r.percent !== null && r.percent < threshold)
          .sort(
            (a, b) =>
              a.percent! - b.percent! || a.classSort - b.classSort || a.name.localeCompare(b.name),
          )
          .map(({ classSort: _c, attended: _a, ...r }) => r);
        return { threshold, students: list };
      },
      { readOnly: true },
    );
  }

  /** Today's registers across the campus: which sections are marked, with counts. */
  today(access: TenantAccess, campusId: string, date?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        this.assertAnyAttendance(access, campusId);
        const campus = await this.campusExists(tx, campusId);
        const on = date ?? todayIn(campus.timezone);
        const settings = await this.settingsFor(tx, campusId);
        const day = await this.dayInfo(tx, campusId, on);
        const conds: SQL[] = [eq(sec.campusId, campusId), lte(yr.startsOn, on), gte(yr.endsOn, on)];
        if (this.ownSectionsOnly(access, campusId)) {
          conds.push(eq(sec.classTeacherMembershipId, access.membershipId));
        }
        const sections = await tx
          .select({
            id: sec.id,
            name: sec.name,
            className: gl.name,
            classSort: gl.sortOrder,
            classTeacherMembershipId: sec.classTeacherMembershipId,
            students: sql<number>`(select count(*)::int from student_enrollments e
              where e.tenant_id = ${sec.tenantId} and e.section_id = ${sec.id}
              and e.enrolled_on <= ${on} and (e.left_on is null or e.left_on >= ${on}))`,
          })
          .from(sec)
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .innerJoin(yr, and(eq(yr.tenantId, sec.tenantId), eq(yr.id, sec.academicYearId)))
          .where(and(...conds))
          .orderBy(asc(gl.sortOrder), asc(sec.name));
        const ids = sections.map((x) => x.id);
        const sessions = ids.length
          ? await tx
              .select({
                sectionId: ses.sectionId,
                period: ses.period,
                markedAt: ses.markedAt,
                markedBy: us.fullName,
                present: sql<number>`count(*) filter (where ${rec.status} = 'present')::int`,
                late: sql<number>`count(*) filter (where ${rec.status} = 'late')::int`,
                halfDay: sql<number>`count(*) filter (where ${rec.status} = 'half_day')::int`,
                absent: sql<number>`count(*) filter (where ${rec.status} = 'absent')::int`,
                leave: sql<number>`count(*) filter (where ${rec.status} = 'leave')::int`,
              })
              .from(ses)
              .leftJoin(rec, and(eq(rec.tenantId, ses.tenantId), eq(rec.sessionId, ses.id)))
              .leftJoin(us, eq(us.id, ses.markedBy))
              .where(and(inArray(ses.sectionId, ids), eq(ses.onDate, on)))
              .groupBy(ses.id, us.fullName)
          : [];
        const main = settings.mode === 'period' ? 1 : 0;
        const rows = sections.map((x) => {
          const mine = sessions.filter((z) => z.sectionId === x.id);
          const reg = mine.find((z) => z.period === main) ?? null;
          return {
            sectionId: x.id,
            className: x.className,
            sectionName: x.name,
            students: x.students,
            isMine: x.classTeacherMembershipId === access.membershipId,
            marked: !!reg,
            periodsMarked: mine
              .filter((z) => z.period > 0)
              .map((z) => z.period)
              .sort((a, b) => a - b),
            markedAt: reg?.markedAt ?? null,
            markedBy: reg?.markedBy ?? null,
            counts: reg
              ? {
                  present: reg.present,
                  late: reg.late,
                  halfDay: reg.halfDay,
                  absent: reg.absent,
                  leave: reg.leave,
                }
              : null,
          };
        });
        const marked = rows.filter((r) => r.marked);
        const sum = (k: 'present' | 'late' | 'halfDay' | 'absent' | 'leave') =>
          marked.reduce((n, r) => n + (r.counts?.[k] ?? 0), 0);
        return {
          date: on,
          today: todayIn(campus.timezone),
          day,
          settings,
          totals: {
            sections: rows.length,
            marked: marked.length,
            students: rows.reduce((n, r) => n + r.students, 0),
            present: sum('present'),
            late: sum('late'),
            halfDay: sum('halfDay'),
            absent: sum('absent'),
            leave: sum('leave'),
          },
          sections: rows,
        };
      },
      { readOnly: true },
    );
  }

  /* --------------------------------------- leave --------------------------------------- */

  /** The student's enrollment covering the dates, and whether the caller may handle leave. */
  private async leaveTarget(
    tx: Transaction,
    access: TenantAccess,
    studentId: string,
    from: string,
    to: string,
  ) {
    const rows = await tx
      .select({
        id: en.id,
        campusId: en.campusId,
        academicYearId: en.academicYearId,
        sectionId: en.sectionId,
        classTeacher: sec.classTeacherMembershipId,
        yearStartsOn: yr.startsOn,
        yearEndsOn: yr.endsOn,
        status: en.status,
      })
      .from(en)
      .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
      .innerJoin(yr, and(eq(yr.tenantId, en.tenantId), eq(yr.id, en.academicYearId)))
      .where(and(eq(en.studentId, studentId), lte(yr.startsOn, from), gte(yr.endsOn, from)));
    const e = rows.find((r) => this.rights(access, r.campusId, r.classTeacher).view);
    if (!e) throw notFound('Student');
    if (!this.rights(access, e.campusId, e.classTeacher).mark) {
      throw new AppError(
        'FORBIDDEN',
        'Only the class teacher or attendance managers can record leave',
      );
    }
    if (to > e.yearEndsOn) {
      throw new AppError('VALIDATION_FAILED', 'Leave must end within the academic year', {
        fields: { toDate: `The year ends on ${e.yearEndsOn}` },
      });
    }
    return e;
  }

  createLeave(access: TenantAccess, input: LeaveCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.leaveTarget(tx, access, input.studentId, input.fromDate, input.toDate);
      if (e.status !== 'active') {
        throw new AppError('CONFLICT', 'The student is no longer enrolled');
      }
      await this.assertNoOverlap(tx, input.studentId, input.fromDate, input.toDate);
      const [row] = await tx
        .insert(lv)
        .values({
          tenantId: access.tenantId,
          studentId: input.studentId,
          academicYearId: e.academicYearId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          reason: input.reason,
          requestedVia: input.requestedVia,
          recordedBy: access.userId,
        })
        .returning();
      await this.audit.record(tx, access, {
        action: 'attendance.leave_recorded',
        entity: 'leave_request',
        entityId: row!.id,
        campusId: e.campusId,
        diff: { studentId: input.studentId, fromDate: input.fromDate, toDate: input.toDate },
      });
      return row!;
    });
  }

  async assertNoOverlap(
    tx: Transaction,
    studentId: string,
    from: string,
    to: string,
    except?: string,
  ) {
    const rows = await tx
      .select({ id: lv.id })
      .from(lv)
      .where(
        and(
          eq(lv.studentId, studentId),
          inArray(lv.status, ['pending', 'approved']),
          lte(lv.fromDate, to),
          gte(lv.toDate, from),
          except ? sql`${lv.id} <> ${except}` : undefined,
        ),
      );
    if (rows.length) {
      throw new AppError(
        'CONFLICT',
        'The student already has leave recorded for some of these days',
      );
    }
  }

  listLeave(access: TenantAccess, q: { campusId: string; status?: string; sectionId?: string }) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        this.assertAnyAttendance(access, q.campusId);
        await this.campusExists(tx, q.campusId);
        const conds: SQL[] = [eq(en.campusId, q.campusId)];
        if (q.status) conds.push(eq(lv.status, q.status));
        if (q.sectionId) conds.push(eq(sec.id, q.sectionId));
        if (this.ownSectionsOnly(access, q.campusId)) {
          conds.push(eq(sec.classTeacherMembershipId, access.membershipId));
        }
        const recorder = schema.users;
        const rows = await tx
          .select({
            id: lv.id,
            studentId: lv.studentId,
            studentName: sql<string>`trim(${st.firstName} || ' ' || ${st.lastName})`,
            admissionNumber: st.admissionNumber,
            className: gl.name,
            sectionName: sec.name,
            sectionId: sec.id,
            classTeacher: sec.classTeacherMembershipId,
            fromDate: lv.fromDate,
            toDate: lv.toDate,
            days: lv.days,
            reason: lv.reason,
            requestedVia: lv.requestedVia,
            status: lv.status,
            decisionNote: lv.decisionNote,
            decidedAt: lv.decidedAt,
            createdAt: lv.createdAt,
            recordedBy: recorder.fullName,
          })
          .from(lv)
          .innerJoin(
            en,
            and(
              eq(en.tenantId, lv.tenantId),
              eq(en.studentId, lv.studentId),
              eq(en.academicYearId, lv.academicYearId),
            ),
          )
          .innerJoin(sec, and(eq(sec.tenantId, en.tenantId), eq(sec.id, en.sectionId)))
          .innerJoin(gl, and(eq(gl.tenantId, sec.tenantId), eq(gl.id, sec.gradeLevelId)))
          .innerJoin(st, and(eq(st.tenantId, lv.tenantId), eq(st.id, lv.studentId)))
          .leftJoin(recorder, eq(recorder.id, lv.recordedBy))
          .where(and(...conds))
          .orderBy(sql`${lv.status} = 'pending' desc`, sql`${lv.fromDate} desc`)
          .limit(300);
        return rows.map(({ classTeacher, ...r }) => ({
          ...r,
          canDecide: this.rights(access, q.campusId, classTeacher).mark,
        }));
      },
      { readOnly: true },
    );
  }

  decideLeave(
    access: TenantAccess,
    id: string,
    input: { status: 'approved' | 'rejected' | 'cancelled'; note: string },
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [leave] = await tx.select().from(lv).where(eq(lv.id, id)).for('update');
      if (!leave) throw notFound('Leave request');
      // fromDate twice: only who may decide matters here, not the year-end check.
      const e = await this.leaveTarget(tx, access, leave.studentId, leave.fromDate, leave.fromDate);
      const allowed: Record<string, string[]> = {
        pending: ['approved', 'rejected', 'cancelled'],
        approved: ['cancelled'],
      };
      if (!(allowed[leave.status] ?? []).includes(input.status)) {
        throw new AppError('CONFLICT', `A ${leave.status} request cannot be ${input.status}`);
      }
      if (input.status === 'approved') {
        await this.assertNoOverlap(tx, leave.studentId, leave.fromDate, leave.toDate, leave.id);
      }
      await tx
        .update(lv)
        .set({
          status: input.status,
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: input.note,
        })
        .where(eq(lv.id, id));

      // Registers already taken for those days follow the decision, with history.
      let changed = 0;
      if (
        input.status === 'approved' ||
        (input.status === 'cancelled' && leave.status === 'approved')
      ) {
        const target = input.status === 'approved' ? 'leave' : 'absent';
        const rows = await tx
          .select({ id: rec.id, status: rec.status })
          .from(rec)
          .where(
            and(
              eq(rec.studentId, leave.studentId),
              gte(rec.onDate, leave.fromDate),
              lte(rec.onDate, leave.toDate),
              input.status === 'approved' ? eq(rec.status, 'absent') : eq(rec.status, 'leave'),
            ),
          );
        if (rows.length) {
          await tx
            .update(rec)
            .set({ status: target })
            .where(
              inArray(
                rec.id,
                rows.map((r) => r.id),
              ),
            );
          await tx.insert(cor).values(
            rows.map((r) => ({
              tenantId: access.tenantId,
              recordId: r.id,
              fromStatus: r.status,
              toStatus: target,
              reason: input.status === 'approved' ? 'Leave approved' : 'Leave cancelled',
              correctedBy: access.userId,
            })),
          );
          changed = rows.length;
        }
      }
      await this.audit.record(tx, access, {
        action: `attendance.leave_${input.status}`,
        entity: 'leave_request',
        entityId: id,
        campusId: e.campusId,
        diff: { from: leave.status, to: input.status, recordsChanged: changed },
      });
      return { id, status: input.status, recordsChanged: changed };
    });
  }
}
