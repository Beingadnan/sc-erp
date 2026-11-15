import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { academicYears, gradeLevels } from './academic.js';
import { admissionInquiries } from './cms.js';
import { tenants, users } from './platform.js';
import { students } from './students.js';
import { citext, idColumn, timestamps } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 4b — admission applications, their status history, and documents.
 *
 * Workflow: submitted → under_review → assessment → approved / waitlisted / rejected,
 * then admitted (creates the student) or withdrawn. Every change is an application_event.
 * Documents belong to an application or a student (they move to the student on admission);
 * the file itself lives in object storage (Vercel Blob, private) under storage_key.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const APPLICATION_STATUSES = [
  'submitted',
  'under_review',
  'assessment',
  'approved',
  'waitlisted',
  'rejected',
  'withdrawn',
  'admitted',
] as const;

export const admissionApplications = pgTable(
  'admission_applications',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    gradeLevelId: uuid('grade_level_id').notNull(),
    applicationNumber: text('application_number').notNull(),
    inquiryId: uuid('inquiry_id'),
    /** website | walk_in | phone | referral | other */
    source: text('source').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    dateOfBirth: date('date_of_birth').notNull(),
    gender: text('gender').notNull(),
    previousSchool: text('previous_school'),
    guardianName: text('guardian_name').notNull(),
    guardianPhone: text('guardian_phone').notNull(),
    guardianEmail: citext('guardian_email'),
    guardianRelationship: text('guardian_relationship').notNull(),
    notes: text('notes').notNull().default(''),
    status: text('status').notNull().default('submitted'),
    assessmentAt: timestamp('assessment_at', { withTimezone: true }),
    studentId: uuid('student_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('admission_applications_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('admission_applications_number_uq').on(t.tenantId, t.applicationNumber),
    unique('admission_applications_student_uq').on(t.tenantId, t.studentId),
    index('admission_applications_year_status_idx').on(t.tenantId, t.academicYearId, t.status),
    foreignKey({
      name: 'admission_applications_year_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.campusId, academicYears.id],
    }),
    foreignKey({
      name: 'admission_applications_class_fk',
      columns: [t.tenantId, t.campusId, t.gradeLevelId],
      foreignColumns: [gradeLevels.tenantId, gradeLevels.campusId, gradeLevels.id],
    }),
    foreignKey({
      name: 'admission_applications_inquiry_fk',
      columns: [t.tenantId, t.inquiryId],
      foreignColumns: [admissionInquiries.tenantId, admissionInquiries.id],
    }),
    foreignKey({
      name: 'admission_applications_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    check(
      'admission_applications_status_chk',
      sql`${t.status} in ('submitted','under_review','assessment','approved','waitlisted','rejected','withdrawn','admitted')`,
    ),
    check(
      'admission_applications_admitted_chk',
      sql`(${t.status} = 'admitted') = (${t.studentId} is not null)`,
    ),
    check(
      'admission_applications_source_chk',
      sql`${t.source} in ('website', 'walk_in', 'phone', 'referral', 'other')`,
    ),
    check('admission_applications_gender_chk', sql`${t.gender} in ('male', 'female', 'other')`),
    check('admission_applications_phone_chk', sql`${t.guardianPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

/** Append-only history of an application. */
export const applicationEvents = pgTable(
  'application_events',
  {
    id: idColumn(),
    tenantId: tenantId(),
    applicationId: uuid('application_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note').notNull().default(''),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('application_events_tenant_id_id_uq').on(t.tenantId, t.id),
    index('application_events_application_idx').on(t.tenantId, t.applicationId),
    foreignKey({
      name: 'application_events_application_fk',
      columns: [t.tenantId, t.applicationId],
      foreignColumns: [admissionApplications.tenantId, admissionApplications.id],
    }).onDelete('cascade'),
  ],
);

export const DOCUMENT_TYPES = [
  'birth_certificate',
  'transfer_certificate',
  'report_card',
  'photo',
  'address_proof',
  'aadhaar_card',
  'caste_certificate',
  'medical',
  'other',
] as const;

/** Document types that need students.sensitive.view to open. */
export const SENSITIVE_DOCUMENT_TYPES = ['aadhaar_card', 'caste_certificate', 'medical'] as const;

export const documents = pgTable(
  'documents',
  {
    id: idColumn(),
    tenantId: tenantId(),
    studentId: uuid('student_id'),
    applicationId: uuid('application_id'),
    docType: text('doc_type').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    /** Object key in storage, e.g. "t/<tenant>/d/<document>/<file name>". */
    storageKey: text('storage_key').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Removed: the file is deleted from storage; this record stays for the audit trail. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('documents_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('documents_storage_key_uq').on(t.storageKey),
    index('documents_student_idx').on(t.tenantId, t.studentId),
    index('documents_application_idx').on(t.tenantId, t.applicationId),
    foreignKey({
      name: 'documents_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    foreignKey({
      name: 'documents_application_fk',
      columns: [t.tenantId, t.applicationId],
      foreignColumns: [admissionApplications.tenantId, admissionApplications.id],
    }),
    check('documents_owner_chk', sql`${t.studentId} is not null or ${t.applicationId} is not null`),
    check(
      'documents_type_chk',
      sql`${t.docType} in ('birth_certificate','transfer_certificate','report_card','photo','address_proof','aadhaar_card','caste_certificate','medical','other')`,
    ),
    check(
      'documents_content_type_chk',
      sql`${t.contentType} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')`,
    ),
    check('documents_size_chk', sql`${t.sizeBytes} between 1 and 10485760`),
    check('documents_sha_chk', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
