import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { academicYears } from './academic.js';
import { campuses, tenants, users } from './platform.js';
import { students } from './students.js';
import { idColumn } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 4c — transfer certificates, import jobs and custom field definitions.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/**
 * A transfer certificate. `details` is a snapshot taken at issue time (names, class, dates,
 * reason …) so the printed certificate never changes when the student record is edited.
 */
export const transferCertificates = pgTable(
  'transfer_certificates',
  {
    id: idColumn(),
    tenantId: tenantId(),
    studentId: uuid('student_id').notNull(),
    tcNumber: text('tc_number').notNull(),
    issuedOn: date('issued_on').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    /** issued | cancelled */
    status: text('status').notNull().default('issued'),
    cancelledReason: text('cancelled_reason'),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    unique('transfer_certificates_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('transfer_certificates_number_uq').on(t.tenantId, t.tcNumber),
    uniqueIndex('transfer_certificates_one_issued_uq')
      .on(t.tenantId, t.studentId)
      .where(sql`${t.status} = 'issued'`),
    foreignKey({
      name: 'transfer_certificates_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    check('transfer_certificates_status_chk', sql`${t.status} in ('issued', 'cancelled')`),
    check(
      'transfer_certificates_cancel_chk',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
  ],
);

/** A student import: validated rows wait here until confirmed, then are processed. */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    kind: text('kind').notNull().default('students'),
    /** previewed → processing → completed | failed; or cancelled */
    status: text('status').notNull().default('previewed'),
    fileName: text('file_name').notNull(),
    totalRows: integer('total_rows').notNull(),
    validRows: integer('valid_rows').notNull(),
    /** Normalised, validated rows ready to import. Cleared once processed. */
    rows: jsonb('rows').$type<unknown[]>().notNull().default([]),
    /** Row-level problems found in the preview: [{ row, field, message }]. */
    problems: jsonb('problems').$type<unknown[]>().notNull().default([]),
    /** Outcome per row after processing. */
    report: jsonb('report').$type<unknown[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    unique('import_jobs_tenant_id_id_uq').on(t.tenantId, t.id),
    index('import_jobs_tenant_created_idx').on(t.tenantId, t.createdAt),
    foreignKey({
      name: 'import_jobs_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    foreignKey({
      name: 'import_jobs_year_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.campusId, academicYears.id],
    }),
    check('import_jobs_kind_chk', sql`${t.kind} in ('students')`),
    check(
      'import_jobs_status_chk',
      sql`${t.status} in ('previewed', 'processing', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);

/** School-defined extra fields for students and guardians (CFG-06). */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: idColumn(),
    tenantId: tenantId(),
    /** student | guardian */
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** text | number | date | select */
    fieldType: text('field_type').notNull(),
    options: text('options')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    required: boolean('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('custom_field_definitions_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('custom_field_definitions_key_uq').on(t.tenantId, t.entity, t.key),
    check('custom_field_definitions_entity_chk', sql`${t.entity} in ('student', 'guardian')`),
    check('custom_field_definitions_key_chk', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check(
      'custom_field_definitions_type_chk',
      sql`${t.fieldType} in ('text', 'number', 'date', 'select')`,
    ),
    check(
      'custom_field_definitions_options_chk',
      sql`(${t.fieldType} = 'select') = (cardinality(${t.options}) > 0)`,
    ),
  ],
);
