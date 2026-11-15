import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { campuses, tenantMemberships, tenants } from './platform.js';
import { idColumn, timestamps } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 3 — school structure: academic years & terms, classes (grade levels), sections,
 * subjects, class–subject mapping, calendar, grading scales.
 *
 * Campus consistency is enforced by the database: sections carry campus_id and reference
 * (tenant_id, campus_id, id) of both the academic year and the class, so a section can
 * never join a year of one campus with a class of another.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const academicYears = pgTable(
  'academic_years',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    /** planned → active → closed. Closed years are read-only. */
    status: text('status').notNull().default('planned'),
    /** Days of the week that are always off: 0 = Sunday … 6 = Saturday. */
    weeklyOffDays: smallint('weekly_off_days')
      .array()
      .notNull()
      .default(sql`'{0}'::smallint[]`),
    /** Saturdays of the month that are off, e.g. {2,4} for 2nd and 4th Saturday. */
    saturdayOffWeeks: smallint('saturday_off_weeks')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    ...timestamps,
  },
  (t) => [
    unique('academic_years_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('academic_years_tenant_campus_id_uq').on(t.tenantId, t.campusId, t.id),
    unique('academic_years_tenant_campus_name_uq').on(t.tenantId, t.campusId, t.name),
    uniqueIndex('academic_years_one_current_uq')
      .on(t.tenantId, t.campusId)
      .where(sql`${t.isCurrent}`),
    foreignKey({
      name: 'academic_years_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    check('academic_years_dates_chk', sql`${t.endsOn} > ${t.startsOn}`),
    check('academic_years_length_chk', sql`${t.endsOn} <= ${t.startsOn} + interval '18 months'`),
    check('academic_years_status_chk', sql`${t.status} in ('planned', 'active', 'closed')`),
    check('academic_years_current_chk', sql`not (${t.isCurrent} and ${t.status} = 'closed')`),
    check(
      'academic_years_offdays_chk',
      sql`${t.weeklyOffDays} <@ '{0,1,2,3,4,5,6}'::smallint[] and ${t.saturdayOffWeeks} <@ '{1,2,3,4,5}'::smallint[]`,
    ),
  ],
);

export const academicTerms = pgTable(
  'academic_terms',
  {
    id: idColumn(),
    tenantId: tenantId(),
    academicYearId: uuid('academic_year_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('academic_terms_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('academic_terms_year_name_uq').on(t.tenantId, t.academicYearId, t.name),
    foreignKey({
      name: 'academic_terms_year_fk',
      columns: [t.tenantId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.id],
    }).onDelete('cascade'),
    check('academic_terms_dates_chk', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const gradingScales = pgTable(
  'grading_scales',
  {
    id: idColumn(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    unique('grading_scales_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('grading_scales_tenant_name_uq').on(t.tenantId, t.name),
  ],
);

export const gradingBands = pgTable(
  'grading_bands',
  {
    id: idColumn(),
    tenantId: tenantId(),
    scaleId: uuid('scale_id').notNull(),
    label: text('label').notNull(),
    minPercent: numeric('min_percent', { precision: 5, scale: 2 }).notNull(),
    maxPercent: numeric('max_percent', { precision: 5, scale: 2 }).notNull(),
    gradePoint: numeric('grade_point', { precision: 4, scale: 2 }),
    remark: text('remark').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('grading_bands_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('grading_bands_scale_label_uq').on(t.tenantId, t.scaleId, t.label),
    foreignKey({
      name: 'grading_bands_scale_fk',
      columns: [t.tenantId, t.scaleId],
      foreignColumns: [gradingScales.tenantId, gradingScales.id],
    }).onDelete('cascade'),
    check(
      'grading_bands_range_chk',
      sql`${t.minPercent} >= 0 and ${t.maxPercent} <= 100 and ${t.minPercent} <= ${t.maxPercent}`,
    ),
  ],
);

/** A class such as "Class 5" or "UKG". Called grade level to avoid the TS keyword. */
export const gradeLevels = pgTable(
  'grade_levels',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** pre_primary | primary | middle | secondary | senior_secondary */
    stage: text('stage').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    gradingScaleId: uuid('grading_scale_id'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('grade_levels_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('grade_levels_tenant_campus_id_uq').on(t.tenantId, t.campusId, t.id),
    unique('grade_levels_campus_code_uq').on(t.tenantId, t.campusId, t.code),
    unique('grade_levels_campus_name_uq').on(t.tenantId, t.campusId, t.name),
    foreignKey({
      name: 'grade_levels_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    foreignKey({
      name: 'grade_levels_scale_fk',
      columns: [t.tenantId, t.gradingScaleId],
      foreignColumns: [gradingScales.tenantId, gradingScales.id],
    }),
    check('grade_levels_code_chk', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,9}$'`),
    check(
      'grade_levels_stage_chk',
      sql`${t.stage} in ('pre_primary', 'primary', 'middle', 'secondary', 'senior_secondary')`,
    ),
    check('grade_levels_status_chk', sql`${t.status} in ('active', 'archived')`),
  ],
);

export const sections = pgTable(
  'sections',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    gradeLevelId: uuid('grade_level_id').notNull(),
    name: text('name').notNull(),
    capacity: integer('capacity'),
    room: text('room'),
    classTeacherMembershipId: uuid('class_teacher_membership_id'),
    ...timestamps,
  },
  (t) => [
    unique('sections_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('sections_tenant_campus_year_id_uq').on(t.tenantId, t.campusId, t.academicYearId, t.id),
    unique('sections_year_class_name_uq').on(t.tenantId, t.academicYearId, t.gradeLevelId, t.name),
    foreignKey({
      name: 'sections_year_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.campusId, academicYears.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sections_class_fk',
      columns: [t.tenantId, t.campusId, t.gradeLevelId],
      foreignColumns: [gradeLevels.tenantId, gradeLevels.campusId, gradeLevels.id],
    }),
    foreignKey({
      name: 'sections_class_teacher_fk',
      columns: [t.tenantId, t.classTeacherMembershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }),
    index('sections_year_idx').on(t.tenantId, t.academicYearId),
    check('sections_capacity_chk', sql`${t.capacity} is null or ${t.capacity} between 1 and 200`),
  ],
);

export const subjects = pgTable(
  'subjects',
  {
    id: idColumn(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** scholastic subjects carry marks; co_scholastic ones (art, PE…) carry grades. */
    kind: text('kind').notNull().default('scholastic'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('subjects_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('subjects_tenant_code_uq').on(t.tenantId, t.code),
    check('subjects_code_chk', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,14}$'`),
    check('subjects_kind_chk', sql`${t.kind} in ('scholastic', 'co_scholastic')`),
    check('subjects_status_chk', sql`${t.status} in ('active', 'archived')`),
  ],
);

export const classSubjects = pgTable(
  'class_subjects',
  {
    id: idColumn(),
    tenantId: tenantId(),
    gradeLevelId: uuid('grade_level_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    isOptional: boolean('is_optional').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('class_subjects_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('class_subjects_class_subject_uq').on(t.tenantId, t.gradeLevelId, t.subjectId),
    foreignKey({
      name: 'class_subjects_class_fk',
      columns: [t.tenantId, t.gradeLevelId],
      foreignColumns: [gradeLevels.tenantId, gradeLevels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'class_subjects_subject_fk',
      columns: [t.tenantId, t.subjectId],
      foreignColumns: [subjects.tenantId, subjects.id],
    }),
  ],
);

/** Holidays, vacations, exams and events. campus_id null = every campus. */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id'),
    title: text('title').notNull(),
    /** holiday and vacation days are non-working; event and exam are informational. */
    kind: text('kind').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    description: text('description').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    unique('calendar_events_tenant_id_id_uq').on(t.tenantId, t.id),
    foreignKey({
      name: 'calendar_events_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    index('calendar_events_range_idx').on(t.tenantId, t.startsOn, t.endsOn),
    check('calendar_events_kind_chk', sql`${t.kind} in ('holiday', 'vacation', 'event', 'exam')`),
    check('calendar_events_dates_chk', sql`${t.endsOn} >= ${t.startsOn}`),
    check('calendar_events_length_chk', sql`${t.endsOn} - ${t.startsOn} <= 120`),
  ],
);
