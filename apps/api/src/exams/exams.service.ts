import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { CBSE_BANDS, gradeFor, rankScores } from '@school-erp/validation';
import type {
  ExamCreateInput,
  ExamPapersInput,
  ExamUpdateInput,
  GradeBand,
  MarksEntryInput,
  MarkStatus,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { renderReportCardPdf } from './report-card-pdf.js';

type ExamStatus = 'draft' | 'open' | 'published';
interface ExamRow {
  id: string;
  campusId: string;
  academicYearId: string;
  name: string;
  status: ExamStatus;
}
interface Paper {
  id: string;
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  examDate: string | null;
}

export interface SubjectResult {
  paperId: string;
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  marks: number | null;
  status: MarkStatus | null;
  grade: string | null;
  passed: boolean | null;
}
export interface StudentResult {
  enrollmentId: string;
  studentId: string;
  name: string;
  admissionNumber: string;
  rollNumber: number | null;
  subjects: SubjectResult[];
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  failedIn: string[];
  complete: boolean;
  rank: number | null;
  remark: string;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Exams the way schools run them: an exam (PT-1, Half-yearly…) has a date sheet per class with
 * maximum and pass marks; subject teachers enter marks for their own classes and hand them in;
 * the office publishes results, and parents then see marks and the report card.
 */
@Injectable()
export class ExamsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /* -------------------------------------------- helpers -------------------------------------------- */

  private async exam(tx: Transaction, id: string): Promise<ExamRow> {
    const [e] = await tx
      .select({
        id: schema.exams.id,
        campusId: schema.exams.campusId,
        academicYearId: schema.exams.academicYearId,
        name: schema.exams.name,
        status: schema.exams.status,
      })
      .from(schema.exams)
      .where(eq(schema.exams.id, id));
    if (!e) throw notFound('Exam');
    return e as ExamRow;
  }

  private manage(access: TenantAccess, campusId: string) {
    if (!access.has('exams.manage', campusId)) {
      throw new AppError('FORBIDDEN', 'Only the exam in-charge can change exams');
    }
  }

  private async currentYear(tx: Transaction, campusId: string) {
    const [y] = (
      await tx.execute(sql`
        select id from academic_years where campus_id = ${campusId} and is_current limit 1`)
    ).rows as Array<{ id: string }>;
    if (!y) throw new AppError('CONFLICT', 'Set the current academic year first');
    return y.id;
  }

  /** The section with what this person may do there. */
  private async section(tx: Transaction, access: TenantAccess, sectionId: string) {
    const [s] = (
      await tx.execute(sql`
        select s.id, s.name, s.campus_id as "campusId", s.academic_year_id as "academicYearId",
          s.grade_level_id as "gradeLevelId", g.name as "className", g.grading_scale_id as "scaleId",
          coalesce(s.class_teacher_membership_id = ${access.membershipId}, false) as "isClassTeacher",
          exists (select 1 from teaching_assignments a where a.tenant_id = s.tenant_id and a.section_id = s.id
                    and a.membership_id = ${access.membershipId}) as teaches
        from sections s join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
        where s.id = ${sectionId}`)
    ).rows as Array<{
      id: string;
      name: string;
      campusId: string;
      academicYearId: string;
      gradeLevelId: string;
      className: string;
      scaleId: string | null;
      isClassTeacher: boolean;
      teaches: boolean;
    }>;
    // Teachers also have academic.view; whole-class results are for the office and the class teacher.
    const office =
      !!s && (access.has('academic.manage', s.campusId) || access.has('exams.manage', s.campusId));
    if (!s || (!office && !s.isClassTeacher && !s.teaches)) throw notFound('Section');
    return { ...s, office };
  }

  private async bands(tx: Transaction, scaleId: string | null): Promise<GradeBand[]> {
    if (!scaleId) return CBSE_BANDS;
    const rows = (
      await tx.execute(sql`
        select label, min_percent as "minPercent", max_percent as "maxPercent", remark
        from grading_bands where scale_id = ${scaleId} order by min_percent desc`)
    ).rows as Array<{ label: string; minPercent: string; maxPercent: string; remark: string }>;
    return rows.length
      ? rows.map((r) => ({
          ...r,
          minPercent: Number(r.minPercent),
          maxPercent: Number(r.maxPercent),
        }))
      : CBSE_BANDS;
  }

  private async papersOf(tx: Transaction, examId: string, gradeLevelId: string): Promise<Paper[]> {
    return (
      await tx.execute(sql`
        select p.id, p.subject_id as "subjectId", sub.name as "subjectName", p.max_marks as "maxMarks",
          p.pass_marks as "passMarks", p.exam_date::text as "examDate"
        from exam_papers p join subjects sub on sub.tenant_id = p.tenant_id and sub.id = p.subject_id
        where p.exam_id = ${examId} and p.grade_level_id = ${gradeLevelId}
        order by p.sort_order, sub.name`)
    ).rows as unknown as Paper[];
  }

  /* --------------------------------------------- exams --------------------------------------------- */

  list(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const yearId = await this.currentYear(tx, campusId);
        const items = (
          await tx.execute(sql`
            select e.id, e.name, e.status, e.starts_on::text as "startsOn", e.ends_on::text as "endsOn",
              e.published_at as "publishedAt", t.name as "termName",
              (select count(*)::int from exam_papers p where p.exam_id = e.id) as papers,
              (select count(distinct p.grade_level_id)::int from exam_papers p where p.exam_id = e.id) as classes,
              (select count(*)::int from exam_mark_submissions m join exam_papers p
                 on p.tenant_id = m.tenant_id and p.id = m.paper_id where p.exam_id = e.id) as submitted,
              (select count(*)::int from exam_papers p join sections s on s.tenant_id = p.tenant_id
                 and s.grade_level_id = p.grade_level_id and s.academic_year_id = e.academic_year_id
                 where p.exam_id = e.id) as "toSubmit"
            from exams e left join academic_terms t on t.tenant_id = e.tenant_id and t.id = e.term_id
            where e.campus_id = ${campusId} and e.academic_year_id = ${yearId}
            order by coalesce(e.starts_on, e.created_at::date), e.created_at`)
        ).rows;
        return { canManage: access.has('exams.manage', campusId), items };
      },
      { readOnly: true },
    );
  }

  create(access: TenantAccess, input: ExamCreateInput) {
    this.manage(access, input.campusId);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const yearId = await this.currentYear(tx, input.campusId);
      const id = newId();
      try {
        await tx.insert(schema.exams).values({
          id,
          tenantId: access.tenantId,
          campusId: input.campusId,
          academicYearId: yearId,
          termId: input.termId,
          name: input.name,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          createdBy: access.userId,
        });
      } catch (e) {
        if (
          String(
            (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code,
          ) === '23505'
        ) {
          throw new AppError(
            'CONFLICT',
            `There is already an exam called "${input.name}" this year`,
          );
        }
        throw e;
      }
      await this.audit.record(tx, access, {
        action: 'exam.created',
        entity: 'exam',
        entityId: id,
        campusId: input.campusId,
        diff: { name: input.name },
      });
      return { id };
    });
  }

  update(access: TenantAccess, id: string, input: ExamUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.exam(tx, id);
      this.manage(access, e.campusId);
      await tx
        .update(schema.exams)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.exams.id, id));
      return { id };
    });
  }

  setStatus(access: TenantAccess, id: string, status: ExamStatus) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.exam(tx, id);
      this.manage(access, e.campusId);
      if (e.status === status) return { id, status };
      const [{ papers, marks }] = (
        await tx.execute(sql`
          select (select count(*)::int from exam_papers where exam_id = ${id}) as papers,
            (select count(*)::int from exam_marks m join exam_papers p on p.tenant_id = m.tenant_id
               and p.id = m.paper_id where p.exam_id = ${id}) as marks`)
      ).rows as [{ papers: number; marks: number }];
      if (status !== 'draft' && !papers) {
        throw new AppError('CONFLICT', 'Add the date sheet (subjects and marks) first');
      }
      if (status === 'draft' && marks) {
        throw new AppError('CONFLICT', 'Marks have been entered; the exam cannot go back to draft');
      }
      if (status === 'published' && !marks) {
        throw new AppError('CONFLICT', 'No marks have been entered yet');
      }
      await tx
        .update(schema.exams)
        .set({
          status,
          publishedAt: status === 'published' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.exams.id, id));
      await this.audit.record(tx, access, {
        action: `exam.${status === 'published' ? 'results_published' : status === 'open' && e.status === 'published' ? 'results_withdrawn' : status}`,
        entity: 'exam',
        entityId: id,
        campusId: e.campusId,
        diff: { from: e.status, to: status },
      });
      return { id, status };
    });
  }

  remove(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.exam(tx, id);
      this.manage(access, e.campusId);
      if (e.status !== 'draft') {
        throw new AppError('CONFLICT', 'Only a draft exam can be deleted');
      }
      await tx.delete(schema.exams).where(eq(schema.exams.id, id));
      await this.audit.record(tx, access, {
        action: 'exam.deleted',
        entity: 'exam',
        entityId: id,
        campusId: e.campusId,
        diff: { name: e.name },
      });
      return { id };
    });
  }

  /** The exam with each class's date sheet and how far marks entry has got. */
  detail(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const e = await this.exam(tx, id);
        if (!access.has('academic.view', e.campusId) && !access.has('exams.manage', e.campusId)) {
          throw notFound('Exam');
        }
        const [meta] = (
          await tx.execute(sql`
            select e.name, e.status, e.term_id as "termId", e.starts_on::text as "startsOn",
              e.ends_on::text as "endsOn", e.published_at as "publishedAt"
            from exams e where e.id = ${id}`)
        ).rows;
        const classes = (
          await tx.execute(sql`
            select g.id, g.name, g.sort_order as "sortOrder",
              coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name) order by s.name)
                from sections s where s.tenant_id = g.tenant_id and s.grade_level_id = g.id
                  and s.academic_year_id = ${e.academicYearId}), '[]') as sections,
              coalesce((select json_agg(json_build_object('id', sub.id, 'name', sub.name) order by sub.name)
                from class_subjects cs join subjects sub on sub.tenant_id = cs.tenant_id and sub.id = cs.subject_id
                where cs.tenant_id = g.tenant_id and cs.grade_level_id = g.id), '[]') as subjects
            from grade_levels g where g.campus_id = ${e.campusId} and g.status = 'active'
            order by g.sort_order, g.name`)
        ).rows as Array<{
          id: string;
          name: string;
          sections: Array<{ id: string; name: string }>;
        }>;
        const papers = (
          await tx.execute(sql`
            select p.id, p.grade_level_id as "gradeLevelId", p.subject_id as "subjectId", sub.name as "subjectName",
              p.exam_date::text as "examDate", to_char(p.starts_at, 'HH24:MI') as "startsAt",
              p.max_marks as "maxMarks", p.pass_marks as "passMarks"
            from exam_papers p join subjects sub on sub.tenant_id = p.tenant_id and sub.id = p.subject_id
            where p.exam_id = ${id} order by p.sort_order, sub.name`)
        ).rows as Array<{ id: string; gradeLevelId: string }>;
        const progress = (
          await tx.execute(sql`
            select p.id as "paperId", s.id as "sectionId",
              (select count(*)::int from student_enrollments en where en.tenant_id = s.tenant_id
                 and en.section_id = s.id and en.status = 'active') as students,
              (select count(*)::int from exam_marks m join student_enrollments en on en.tenant_id = m.tenant_id
                 and en.id = m.enrollment_id where m.paper_id = p.id and en.section_id = s.id and en.status = 'active') as entered,
              exists (select 1 from exam_mark_submissions x where x.tenant_id = p.tenant_id
                 and x.paper_id = p.id and x.section_id = s.id) as submitted,
              (select string_agg(u.full_name, ', ' order by u.full_name) from teaching_assignments a
                 join tenant_memberships m on m.tenant_id = a.tenant_id and m.id = a.membership_id
                 join users u on u.id = m.user_id
                 where a.tenant_id = s.tenant_id and a.section_id = s.id and a.subject_id = p.subject_id) as teacher
            from exam_papers p join sections s on s.tenant_id = p.tenant_id and s.grade_level_id = p.grade_level_id
              and s.academic_year_id = ${e.academicYearId}
            where p.exam_id = ${id}`)
        ).rows;
        return {
          id,
          ...meta,
          canManage: access.has('exams.manage', e.campusId),
          classes: classes.map((c) => ({
            ...c,
            papers: papers.filter((p) => p.gradeLevelId === c.id),
          })),
          progress,
        };
      },
      { readOnly: true },
    );
  }

  /** Replace one class's date sheet. Papers that already have marks cannot be removed. */
  setPapers(access: TenantAccess, examId: string, input: ExamPapersInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.exam(tx, examId);
      this.manage(access, e.campusId);
      if (e.status === 'published') {
        throw new AppError(
          'CONFLICT',
          'Results are published; take them back before changing the date sheet',
        );
      }
      const [g] = (
        await tx.execute(
          sql`select id, name from grade_levels where id = ${input.gradeLevelId} and campus_id = ${e.campusId}`,
        )
      ).rows as Array<{ id: string; name: string }>;
      if (!g) throw notFound('Class');
      const allowed = new Set(
        (
          (
            await tx.execute(
              sql`select subject_id as id from class_subjects where grade_level_id = ${g.id}`,
            )
          ).rows as Array<{ id: string }>
        ).map((r) => r.id),
      );
      const bad = input.papers.find((p) => !allowed.has(p.subjectId));
      if (bad) throw new AppError('VALIDATION_FAILED', `A subject is not taught in ${g.name}`);

      const existing = (
        await tx.execute(sql`
          select p.id, p.subject_id as "subjectId", sub.name as "subjectName",
            (select max(m.marks) from exam_marks m where m.paper_id = p.id) as "topMark",
            (select count(*)::int from exam_marks m where m.paper_id = p.id) as marks
          from exam_papers p join subjects sub on sub.tenant_id = p.tenant_id and sub.id = p.subject_id
          where p.exam_id = ${examId} and p.grade_level_id = ${g.id}`)
      ).rows as Array<{
        id: string;
        subjectId: string;
        subjectName: string;
        topMark: string | null;
        marks: number;
      }>;
      const keep = new Set(input.papers.map((p) => p.subjectId));
      for (const x of existing) {
        if (!keep.has(x.subjectId) && x.marks) {
          throw new AppError(
            'CONFLICT',
            `${x.subjectName} already has marks; it cannot be removed`,
          );
        }
      }
      for (const [i, p] of input.papers.entries()) {
        const old = existing.find((x) => x.subjectId === p.subjectId);
        if (old && old.topMark !== null && Number(old.topMark) > p.maxMarks) {
          throw new AppError(
            'CONFLICT',
            `${old.subjectName}: a student already has ${Number(old.topMark)} marks, more than ${p.maxMarks}`,
          );
        }
        const values = {
          examDate: p.examDate,
          startsAt: p.startsAt,
          maxMarks: p.maxMarks,
          passMarks: p.passMarks,
          sortOrder: i,
        };
        if (old) {
          await tx.update(schema.examPapers).set(values).where(eq(schema.examPapers.id, old.id));
        } else {
          await tx.insert(schema.examPapers).values({
            id: newId(),
            tenantId: access.tenantId,
            examId,
            gradeLevelId: g.id,
            subjectId: p.subjectId,
            ...values,
          });
        }
      }
      const gone = existing.filter((x) => !keep.has(x.subjectId)).map((x) => x.id);
      for (const pid of gone)
        await tx.delete(schema.examPapers).where(eq(schema.examPapers.id, pid));
      await this.audit.record(tx, access, {
        action: 'exam.date_sheet_changed',
        entity: 'exam',
        entityId: examId,
        campusId: e.campusId,
        diff: { class: g.name, papers: input.papers.length, removed: gone.length },
      });
      return { papers: await this.papersOf(tx, examId, g.id) };
    });
  }

  /* ----------------------------------------- marks entry ------------------------------------------ */

  /** The marks a teacher has to enter: their subjects in their classes, in open exams. */
  mine(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => ({
        items: (
          await tx.execute(sql`
            select e.id as "examId", e.name as "examName", p.id as "paperId", s.id as "sectionId",
              g.name as "className", s.name as "sectionName", sub.name as "subjectName",
              p.exam_date::text as "examDate", p.max_marks as "maxMarks",
              (select count(*)::int from student_enrollments en where en.tenant_id = s.tenant_id
                 and en.section_id = s.id and en.status = 'active') as students,
              (select count(*)::int from exam_marks m join student_enrollments en on en.tenant_id = m.tenant_id
                 and en.id = m.enrollment_id where m.paper_id = p.id and en.section_id = s.id and en.status = 'active') as entered,
              exists (select 1 from exam_mark_submissions x where x.tenant_id = p.tenant_id
                 and x.paper_id = p.id and x.section_id = s.id) as submitted
            from teaching_assignments a
            join sections s on s.tenant_id = a.tenant_id and s.id = a.section_id
            join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
            join exams e on e.tenant_id = s.tenant_id and e.academic_year_id = s.academic_year_id and e.status = 'open'
            join exam_papers p on p.tenant_id = e.tenant_id and p.exam_id = e.id
              and p.grade_level_id = s.grade_level_id and p.subject_id = a.subject_id
            join subjects sub on sub.tenant_id = p.tenant_id and sub.id = p.subject_id
            where a.membership_id = ${access.membershipId}
            order by e.created_at, p.exam_date nulls last, g.sort_order, s.name, sub.name`)
        ).rows,
      }),
      { readOnly: true },
    );
  }

  private async paperIn(tx: Transaction, access: TenantAccess, paperId: string, sectionId: string) {
    const s = await this.section(tx, access, sectionId);
    const [p] = (
      await tx.execute(sql`
        select p.id, p.exam_id as "examId", p.subject_id as "subjectId", sub.name as "subjectName",
          p.max_marks as "maxMarks", p.pass_marks as "passMarks", p.exam_date::text as "examDate",
          e.name as "examName", e.status, e.academic_year_id as "yearId",
          exists (select 1 from teaching_assignments a where a.tenant_id = p.tenant_id and a.section_id = ${sectionId}
                    and a.subject_id = p.subject_id and a.membership_id = ${access.membershipId}) as "isTeacher",
          (select json_build_object('at', x.submitted_at, 'by', u.full_name) from exam_mark_submissions x
             left join users u on u.id = x.submitted_by
             where x.tenant_id = p.tenant_id and x.paper_id = p.id and x.section_id = ${sectionId}) as submission
        from exam_papers p
        join exams e on e.tenant_id = p.tenant_id and e.id = p.exam_id
        join subjects sub on sub.tenant_id = p.tenant_id and sub.id = p.subject_id
        where p.id = ${paperId} and p.grade_level_id = ${s.gradeLevelId}`)
    ).rows as Array<{
      id: string;
      examId: string;
      subjectId: string;
      subjectName: string;
      maxMarks: number;
      passMarks: number;
      examDate: string | null;
      examName: string;
      status: ExamStatus;
      yearId: string;
      isTeacher: boolean;
      submission: { at: string; by: string | null } | null;
    }>;
    if (!p || p.yearId !== s.academicYearId) throw notFound('Paper');
    const manager = access.has('exams.manage', s.campusId);
    const canEnter = p.isTeacher || manager;
    return {
      s,
      p,
      manager,
      canEnter,
      canEdit: canEnter && p.status === 'open' && !p.submission,
    };
  }

  sheet(access: TenantAccess, paperId: string, sectionId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const { s, p, canEdit, canEnter, manager } = await this.paperIn(
          tx,
          access,
          paperId,
          sectionId,
        );
        if (!canEnter && !s.office && !s.isClassTeacher) throw notFound('Paper');
        const students = (
          await tx.execute(sql`
            select en.id as "enrollmentId", en.roll_number as "rollNumber",
              trim(st.first_name || ' ' || st.last_name) as name, st.admission_number as "admissionNumber",
              m.marks, m.status
            from student_enrollments en
            join students st on st.tenant_id = en.tenant_id and st.id = en.student_id
            left join exam_marks m on m.tenant_id = en.tenant_id and m.enrollment_id = en.id and m.paper_id = ${paperId}
            where en.section_id = ${sectionId} and en.status = 'active'
            order by en.roll_number nulls last, st.first_name, st.last_name`)
        ).rows as Array<{ marks: string | null }>;
        return {
          exam: { id: p.examId, name: p.examName, status: p.status },
          paper: {
            id: p.id,
            subjectName: p.subjectName,
            maxMarks: p.maxMarks,
            passMarks: p.passMarks,
            examDate: p.examDate,
          },
          section: { id: s.id, name: s.name, className: s.className },
          submission: p.submission,
          canEdit,
          canReopen: manager && !!p.submission && p.status === 'open',
          students: students.map((r) => ({ ...r, marks: n(r.marks) })),
        };
      },
      { readOnly: true },
    );
  }

  saveMarks(access: TenantAccess, paperId: string, sectionId: string, input: MarksEntryInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { s, p, canEdit, canEnter } = await this.paperIn(tx, access, paperId, sectionId);
      if (!canEnter)
        throw new AppError('FORBIDDEN', 'You can enter marks only for the subjects you teach');
      if (p.status !== 'open') {
        throw new AppError(
          'CONFLICT',
          p.status === 'draft'
            ? 'Marks entry has not started for this exam'
            : 'Results are published; marks are locked',
        );
      }
      if (!canEdit)
        throw new AppError(
          'CONFLICT',
          'These marks were handed in; ask the exam in-charge to reopen them',
        );
      const roster = new Set(
        (
          (
            await tx.execute(sql`
            select id from student_enrollments where section_id = ${sectionId} and status = 'active'`)
          ).rows as Array<{ id: string }>
        ).map((r) => r.id),
      );
      let saved = 0;
      for (const m of input.marks) {
        if (!roster.has(m.enrollmentId))
          throw new AppError('VALIDATION_FAILED', 'A student is not in this class');
        if (m.marks !== null && m.marks > p.maxMarks) {
          throw new AppError('VALIDATION_FAILED', `Marks cannot be more than ${p.maxMarks}`, {
            fields: { [m.enrollmentId]: `More than ${p.maxMarks}` },
          });
        }
        if (m.status === 'present' && m.marks === null) {
          await tx.execute(
            sql`delete from exam_marks where paper_id = ${paperId} and enrollment_id = ${m.enrollmentId}`,
          );
          continue;
        }
        await tx.execute(sql`
          insert into exam_marks (id, tenant_id, paper_id, enrollment_id, marks, status, updated_by)
          values (${newId()}, ${access.tenantId}, ${paperId}, ${m.enrollmentId}, ${m.marks}, ${m.status}, ${access.userId})
          on conflict (tenant_id, paper_id, enrollment_id) do update
            set marks = excluded.marks, status = excluded.status, updated_by = excluded.updated_by, updated_at = now()`);
        saved++;
      }
      void s;
      return { saved };
    });
  }

  submit(access: TenantAccess, paperId: string, sectionId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { s, p, canEdit, canEnter } = await this.paperIn(tx, access, paperId, sectionId);
      if (!canEnter)
        throw new AppError('FORBIDDEN', 'You can hand in marks only for the subjects you teach');
      if (!canEdit) throw new AppError('CONFLICT', 'These marks cannot be handed in now');
      const [{ missing }] = (
        await tx.execute(sql`
          select count(*)::int as missing from student_enrollments en
          where en.section_id = ${sectionId} and en.status = 'active'
            and not exists (select 1 from exam_marks m where m.tenant_id = en.tenant_id
                              and m.paper_id = ${paperId} and m.enrollment_id = en.id)`)
      ).rows as [{ missing: number }];
      if (missing) {
        throw new AppError(
          'CONFLICT',
          `${missing} student${missing === 1 ? ' has' : 's have'} no marks yet. Mark absent students as Absent.`,
        );
      }
      await tx.insert(schema.examMarkSubmissions).values({
        id: newId(),
        tenantId: access.tenantId,
        paperId,
        sectionId,
        submittedBy: access.userId,
      });
      await this.audit.record(tx, access, {
        action: 'exam.marks_submitted',
        entity: 'exam',
        entityId: p.examId,
        campusId: s.campusId,
        diff: { paper: p.subjectName, section: `${s.className} ${s.name}` },
      });
      return { submitted: true };
    });
  }

  reopen(access: TenantAccess, paperId: string, sectionId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const { s, p, manager } = await this.paperIn(tx, access, paperId, sectionId);
      if (!manager) throw new AppError('FORBIDDEN', 'Only the exam in-charge can reopen marks');
      if (p.status === 'published')
        throw new AppError('CONFLICT', 'Take back the published results first');
      await tx.execute(
        sql`delete from exam_mark_submissions where paper_id = ${paperId} and section_id = ${sectionId}`,
      );
      await this.audit.record(tx, access, {
        action: 'exam.marks_reopened',
        entity: 'exam',
        entityId: p.examId,
        campusId: s.campusId,
        diff: { paper: p.subjectName, section: `${s.className} ${s.name}` },
      });
      return { submitted: false };
    });
  }

  /* -------------------------------------------- results -------------------------------------------- */

  /** Marks of every student in a section for an exam: totals, grades, rank and remarks. */
  async computeSection(
    tx: Transaction,
    examId: string,
    sectionId: string,
    scaleId: string | null,
    gradeLevelId: string,
  ) {
    const papers = await this.papersOf(tx, examId, gradeLevelId);
    const bands = await this.bands(tx, scaleId);
    const students = (
      await tx.execute(sql`
        select en.id as "enrollmentId", st.id as "studentId", en.roll_number as "rollNumber",
          trim(st.first_name || ' ' || st.last_name) as name, st.admission_number as "admissionNumber",
          coalesce(r.remark, '') as remark
        from student_enrollments en
        join students st on st.tenant_id = en.tenant_id and st.id = en.student_id
        left join exam_remarks r on r.tenant_id = en.tenant_id and r.enrollment_id = en.id and r.exam_id = ${examId}
        where en.section_id = ${sectionId} and en.status = 'active'
        order by en.roll_number nulls last, st.first_name, st.last_name`)
    ).rows as Array<{
      enrollmentId: string;
      studentId: string;
      rollNumber: number | null;
      name: string;
      admissionNumber: string;
      remark: string;
    }>;
    const marks = (
      await tx.execute(sql`
        select m.paper_id as "paperId", m.enrollment_id as "enrollmentId", m.marks, m.status
        from exam_marks m join exam_papers p on p.tenant_id = m.tenant_id and p.id = m.paper_id
        join student_enrollments en on en.tenant_id = m.tenant_id and en.id = m.enrollment_id
        where p.exam_id = ${examId} and en.section_id = ${sectionId}`)
    ).rows as Array<{
      paperId: string;
      enrollmentId: string;
      marks: string | null;
      status: MarkStatus;
    }>;
    const key = (e: string, p: string) => `${e}:${p}`;
    const byKey = new Map(marks.map((m) => [key(m.enrollmentId, m.paperId), m]));

    const results: StudentResult[] = students.map((st) => {
      let total = 0;
      let maxTotal = 0;
      let complete = true;
      const failedIn: string[] = [];
      const subjects = papers.map((p) => {
        const m = byKey.get(key(st.enrollmentId, p.id));
        if (!m) complete = false;
        const value = m ? n(m.marks) : null;
        const counts = m && m.status !== 'exempt';
        if (counts) {
          maxTotal += p.maxMarks;
          total += value ?? 0;
        }
        const passed =
          !m || m.status === 'exempt'
            ? null
            : m.status === 'present' && (value ?? 0) >= p.passMarks;
        if (passed === false) failedIn.push(p.subjectName);
        return {
          paperId: p.id,
          subjectName: p.subjectName,
          maxMarks: p.maxMarks,
          passMarks: p.passMarks,
          marks: value,
          status: m?.status ?? null,
          grade:
            m && m.status === 'present' ? gradeFor(((value ?? 0) / p.maxMarks) * 100, bands) : null,
          passed,
        };
      });
      const percent = maxTotal ? Math.round((total / maxTotal) * 10000) / 100 : null;
      return {
        ...st,
        subjects,
        total,
        maxTotal,
        percent,
        grade: percent === null ? null : gradeFor(percent, bands),
        failedIn,
        complete: complete && papers.length > 0,
        rank: null,
        remark: st.remark,
      };
    });
    const ranks = rankScores(results.map((r) => (r.complete ? r.percent : null)));
    results.forEach((r, i) => (r.rank = ranks[i] ?? null));
    return { papers, results, bands };
  }

  sectionResults(access: TenantAccess, examId: string, sectionId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const e = await this.exam(tx, examId);
        const s = await this.section(tx, access, sectionId);
        if (s.campusId !== e.campusId || s.academicYearId !== e.academicYearId)
          throw notFound('Section');
        if (!s.office && !s.isClassTeacher) {
          throw new AppError(
            'FORBIDDEN',
            'The full result is for the class teacher and the office',
          );
        }
        const { papers, results } = await this.computeSection(
          tx,
          examId,
          sectionId,
          s.scaleId,
          s.gradeLevelId,
        );
        const done = results.filter((r) => r.complete);
        return {
          exam: { id: e.id, name: e.name, status: e.status },
          section: { id: s.id, name: s.name, className: s.className },
          canRemark:
            (s.isClassTeacher || access.has('exams.manage', s.campusId)) &&
            e.status !== 'published',
          papers,
          results,
          summary: {
            students: results.length,
            complete: done.length,
            passed: done.filter((r) => !r.failedIn.length).length,
            average: done.length
              ? Math.round((done.reduce((a, r) => a + (r.percent ?? 0), 0) / done.length) * 100) /
                100
              : null,
          },
        };
      },
      { readOnly: true },
    );
  }

  saveRemarks(
    access: TenantAccess,
    examId: string,
    sectionId: string,
    remarks: Array<{ enrollmentId: string; remark: string }>,
  ) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.exam(tx, examId);
      const s = await this.section(tx, access, sectionId);
      if (s.campusId !== e.campusId) throw notFound('Section');
      if (!s.isClassTeacher && !access.has('exams.manage', s.campusId)) {
        throw new AppError('FORBIDDEN', 'Remarks are written by the class teacher');
      }
      if (e.status === 'published')
        throw new AppError('CONFLICT', 'Results are published; remarks are locked');
      const roster = new Set(
        (
          (
            await tx.execute(
              sql`select id from student_enrollments where section_id = ${sectionId} and status = 'active'`,
            )
          ).rows as Array<{ id: string }>
        ).map((r) => r.id),
      );
      for (const r of remarks) {
        if (!roster.has(r.enrollmentId))
          throw new AppError('VALIDATION_FAILED', 'A student is not in this class');
        if (!r.remark) {
          await tx.execute(
            sql`delete from exam_remarks where exam_id = ${examId} and enrollment_id = ${r.enrollmentId}`,
          );
          continue;
        }
        await tx.execute(sql`
          insert into exam_remarks (id, tenant_id, exam_id, enrollment_id, remark, updated_by)
          values (${newId()}, ${access.tenantId}, ${examId}, ${r.enrollmentId}, ${r.remark}, ${access.userId})
          on conflict (tenant_id, exam_id, enrollment_id) do update
            set remark = excluded.remark, updated_by = excluded.updated_by, updated_at = now()`);
      }
      return { saved: remarks.length };
    });
  }

  /* ------------------------------------------ report card ------------------------------------------ */

  private async reportCard(tx: Transaction, examId: string, enrollmentId: string) {
    const [ctx] = (
      await tx.execute(sql`
        select en.section_id as "sectionId", s.grade_level_id as "gradeLevelId", g.grading_scale_id as "scaleId",
          g.name as "className", s.name as "sectionName", e.name as "examName", e.status,
          e.starts_on::text as "startsOn", e.ends_on::text as "endsOn",
          t.name as "schoolName", c.name as "campusName", c.address as "campusAddress",
          y.name as "yearName", st.date_of_birth::text as "dateOfBirth",
          (select g2.full_name from student_guardians sg join guardians g2 on g2.tenant_id = sg.tenant_id and g2.id = sg.guardian_id
             where sg.tenant_id = st.tenant_id and sg.student_id = st.id and sg.relationship = 'father' limit 1) as "fatherName",
          (select g2.full_name from student_guardians sg join guardians g2 on g2.tenant_id = sg.tenant_id and g2.id = sg.guardian_id
             where sg.tenant_id = st.tenant_id and sg.student_id = st.id and sg.relationship = 'mother' limit 1) as "motherName",
          (select u.full_name from tenant_memberships m join users u on u.id = m.user_id
             where m.tenant_id = s.tenant_id and m.id = s.class_teacher_membership_id) as "classTeacher",
          (select json_build_object(
              'present', count(*) filter (where a.status in ('present', 'late', 'half_day')),
              'total', count(*))
             from student_attendance a where a.tenant_id = en.tenant_id and a.enrollment_id = en.id
               and (e.ends_on is null or a.on_date <= e.ends_on)) as attendance
        from student_enrollments en
        join students st on st.tenant_id = en.tenant_id and st.id = en.student_id
        join sections s on s.tenant_id = en.tenant_id and s.id = en.section_id
        join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
        join exams e on e.tenant_id = en.tenant_id and e.id = ${examId}
        join academic_years y on y.tenant_id = e.tenant_id and y.id = e.academic_year_id
        join campuses c on c.tenant_id = e.tenant_id and c.id = e.campus_id
        join tenants t on t.id = e.tenant_id
        where en.id = ${enrollmentId} and en.academic_year_id = e.academic_year_id`)
    ).rows as Array<
      Record<string, unknown> & { sectionId: string; gradeLevelId: string; scaleId: string | null }
    >;
    if (!ctx) throw notFound('Report card');
    const { results, bands } = await this.computeSection(
      tx,
      examId,
      ctx.sectionId,
      ctx.scaleId,
      ctx.gradeLevelId,
    );
    const me = results.find((r) => r.enrollmentId === enrollmentId);
    if (!me) throw notFound('Report card');
    return { ctx, me, bands, classSize: results.length };
  }

  /** Staff: the report card of one student. */
  reportCardPdf(access: TenantAccess, examId: string, studentId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const e = await this.exam(tx, examId);
        const [en] = (
          await tx.execute(sql`
            select id, section_id as "sectionId" from student_enrollments
            where student_id = ${studentId} and academic_year_id = ${e.academicYearId}`)
        ).rows as Array<{ id: string; sectionId: string }>;
        if (!en) throw notFound('Student');
        const s = await this.section(tx, access, en.sectionId);
        if (!s.office && !s.isClassTeacher) throw notFound('Student');
        return this.renderCard(tx, examId, en.id);
      },
      { readOnly: true },
    );
  }

  private async renderCard(tx: Transaction, examId: string, enrollmentId: string) {
    const { ctx, me, bands, classSize } = await this.reportCard(tx, examId, enrollmentId);
    const att = ctx.attendance as { present: number; total: number } | null;
    const bytes = await renderReportCardPdf({
      schoolName: ctx.schoolName as string,
      campusName: ctx.campusName as string,
      campusAddress: (ctx.campusAddress as string | null) ?? null,
      examName: ctx.examName as string,
      yearName: ctx.yearName as string,
      studentName: me.name,
      admissionNumber: me.admissionNumber,
      rollNumber: me.rollNumber,
      className: `${ctx.className as string} ${ctx.sectionName as string}`,
      dateOfBirth: (ctx.dateOfBirth as string | null) ?? null,
      fatherName: (ctx.fatherName as string | null) ?? null,
      motherName: (ctx.motherName as string | null) ?? null,
      classTeacher: (ctx.classTeacher as string | null) ?? null,
      attendance: att && att.total ? att : null,
      subjects: me.subjects,
      total: me.total,
      maxTotal: me.maxTotal,
      percent: me.percent,
      grade: me.grade,
      rank: me.rank,
      classSize,
      failedIn: me.failedIn,
      remark: me.remark,
      bands,
      provisional: ctx.status !== 'published',
    });
    const safe = me.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student';
    return { bytes, fileName: `report-card-${safe}.pdf` };
  }

  /* -------------------------------------------- parents -------------------------------------------- */

  /** Published results for one enrollment (the caller has checked it is the parent's child). */
  async familyResults(access: TenantAccess, enrollmentId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const exams = (
          await tx.execute(sql`
            select e.id, e.name, e.published_at as "publishedAt"
            from student_enrollments en
            join exams e on e.tenant_id = en.tenant_id and e.academic_year_id = en.academic_year_id
              and e.campus_id = en.campus_id and e.status = 'published'
            where en.id = ${enrollmentId}
              and exists (select 1 from exam_papers p join sections s on s.tenant_id = p.tenant_id
                            and s.grade_level_id = p.grade_level_id where p.exam_id = e.id and s.id = en.section_id)
            order by e.published_at desc`)
        ).rows as Array<{ id: string; name: string; publishedAt: string }>;
        const items = [];
        for (const e of exams) {
          const { me, classSize } = await this.reportCard(tx, e.id, enrollmentId);
          items.push({
            examId: e.id,
            examName: e.name,
            publishedAt: e.publishedAt,
            subjects: me.subjects.map(({ paperId: _p, ...x }) => x),
            total: me.total,
            maxTotal: me.maxTotal,
            percent: me.percent,
            grade: me.grade,
            rank: me.rank,
            classSize,
            failedIn: me.failedIn,
            remark: me.remark,
          });
        }
        return { items };
      },
      { readOnly: true },
    );
  }

  /** Parent: the report card PDF of a published exam. */
  familyReportCard(access: TenantAccess, examId: string, enrollmentId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const e = await this.exam(tx, examId);
        if (e.status !== 'published') throw notFound('Report card');
        return this.renderCard(tx, examId, enrollmentId);
      },
      { readOnly: true },
    );
  }
}
