import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sections, subjects } from './academic.js';
import { tenantMemberships, tenants, users } from './platform.js';
import { idColumn, timestamps } from './types.js';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** School-side details of a staff member (the account itself is global). */
export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: idColumn(),
    tenantId: tenantId(),
    membershipId: uuid('membership_id').notNull(),
    /** e.g. PGT Hindi, Accountant, Driver. */
    designation: text('designation').notNull().default(''),
    employeeCode: text('employee_code'),
    phone: text('phone'),
    joinedOn: date('joined_on'),
    ...timestamps,
  },
  (t) => [
    unique('staff_profiles_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('staff_profiles_membership_uq').on(t.tenantId, t.membershipId),
    uniqueIndex('staff_profiles_code_uq')
      .on(t.tenantId, t.employeeCode)
      .where(sql`${t.employeeCode} is not null`),
    foreignKey({
      name: 'staff_profiles_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('cascade'),
    check(
      'staff_profiles_phone_chk',
      sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
  ],
);

/** Who teaches which subject in which section (the class teacher lives on sections). */
export const teachingAssignments = pgTable(
  'teaching_assignments',
  {
    id: idColumn(),
    tenantId: tenantId(),
    sectionId: uuid('section_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('teaching_assignments_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('teaching_assignments_uq').on(t.tenantId, t.sectionId, t.subjectId, t.membershipId),
    index('teaching_assignments_teacher_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'teaching_assignments_section_fk',
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [sections.tenantId, sections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'teaching_assignments_subject_fk',
      columns: [t.tenantId, t.subjectId],
      foreignColumns: [subjects.tenantId, subjects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'teaching_assignments_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('cascade'),
  ],
);
