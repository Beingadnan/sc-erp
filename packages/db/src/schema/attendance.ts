import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { academicYears, sections } from './academic.js';
import { campuses, tenants, users } from './platform.js';
import { studentEnrollments, students } from './students.js';
import { idColumn } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 5 — attendance.
 *
 * A session is one register: a section on a date (period 0 = daily register, 1…n = period
 * register). Each session has one record per enrolled student. Changes after the cut-off
 * are corrections: they need a reason and are kept in attendance_corrections.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'] as const;

/** Per-campus rules. A campus without a row uses the defaults. */
export const attendanceSettings = pgTable(
  'attendance_settings',
  {
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    /** daily | period */
    mode: text('mode').notNull().default('daily'),
    periodsPerDay: smallint('periods_per_day').notNull().default(8),
    /** Hours after first marking during which the marker may still change it freely. */
    cutoffHours: smallint('cutoff_hours').notNull().default(12),
    /** Students below this percentage are listed as low attendance. */
    lowThreshold: smallint('low_threshold').notNull().default(75),
    /** Whether approved leave counts as absent in percentages (CBSE practice) or is left out. */
    leaveCountsAs: text('leave_counts_as').notNull().default('excluded'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('attendance_settings_campus_uq').on(t.tenantId, t.campusId),
    foreignKey({
      name: 'attendance_settings_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    check('attendance_settings_mode_chk', sql`${t.mode} in ('daily', 'period')`),
    check('attendance_settings_periods_chk', sql`${t.periodsPerDay} between 1 and 12`),
    check('attendance_settings_cutoff_chk', sql`${t.cutoffHours} between 0 and 168`),
    check('attendance_settings_threshold_chk', sql`${t.lowThreshold} between 1 and 100`),
    check('attendance_settings_leave_chk', sql`${t.leaveCountsAs} in ('absent', 'excluded')`),
  ],
);

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    onDate: date('on_date').notNull(),
    /** 0 = daily register; 1…12 = period. */
    period: smallint('period').notNull().default(0),
    markedBy: uuid('marked_by').references(() => users.id, { onDelete: 'set null' }),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('attendance_sessions_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('attendance_sessions_slot_uq').on(t.tenantId, t.sectionId, t.onDate, t.period),
    index('attendance_sessions_campus_date_idx').on(t.tenantId, t.campusId, t.onDate),
    foreignKey({
      name: 'attendance_sessions_section_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId, t.sectionId],
      foreignColumns: [sections.tenantId, sections.campusId, sections.academicYearId, sections.id],
    }),
    check('attendance_sessions_period_chk', sql`${t.period} between 0 and 12`),
  ],
);

export const studentAttendance = pgTable(
  'student_attendance',
  {
    id: idColumn(),
    tenantId: tenantId(),
    sessionId: uuid('session_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    studentId: uuid('student_id').notNull(),
    onDate: date('on_date').notNull(),
    status: text('status').notNull(),
    remark: text('remark').notNull().default(''),
  },
  (t) => [
    unique('student_attendance_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('student_attendance_session_enrollment_uq').on(t.tenantId, t.sessionId, t.enrollmentId),
    index('student_attendance_enrollment_date_idx').on(t.tenantId, t.enrollmentId, t.onDate),
    index('student_attendance_student_date_idx').on(t.tenantId, t.studentId, t.onDate),
    foreignKey({
      name: 'student_attendance_session_fk',
      columns: [t.tenantId, t.sessionId],
      foreignColumns: [attendanceSessions.tenantId, attendanceSessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'student_attendance_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId],
      foreignColumns: [studentEnrollments.tenantId, studentEnrollments.id],
    }),
    foreignKey({
      name: 'student_attendance_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    check(
      'student_attendance_status_chk',
      sql`${t.status} in ('present', 'absent', 'late')`,
    ),
    check('student_attendance_remark_chk', sql`length(${t.remark}) <= 200`),
  ],
);

/** Every change after the cut-off (and every leave applied later). Append-only. */
export const attendanceCorrections = pgTable(
  'attendance_corrections',
  {
    id: idColumn(),
    tenantId: tenantId(),
    recordId: uuid('record_id').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    reason: text('reason').notNull(),
    correctedBy: uuid('corrected_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('attendance_corrections_tenant_id_id_uq').on(t.tenantId, t.id),
    index('attendance_corrections_record_idx').on(t.tenantId, t.recordId),
    foreignKey({
      name: 'attendance_corrections_record_fk',
      columns: [t.tenantId, t.recordId],
      foreignColumns: [studentAttendance.tenantId, studentAttendance.id],
    }).onDelete('cascade'),
  ],
);

/** Leave for a student over a date range; approved leave marks them "leave". */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: idColumn(),
    tenantId: tenantId(),
    studentId: uuid('student_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    reason: text('reason').notNull(),
    /** office | phone | parent_app */
    requestedVia: text('requested_via').notNull().default('office'),
    /** pending | approved | rejected | cancelled */
    status: text('status').notNull().default('pending'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    days: integer('days').generatedAlwaysAs(sql`to_date - from_date + 1`),
  },
  (t) => [
    unique('leave_requests_tenant_id_id_uq').on(t.tenantId, t.id),
    index('leave_requests_student_idx').on(t.tenantId, t.studentId, t.fromDate),
    foreignKey({
      name: 'leave_requests_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    foreignKey({
      name: 'leave_requests_year_fk',
      columns: [t.tenantId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.id],
    }),
    check(
      'leave_requests_dates_chk',
      sql`${t.toDate} >= ${t.fromDate} and ${t.toDate} - ${t.fromDate} <= 60`,
    ),
    check(
      'leave_requests_status_chk',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check('leave_requests_via_chk', sql`${t.requestedVia} in ('office', 'phone', 'parent_app')`),
  ],
);
