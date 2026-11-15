import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sections, subjects } from './academic.js';
import { campuses, tenantMemberships, tenants, users } from './platform.js';
import { idColumn } from './types.js';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** The school bell for a campus: periods and breaks in order. */
export const periodSlots = pgTable(
  'period_slots',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    seq: smallint('seq').notNull(),
    label: text('label').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    isBreak: boolean('is_break').notNull().default(false),
  },
  (t) => [
    unique('period_slots_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('period_slots_seq_uq').on(t.tenantId, t.campusId, t.seq),
    foreignKey({
      name: 'period_slots_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }).onDelete('cascade'),
    check('period_slots_time_chk', sql`${t.endsAt} > ${t.startsAt}`),
    check('period_slots_seq_chk', sql`${t.seq} between 1 and 100`),
  ],
);

/** One cell of a section's weekly timetable (weekday 1 = Monday … 6 = Saturday). */
export const timetableEntries = pgTable(
  'timetable_entries',
  {
    id: idColumn(),
    tenantId: tenantId(),
    sectionId: uuid('section_id').notNull(),
    weekday: smallint('weekday').notNull(),
    slotId: uuid('slot_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    membershipId: uuid('membership_id'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('timetable_entries_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('timetable_entries_cell_uq').on(t.tenantId, t.sectionId, t.weekday, t.slotId),
    index('timetable_entries_teacher_idx').on(t.tenantId, t.membershipId, t.weekday, t.slotId),
    foreignKey({
      name: 'timetable_entries_section_fk',
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [sections.tenantId, sections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'timetable_entries_slot_fk',
      columns: [t.tenantId, t.slotId],
      foreignColumns: [periodSlots.tenantId, periodSlots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'timetable_entries_subject_fk',
      columns: [t.tenantId, t.subjectId],
      foreignColumns: [subjects.tenantId, subjects.id],
    }),
    foreignKey({
      name: 'timetable_entries_teacher_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('set null'),
    check('timetable_entries_weekday_chk', sql`${t.weekday} between 1 and 7`),
  ],
);

/** A teacher standing in for an absent one, for one period on one day. */
export const substitutions = pgTable(
  'substitutions',
  {
    id: idColumn(),
    tenantId: tenantId(),
    onDate: date('on_date').notNull(),
    entryId: uuid('entry_id').notNull(),
    absentMembershipId: uuid('absent_membership_id'),
    substituteMembershipId: uuid('substitute_membership_id').notNull(),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('substitutions_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('substitutions_entry_day_uq').on(t.tenantId, t.entryId, t.onDate),
    index('substitutions_sub_idx').on(t.tenantId, t.substituteMembershipId, t.onDate),
    foreignKey({
      name: 'substitutions_entry_fk',
      columns: [t.tenantId, t.entryId],
      foreignColumns: [timetableEntries.tenantId, timetableEntries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'substitutions_substitute_fk',
      columns: [t.tenantId, t.substituteMembershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('cascade'),
  ],
);

/** Homework a teacher gives a section in their subject. */
export const homework = pgTable(
  'homework',
  {
    id: idColumn(),
    tenantId: tenantId(),
    sectionId: uuid('section_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    givenOn: date('given_on').notNull(),
    dueOn: date('due_on'),
    title: text('title').notNull(),
    details: text('details').notNull().default(''),
    storageKey: text('storage_key'),
    contentType: text('content_type'),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('homework_tenant_id_id_uq').on(t.tenantId, t.id),
    index('homework_section_idx').on(t.tenantId, t.sectionId, t.givenOn),
    foreignKey({
      name: 'homework_section_fk',
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [sections.tenantId, sections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'homework_subject_fk',
      columns: [t.tenantId, t.subjectId],
      foreignColumns: [subjects.tenantId, subjects.id],
    }),
    check('homework_status_chk', sql`${t.status} in ('active', 'removed')`),
    check('homework_due_chk', sql`${t.dueOn} is null or ${t.dueOn} >= ${t.givenOn}`),
    check('homework_title_chk', sql`length(${t.title}) between 2 and 200`),
  ],
);

/** A notice to parents, staff or both; optionally only some classes or sections. */
export const notices = pgTable(
  'notices',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** everyone | parents | staff */
    audience: text('audience').notNull().default('everyone'),
    gradeLevelIds: uuid('grade_level_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    sectionIds: uuid('section_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** draft → published → archived */
    status: text('status').notNull().default('draft'),
    pinned: boolean('pinned').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    expiresOn: date('expires_on'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notices_tenant_id_id_uq').on(t.tenantId, t.id),
    index('notices_published_idx').on(t.tenantId, t.status, t.publishedAt),
    check('notices_audience_chk', sql`${t.audience} in ('everyone', 'parents', 'staff')`),
    check('notices_status_chk', sql`${t.status} in ('draft', 'published', 'archived')`),
    check('notices_title_chk', sql`length(${t.title}) between 2 and 200`),
  ],
);

export const noticeReads = pgTable(
  'notice_reads',
  {
    id: idColumn(),
    tenantId: tenantId(),
    noticeId: uuid('notice_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    views: integer('views').notNull().default(1),
  },
  (t) => [
    unique('notice_reads_uq').on(t.tenantId, t.noticeId, t.userId),
    foreignKey({
      name: 'notice_reads_notice_fk',
      columns: [t.tenantId, t.noticeId],
      foreignColumns: [notices.tenantId, notices.id],
    }).onDelete('cascade'),
  ],
);
