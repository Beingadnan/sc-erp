import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { academicTerms, academicYears, gradeLevels, sections, subjects } from './academic.js';
import { campuses, tenants, users } from './platform.js';
import { studentEnrollments } from './students.js';
import { idColumn } from './types.js';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/**
 * One examination for a campus and year: "Periodic Test 1", "Half-yearly", "Annual".
 * draft → open (marks can be entered) → published (parents see results). A published exam can be
 * taken back to open to correct marks.
 */
export const exams = pgTable(
  'exams',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    termId: uuid('term_id'),
    name: text('name').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('exams_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('exams_name_uq').on(t.tenantId, t.campusId, t.academicYearId, t.name),
    foreignKey({
      name: 'exams_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exams_year_fk',
      columns: [t.tenantId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exams_term_fk',
      columns: [t.tenantId, t.termId],
      foreignColumns: [academicTerms.tenantId, academicTerms.id],
    }).onDelete('set null'),
    check('exams_status_chk', sql`${t.status} in ('draft', 'open', 'published')`),
    check(
      'exams_dates_chk',
      sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
  ],
);

/** One subject paper of an exam for one class: the date sheet line and the maximum marks. */
export const examPapers = pgTable(
  'exam_papers',
  {
    id: idColumn(),
    tenantId: tenantId(),
    examId: uuid('exam_id').notNull(),
    gradeLevelId: uuid('grade_level_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    examDate: date('exam_date'),
    startsAt: time('starts_at'),
    maxMarks: integer('max_marks').notNull(),
    passMarks: integer('pass_marks').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('exam_papers_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('exam_papers_subject_uq').on(t.tenantId, t.examId, t.gradeLevelId, t.subjectId),
    foreignKey({
      name: 'exam_papers_exam_fk',
      columns: [t.tenantId, t.examId],
      foreignColumns: [exams.tenantId, exams.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exam_papers_class_fk',
      columns: [t.tenantId, t.gradeLevelId],
      foreignColumns: [gradeLevels.tenantId, gradeLevels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exam_papers_subject_fk',
      columns: [t.tenantId, t.subjectId],
      foreignColumns: [subjects.tenantId, subjects.id],
    }),
    check(
      'exam_papers_marks_chk',
      sql`${t.maxMarks} between 1 and 1000 and ${t.passMarks} between 0 and ${t.maxMarks}`,
    ),
  ],
);

/** A student's marks in one paper. Marks are null when the student was absent or exempt. */
export const examMarks = pgTable(
  'exam_marks',
  {
    id: idColumn(),
    tenantId: tenantId(),
    paperId: uuid('paper_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    marks: numeric('marks', { precision: 6, scale: 1 }),
    /** present | absent | medical | exempt */
    status: text('status').notNull().default('present'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('exam_marks_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('exam_marks_student_uq').on(t.tenantId, t.paperId, t.enrollmentId),
    index('exam_marks_enrollment_idx').on(t.tenantId, t.enrollmentId),
    foreignKey({
      name: 'exam_marks_paper_fk',
      columns: [t.tenantId, t.paperId],
      foreignColumns: [examPapers.tenantId, examPapers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exam_marks_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId],
      foreignColumns: [studentEnrollments.tenantId, studentEnrollments.id],
    }).onDelete('cascade'),
    check('exam_marks_status_chk', sql`${t.status} in ('present', 'absent', 'medical', 'exempt')`),
    check(
      'exam_marks_value_chk',
      sql`(${t.status} = 'present' and ${t.marks} is not null and ${t.marks} >= 0) or (${t.status} <> 'present' and ${t.marks} is null)`,
    ),
  ],
);

/** The subject teacher has handed in a paper's marks for a section; editing is locked until reopened. */
export const examMarkSubmissions = pgTable(
  'exam_mark_submissions',
  {
    id: idColumn(),
    tenantId: tenantId(),
    paperId: uuid('paper_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('exam_mark_submissions_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('exam_mark_submissions_uq').on(t.tenantId, t.paperId, t.sectionId),
    foreignKey({
      name: 'exam_mark_submissions_paper_fk',
      columns: [t.tenantId, t.paperId],
      foreignColumns: [examPapers.tenantId, examPapers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exam_mark_submissions_section_fk',
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [sections.tenantId, sections.id],
    }).onDelete('cascade'),
  ],
);

/** Class teacher's remark for a student on an exam's report card. */
export const examRemarks = pgTable(
  'exam_remarks',
  {
    id: idColumn(),
    tenantId: tenantId(),
    examId: uuid('exam_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    remark: text('remark').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('exam_remarks_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('exam_remarks_uq').on(t.tenantId, t.examId, t.enrollmentId),
    foreignKey({
      name: 'exam_remarks_exam_fk',
      columns: [t.tenantId, t.examId],
      foreignColumns: [exams.tenantId, exams.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exam_remarks_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId],
      foreignColumns: [studentEnrollments.tenantId, studentEnrollments.id],
    }).onDelete('cascade'),
    check('exam_remarks_len_chk', sql`char_length(${t.remark}) between 1 and 400`),
  ],
);
