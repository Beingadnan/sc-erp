import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { TeachingCellInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { todayIn } from '../attendance/attendance.service.js';

const ta = schema.teachingAssignments;
type Rows = Array<Record<string, unknown>>;

/**
 * Who teaches what, the way a school timetable chart shows it: for every section, its class
 * teacher and a teacher per subject. A teacher then sees only those classes.
 */
@Injectable()
export class TeachingService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  private async year(tx: Transaction, campusId: string, academicYearId?: string) {
    const rows = (
      await tx.execute(sql`
        select id, name, is_current as "isCurrent", status from academic_years
        where campus_id = ${campusId} ${academicYearId ? sql`and id = ${academicYearId}` : sql``}
        order by is_current desc, starts_on desc limit 1`)
    ).rows as Array<{ id: string; name: string; isCurrent: boolean; status: string }>;
    if (!rows[0]) throw notFound('Academic year');
    return rows[0];
  }

  /** The whole chart for one campus and year. */
  grid(access: TenantAccess, campusId: string, academicYearId?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!access.has('academic.view', campusId) && !access.has('academic.manage', campusId)) {
          throw notFound('Campus');
        }
        const year = await this.year(tx, campusId, academicYearId);
        const sections = (
          await tx.execute(sql`
            select s.id, s.name, s.grade_level_id as "gradeLevelId", g.name as "className",
              g.sort_order as "sortOrder", s.class_teacher_membership_id as "classTeacherId",
              (select count(*) from student_enrollments e
                 where e.tenant_id = s.tenant_id and e.section_id = s.id and e.status = 'active')::int as students
            from sections s join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
            where s.academic_year_id = ${year.id}
            order by g.sort_order, g.name, s.name`)
        ).rows as Rows;
        const subjects = (
          await tx.execute(sql`
            select cs.grade_level_id as "gradeLevelId", sb.id, sb.name, sb.code, cs.is_optional as "isOptional"
            from class_subjects cs join subjects sb on sb.tenant_id = cs.tenant_id and sb.id = cs.subject_id
            where cs.grade_level_id in (select grade_level_id from sections where academic_year_id = ${year.id})
            order by cs.sort_order, sb.name`)
        ).rows as Rows;
        const assignments = (
          await tx.execute(sql`
            select a.section_id as "sectionId", a.subject_id as "subjectId", a.membership_id as "membershipId"
            from teaching_assignments a join sections s on s.tenant_id = a.tenant_id and s.id = a.section_id
            where s.academic_year_id = ${year.id}`)
        ).rows as Rows;
        const teachers = await this.teachers(tx, campusId);
        const classes = new Map<
          string,
          { gradeLevelId: string; name: string; sections: Rows; subjects: Rows }
        >();
        for (const s of sections) {
          const k = s.gradeLevelId as string;
          if (!classes.has(k)) {
            classes.set(k, {
              gradeLevelId: k,
              name: s.className as string,
              sections: [],
              subjects: subjects
                .filter((x) => x.gradeLevelId === k)
                .map(({ gradeLevelId: _, ...x }) => x),
            });
          }
          classes.get(k)!.sections.push({
            id: s.id,
            name: s.name,
            students: s.students,
            classTeacherId: s.classTeacherId ?? null,
          });
        }
        const load = (id: string) => ({
          classTeacherOf: sections.filter((s) => s.classTeacherId === id).length,
          periods: assignments.filter((a) => a.membershipId === id).length,
        });
        return {
          year,
          canManage: access.has('academic.manage', campusId),
          classes: [...classes.values()],
          assignments,
          teachers: teachers.map((t) => ({ ...t, ...load(t.membershipId) })),
        };
      },
      { readOnly: true },
    );
  }

  /** Active staff of the school (anyone who is not only a parent) who could teach at the campus. */
  private async teachers(tx: Transaction, campusId: string) {
    return (
      await tx.execute(sql`
        select m.id as "membershipId", u.full_name as "fullName",
          coalesce(p.designation, '') as designation
        from tenant_memberships m
        join users u on u.id = m.user_id
        left join staff_profiles p on p.tenant_id = m.tenant_id and p.membership_id = m.id
        where m.status in ('active', 'invited')
          and exists (select 1 from membership_roles mr join roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id
                      where mr.tenant_id = m.tenant_id and mr.membership_id = m.id and r.key <> 'parent'
                        and (mr.campus_id is null or mr.campus_id = ${campusId}))
        order by u.full_name`)
    ).rows as Array<{ membershipId: string; fullName: string; designation: string }>;
  }

  /** Replace the teachers of one subject in one section. */
  setCell(access: TenantAccess, input: TeachingCellInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [sec] = (
        await tx.execute(sql`
          select s.id, s.campus_id as "campusId", s.grade_level_id as "gradeLevelId", y.status as "yearStatus"
          from sections s join academic_years y on y.tenant_id = s.tenant_id and y.id = s.academic_year_id
          where s.id = ${input.sectionId}`)
      ).rows as Array<{ id: string; campusId: string; gradeLevelId: string; yearStatus: string }>;
      if (!sec || !access.has('academic.view', sec.campusId)) throw notFound('Section');
      if (!access.has('academic.manage', sec.campusId)) {
        throw new AppError('FORBIDDEN', 'You cannot change teaching assignments at this campus');
      }
      if (sec.yearStatus === 'closed')
        throw new AppError('CONFLICT', 'This academic year is closed');
      const taught = await tx
        .select({ id: schema.classSubjects.id })
        .from(schema.classSubjects)
        .where(
          and(
            eq(schema.classSubjects.gradeLevelId, sec.gradeLevelId),
            eq(schema.classSubjects.subjectId, input.subjectId),
          ),
        );
      if (!taught.length) {
        throw new AppError(
          'VALIDATION_FAILED',
          'This subject is not taught in this class. Add it to the class first.',
        );
      }
      const ids = [...new Set(input.membershipIds)];
      const allowed = new Set((await this.teachers(tx, sec.campusId)).map((t) => t.membershipId));
      if (ids.some((i) => !allowed.has(i))) {
        throw new AppError('VALIDATION_FAILED', 'Choose staff members of this campus');
      }
      const before = await tx
        .select({ membershipId: ta.membershipId })
        .from(ta)
        .where(and(eq(ta.sectionId, sec.id), eq(ta.subjectId, input.subjectId)));
      await tx.delete(ta).where(and(eq(ta.sectionId, sec.id), eq(ta.subjectId, input.subjectId)));
      if (ids.length) {
        await tx.insert(ta).values(
          ids.map((membershipId) => ({
            tenantId: access.tenantId,
            sectionId: sec.id,
            subjectId: input.subjectId,
            membershipId,
            createdBy: access.userId,
          })),
        );
      }
      await this.audit.record(tx, access, {
        action: 'teaching.assigned',
        entity: 'section',
        entityId: sec.id,
        campusId: sec.campusId,
        diff: {
          subjectId: input.subjectId,
          before: before.map((b) => b.membershipId),
          after: ids,
        },
      });
      return { sectionId: sec.id, subjectId: input.subjectId, membershipIds: ids };
    });
  }

  /** What the signed-in teacher teaches this year: class-teacher sections and subject classes. */
  mine(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const rows = (
          await tx.execute(sql`
            select s.id as "sectionId", s.name as "sectionName", g.name as "className", g.sort_order as "sortOrder",
              s.campus_id as "campusId", c.timezone,
              coalesce(s.class_teacher_membership_id = ${access.membershipId}, false) as "isClassTeacher",
              coalesce((select json_agg(json_build_object('id', sb.id, 'name', sb.name) order by sb.name)
                 from teaching_assignments a join subjects sb on sb.tenant_id = a.tenant_id and sb.id = a.subject_id
                 where a.tenant_id = s.tenant_id and a.section_id = s.id and a.membership_id = ${access.membershipId}), '[]') as subjects,
              (select count(*) from student_enrollments e
                 where e.tenant_id = s.tenant_id and e.section_id = s.id and e.status = 'active')::int as students
            from sections s
            join academic_years y on y.tenant_id = s.tenant_id and y.id = s.academic_year_id
              and y.id = (select y2.id from academic_years y2
                          where y2.tenant_id = s.tenant_id and y2.campus_id = s.campus_id
                          order by y2.is_current desc, y2.starts_on desc limit 1)
            join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
            join campuses c on c.tenant_id = s.tenant_id and c.id = s.campus_id
            where s.class_teacher_membership_id = ${access.membershipId}
               or exists (select 1 from teaching_assignments a
                          where a.tenant_id = s.tenant_id and a.section_id = s.id and a.membership_id = ${access.membershipId})
            order by coalesce(s.class_teacher_membership_id = ${access.membershipId}, false) desc, g.sort_order, s.name`)
        ).rows as Array<{
          sectionId: string;
          sectionName: string;
          className: string;
          campusId: string;
          timezone: string;
          isClassTeacher: boolean;
          subjects: Array<{ id: string; name: string }>;
          students: number;
        }>;
        const marked = rows.length
          ? ((
              await tx.execute(sql`
                select section_id as "sectionId" from attendance_sessions
                where period = 0 and on_date = ${todayIn(rows[0]!.timezone)}
                  and section_id in (${sql.join(
                    rows.map((r) => sql`${r.sectionId}`),
                    sql`, `,
                  )})`)
            ).rows as Array<{ sectionId: string }>)
          : [];
        return {
          sections: rows.map(({ timezone: _, ...r }) => ({
            ...r,
            attendanceTaken: marked.some((m) => m.sectionId === r.sectionId),
          })),
        };
      },
      { readOnly: true },
    );
  }

  /**
   * Students of a section for its teachers. Subject teachers get the class list only (name,
   * admission number, roll number); the class teacher and the office also get parents' phones.
   */
  roster(access: TenantAccess, sectionId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const [sec] = (
          await tx.execute(sql`
            select s.id, s.name, s.campus_id as "campusId", g.name as "className",
              coalesce(s.class_teacher_membership_id = ${access.membershipId}, false) as "isClassTeacher",
              exists (select 1 from teaching_assignments a where a.tenant_id = s.tenant_id
                        and a.section_id = s.id and a.membership_id = ${access.membershipId}) as "teaches"
            from sections s join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
            where s.id = ${sectionId}`)
        ).rows as Array<{
          id: string;
          name: string;
          campusId: string;
          className: string;
          isClassTeacher: boolean;
          teaches: boolean;
        }>;
        const office = !!sec && access.has('students.view', sec.campusId);
        if (!sec || (!sec.isClassTeacher && !sec.teaches && !office)) throw notFound('Section');
        const full = sec.isClassTeacher || office;
        const students = (
          await tx.execute(sql`
            select st.id, st.first_name as "firstName", st.last_name as "lastName",
              st.admission_number as "admissionNumber", st.gender, e.roll_number as "rollNumber"
              ${
                full
                  ? sql`, (select g.phone from student_guardians sg join guardians g
                           on g.tenant_id = sg.tenant_id and g.id = sg.guardian_id
                         where sg.tenant_id = st.tenant_id and sg.student_id = st.id
                         order by sg.is_primary desc limit 1) as "parentPhone"`
                  : sql``
              }
            from student_enrollments e join students st on st.tenant_id = e.tenant_id and st.id = e.student_id
            where e.section_id = ${sectionId} and e.status = 'active'
            order by e.roll_number nulls last, st.first_name`)
        ).rows as Rows;
        return {
          section: { id: sec.id, name: sec.name, className: sec.className },
          role: sec.isClassTeacher ? 'class_teacher' : sec.teaches ? 'subject_teacher' : 'office',
          canOpenProfiles: full,
          students,
        };
      },
      { readOnly: true },
    );
  }
}
