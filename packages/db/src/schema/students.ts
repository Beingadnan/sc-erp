import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sections } from './academic.js';
import { campuses, tenants, users } from './platform.js';
import { citext, idColumn, timestamps } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 4a — students, guardians, yearly enrollments and admission numbers.
 *
 * A student is a permanent identity (admission number, name, date of birth, identifiers).
 * Each academic year the student has an enrollment in one section. Guardians are shared
 * between siblings through student_guardians.
 *
 * Aadhaar is never stored in clear text: aadhaar_sealed holds the AES-256-GCM ciphertext
 * (bound to the tenant and student), aadhaar_last4 is for masked display and
 * aadhaar_index is a keyed hash (HMAC, per tenant) used only to detect duplicates.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** One row per school: how admission numbers look. */
export const admissionNumberSettings = pgTable(
  'admission_number_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Tokens: {SEQ:n} (required), {YYYY}, {YY}, {CAMPUS}. e.g. "{CAMPUS}/{YYYY}/{SEQ:4}" */
    pattern: text('pattern').notNull().default('{SEQ:4}'),
    /** Separate counters per campus. */
    perCampus: boolean('per_campus').notNull().default(false),
    /** Counter restarts each academic year (needs {YYYY} or {YY} to stay unique). */
    yearlyReset: boolean('yearly_reset').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('admission_number_settings_pattern_chk', sql`${t.pattern} ~ '\\{SEQ:[1-9]\\}'`)],
);

/** Gap-free counters: incremented in the same transaction that uses the number. */
export const numberCounters = pgTable(
  'number_counters',
  {
    tenantId: tenantId(),
    /** e.g. "admission", "admission:<campus>", "admission:<campus>:2026" */
    counterKey: text('counter_key').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'number_counters_pk', columns: [t.tenantId, t.counterKey] }),
    check('number_counters_value_chk', sql`${t.lastValue} >= 0`),
  ],
);

export const students = pgTable(
  'students',
  {
    id: idColumn(),
    tenantId: tenantId(),
    /** Campus the student belongs to (where they are enrolled). */
    campusId: uuid('campus_id').notNull(),
    admissionNumber: text('admission_number').notNull(),
    admissionDate: date('admission_date').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    /** Name in the local script (e.g. Devanagari), for certificates. */
    nameLocal: text('name_local'),
    dateOfBirth: date('date_of_birth').notNull(),
    gender: text('gender').notNull(),
    bloodGroup: text('blood_group'),
    address: text('address'),
    /** Permanent Education Number (UDISE+). */
    pen: text('pen'),
    apaarId: text('apaar_id'),
    aadhaarSealed: text('aadhaar_sealed'),
    aadhaarLast4: text('aadhaar_last4'),
    aadhaarIndex: text('aadhaar_index'),
    /** active | withdrawn | alumni */
    status: text('status').notNull().default('active'),
    /** Values of the school's custom fields (custom_field_definitions), by key. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('students_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('students_tenant_admission_no_uq').on(t.tenantId, t.admissionNumber),
    uniqueIndex('students_tenant_pen_uq')
      .on(t.tenantId, t.pen)
      .where(sql`${t.pen} is not null`),
    uniqueIndex('students_tenant_apaar_uq')
      .on(t.tenantId, t.apaarId)
      .where(sql`${t.apaarId} is not null`),
    uniqueIndex('students_tenant_aadhaar_uq')
      .on(t.tenantId, t.aadhaarIndex)
      .where(sql`${t.aadhaarIndex} is not null`),
    index('students_tenant_name_idx').on(t.tenantId, t.firstName, t.lastName),
    foreignKey({
      name: 'students_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    check('students_gender_chk', sql`${t.gender} in ('male', 'female', 'other')`),
    check('students_status_chk', sql`${t.status} in ('active', 'withdrawn', 'alumni')`),
    check('students_pen_chk', sql`${t.pen} is null or ${t.pen} ~ '^[0-9]{11}$'`),
    check('students_apaar_chk', sql`${t.apaarId} is null or ${t.apaarId} ~ '^[0-9]{12}$'`),
    check(
      'students_aadhaar_chk',
      sql`(${t.aadhaarSealed} is null and ${t.aadhaarLast4} is null and ${t.aadhaarIndex} is null)
          or (${t.aadhaarSealed} is not null and ${t.aadhaarLast4} ~ '^[0-9]{4}$' and ${t.aadhaarIndex} is not null)`,
    ),
    check(
      'students_blood_chk',
      sql`${t.bloodGroup} is null or ${t.bloodGroup} in ('A+','A-','B+','B-','AB+','AB-','O+','O-')`,
    ),
  ],
);

export const guardians = pgTable(
  'guardians',
  {
    id: idColumn(),
    tenantId: tenantId(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: citext('email'),
    occupation: text('occupation'),
    /** Parent-portal login, linked in a later phase. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('guardians_tenant_id_id_uq').on(t.tenantId, t.id),
    index('guardians_tenant_phone_idx').on(t.tenantId, t.phone),
    check('guardians_phone_chk', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

export const studentGuardians = pgTable(
  'student_guardians',
  {
    tenantId: tenantId(),
    studentId: uuid('student_id').notNull(),
    guardianId: uuid('guardian_id').notNull(),
    relationship: text('relationship').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    isFeePayer: boolean('is_fee_payer').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'student_guardians_pk', columns: [t.tenantId, t.studentId, t.guardianId] }),
    uniqueIndex('student_guardians_one_primary_uq')
      .on(t.tenantId, t.studentId)
      .where(sql`${t.isPrimary}`),
    index('student_guardians_guardian_idx').on(t.tenantId, t.guardianId),
    foreignKey({
      name: 'student_guardians_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'student_guardians_guardian_fk',
      columns: [t.tenantId, t.guardianId],
      foreignColumns: [guardians.tenantId, guardians.id],
    }),
    check(
      'student_guardians_relationship_chk',
      sql`${t.relationship} in ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other')`,
    ),
  ],
);

/** One row per student per academic year (section, roll number, status). */
export const studentEnrollments = pgTable(
  'student_enrollments',
  {
    id: idColumn(),
    tenantId: tenantId(),
    studentId: uuid('student_id').notNull(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    rollNumber: integer('roll_number'),
    /** active | promoted | completed | withdrawn */
    status: text('status').notNull().default('active'),
    enrolledOn: date('enrolled_on').notNull(),
    leftOn: date('left_on'),
    /** Why the enrollment ended early (withdrawal). */
    exitReason: text('exit_reason'),
    ...timestamps,
  },
  (t) => [
    unique('student_enrollments_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('student_enrollments_student_year_uq').on(t.tenantId, t.studentId, t.academicYearId),
    uniqueIndex('student_enrollments_roll_uq')
      .on(t.tenantId, t.sectionId, t.rollNumber)
      .where(sql`${t.rollNumber} is not null and ${t.status} = 'active'`),
    index('student_enrollments_section_idx').on(t.tenantId, t.sectionId),
    foreignKey({
      name: 'student_enrollments_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }).onDelete('cascade'),
    // The section must belong to the same campus and academic year as the enrollment.
    foreignKey({
      name: 'student_enrollments_section_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId, t.sectionId],
      foreignColumns: [sections.tenantId, sections.campusId, sections.academicYearId, sections.id],
    }),
    check(
      'student_enrollments_status_chk',
      sql`${t.status} in ('active', 'promoted', 'completed', 'withdrawn')`,
    ),
    check(
      'student_enrollments_roll_chk',
      sql`${t.rollNumber} is null or ${t.rollNumber} between 1 and 999`,
    ),
    check(
      'student_enrollments_left_chk',
      sql`${t.leftOn} is null or ${t.leftOn} >= ${t.enrolledOn}`,
    ),
  ],
);

/** Guardian's acknowledgement of the school's privacy notice (DPDP). Append-only. */
export const privacyAcknowledgements = pgTable(
  'privacy_acknowledgements',
  {
    id: idColumn(),
    tenantId: tenantId(),
    guardianId: uuid('guardian_id').notNull(),
    studentId: uuid('student_id'),
    noticeVersion: text('notice_version').notNull(),
    /** in_person | web | app | phone */
    channel: text('channel').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('privacy_acknowledgements_tenant_id_id_uq').on(t.tenantId, t.id),
    index('privacy_acknowledgements_guardian_idx').on(t.tenantId, t.guardianId),
    foreignKey({
      name: 'privacy_ack_guardian_fk',
      columns: [t.tenantId, t.guardianId],
      foreignColumns: [guardians.tenantId, guardians.id],
    }),
    foreignKey({
      name: 'privacy_ack_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }).onDelete('cascade'),
    check('privacy_ack_channel_chk', sql`${t.channel} in ('in_person', 'web', 'app', 'phone')`),
  ],
);
