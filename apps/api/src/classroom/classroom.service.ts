import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { MAX_DOCUMENT_BYTES } from '@school-erp/validation';
import type {
  HomeworkInput,
  PeriodSlotsInput,
  SubstitutionInput,
  TimetableCellInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { FILE_STORAGE, safeFileName, sniffType } from '../storage/file-storage.js';
import type { FileStorage } from '../storage/file-storage.js';
import { todayIn } from '../attendance/attendance.service.js';

const ps = schema.periodSlots;
const te = schema.timetableEntries;
const sub = schema.substitutions;
const hw = schema.homework;
type Rows = Array<Record<string, unknown>>;

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const weekdayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The classroom day: the bell (periods), each section's weekly timetable, substitutions when a
 * teacher is away, and homework teachers give in their own subjects.
 */
@Injectable()
export class ClassroomService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly audit: AuditService,
  ) {}

  private async campus(tx: Transaction, campusId: string) {
    const [c] = await tx
      .select({ id: schema.campuses.id, timezone: schema.campuses.timezone })
      .from(schema.campuses)
      .where(eq(schema.campuses.id, campusId));
    if (!c) throw notFound('Campus');
    return c;
  }

  private async section(tx: Transaction, access: TenantAccess, sectionId: string) {
    const [s] = (
      await tx.execute(sql`
        select s.id, s.name, s.campus_id as "campusId", s.grade_level_id as "gradeLevelId", g.name as "className",
          coalesce(s.class_teacher_membership_id = ${access.membershipId}, false) as "isClassTeacher",
          exists (select 1 from teaching_assignments a where a.tenant_id = s.tenant_id and a.section_id = s.id
                    and a.membership_id = ${access.membershipId}) as teaches
        from sections s join grade_levels g on g.tenant_id = s.tenant_id and g.id = s.grade_level_id
        where s.id = ${sectionId}`)
    ).rows as Array<{
      id: string;
      name: string;
      campusId: string;
      gradeLevelId: string;
      className: string;
      isClassTeacher: boolean;
      teaches: boolean;
    }>;
    const office =
      !!s && (access.has('academic.view', s.campusId) || access.has('students.view', s.campusId));
    if (!s || (!office && !s.isClassTeacher && !s.teaches)) throw notFound('Section');
    return { ...s, office };
  }

  /* ------------------------------------------- bell ------------------------------------------- */

  slots(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.campus(tx, campusId);
        const rows = await tx.select().from(ps).where(eq(ps.campusId, campusId)).orderBy(ps.seq);
        return {
          canManage: access.has('timetable.manage', campusId),
          slots: rows.map((r) => ({
            id: r.id,
            seq: r.seq,
            label: r.label,
            startsAt: r.startsAt.slice(0, 5),
            endsAt: r.endsAt.slice(0, 5),
            isBreak: r.isBreak,
          })),
        };
      },
      { readOnly: true },
    );
  }

  /** Replaces the bell. Existing periods keep their id (and timetable) when sent back with it. */
  saveSlots(access: TenantAccess, input: PeriodSlotsInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (!access.has('timetable.manage', input.campusId)) {
        throw new AppError('FORBIDDEN', 'You cannot change the timetable at this campus');
      }
      await this.campus(tx, input.campusId);
      const before = await tx.select({ id: ps.id }).from(ps).where(eq(ps.campusId, input.campusId));
      const keep = new Set(input.slots.map((s) => s.id).filter(Boolean) as string[]);
      const gone = before.filter((b) => !keep.has(b.id)).map((b) => b.id);
      if (gone.length) {
        await tx.delete(ps).where(
          sql`${ps.id} in (${sql.join(
            gone.map((g) => sql`${g}`),
            sql`, `,
          )})`,
        );
      }
      // Move kept rows out of the way of the seq unique key, then write the new order.
      await tx
        .update(ps)
        .set({ seq: sql`${ps.seq} + 50` as unknown as number })
        .where(eq(ps.campusId, input.campusId));
      for (const [i, s] of input.slots.entries()) {
        const values = {
          seq: i + 1,
          label: s.label,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          isBreak: s.isBreak,
        };
        if (s.id && before.some((b) => b.id === s.id)) {
          await tx.update(ps).set(values).where(eq(ps.id, s.id));
        } else {
          await tx
            .insert(ps)
            .values({ tenantId: access.tenantId, campusId: input.campusId, ...values });
        }
      }
      await this.audit.record(tx, access, {
        action: 'timetable.bell_changed',
        entity: 'campus',
        entityId: input.campusId,
        campusId: input.campusId,
        diff: { periods: input.slots.length, removed: gone.length },
      });
      return { saved: input.slots.length };
    }).then(() => this.slots(access, input.campusId));
  }

  /* ---------------------------------------- timetable ---------------------------------------- */

  /** A section's week: periods down, Mon–Sat across. */
  sectionTimetable(access: TenantAccess, sectionId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const s = await this.section(tx, access, sectionId);
        const slots = (
          await tx.select().from(ps).where(eq(ps.campusId, s.campusId)).orderBy(ps.seq)
        ).map((r) => ({
          id: r.id,
          label: r.label,
          startsAt: r.startsAt.slice(0, 5),
          endsAt: r.endsAt.slice(0, 5),
          isBreak: r.isBreak,
        }));
        const entries = (
          await tx.execute(sql`
            select e.id, e.weekday, e.slot_id as "slotId", e.subject_id as "subjectId", sb.name as "subjectName",
              e.membership_id as "membershipId", u.full_name as "teacherName"
            from timetable_entries e
            join subjects sb on sb.tenant_id = e.tenant_id and sb.id = e.subject_id
            left join tenant_memberships m on m.tenant_id = e.tenant_id and m.id = e.membership_id
            left join users u on u.id = m.user_id
            where e.section_id = ${sectionId}`)
        ).rows;
        const subjects = (
          await tx.execute(sql`
            select sb.id, sb.name,
              (select a.membership_id from teaching_assignments a where a.tenant_id = cs.tenant_id
                 and a.section_id = ${sectionId} and a.subject_id = sb.id limit 1) as "teacherId"
            from class_subjects cs join subjects sb on sb.tenant_id = cs.tenant_id and sb.id = cs.subject_id
            where cs.grade_level_id = ${s.gradeLevelId} order by cs.sort_order, sb.name`)
        ).rows;
        return {
          section: { id: s.id, name: s.name, className: s.className, campusId: s.campusId },
          canManage: access.has('timetable.manage', s.campusId),
          slots,
          subjects,
          entries,
        };
      },
      { readOnly: true },
    );
  }

  setCell(access: TenantAccess, sectionId: string, input: TimetableCellInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = await this.section(tx, access, sectionId);
      if (!access.has('timetable.manage', s.campusId)) {
        throw new AppError('FORBIDDEN', 'You cannot change the timetable at this campus');
      }
      const [slot] = await tx
        .select()
        .from(ps)
        .where(and(eq(ps.id, input.slotId), eq(ps.campusId, s.campusId)));
      if (!slot) throw notFound('Period');
      if (slot.isBreak && input.subjectId)
        throw new AppError('VALIDATION_FAILED', `${slot.label} is a break`);
      const cell = and(
        eq(te.sectionId, sectionId),
        eq(te.weekday, input.weekday),
        eq(te.slotId, input.slotId),
      );
      if (!input.subjectId) {
        await tx.delete(te).where(cell);
        return { cleared: true };
      }
      const [taught] = await tx
        .select({ id: schema.classSubjects.id })
        .from(schema.classSubjects)
        .where(
          and(
            eq(schema.classSubjects.gradeLevelId, s.gradeLevelId),
            eq(schema.classSubjects.subjectId, input.subjectId),
          ),
        );
      if (!taught)
        throw new AppError('VALIDATION_FAILED', 'This subject is not taught in this class');
      let teacher = input.membershipId;
      if (!teacher) {
        const a = await tx
          .select({ m: schema.teachingAssignments.membershipId })
          .from(schema.teachingAssignments)
          .where(
            and(
              eq(schema.teachingAssignments.sectionId, sectionId),
              eq(schema.teachingAssignments.subjectId, input.subjectId),
            ),
          );
        teacher = a.length === 1 ? a[0]!.m : null;
      }
      if (teacher) {
        const [busy] = (
          await tx.execute(sql`
            select g.name || ' ' || sec.name as cls, u.full_name as name
            from timetable_entries e
            join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
            join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
            join tenant_memberships m on m.tenant_id = e.tenant_id and m.id = e.membership_id
            join users u on u.id = m.user_id
            where e.membership_id = ${teacher} and e.weekday = ${input.weekday} and e.slot_id = ${input.slotId}
              and e.section_id <> ${sectionId}
              and sec.academic_year_id = (select academic_year_id from sections where id = ${sectionId})
            limit 1`)
        ).rows as Array<{ cls: string; name: string }>;
        if (busy) {
          throw new AppError(
            'CONFLICT',
            `${busy.name} already teaches ${busy.cls} in ${slot.label} on ${DAY_NAMES[input.weekday]}`,
          );
        }
      }
      await tx
        .insert(te)
        .values({
          tenantId: access.tenantId,
          sectionId,
          weekday: input.weekday,
          slotId: input.slotId,
          subjectId: input.subjectId,
          membershipId: teacher,
          updatedBy: access.userId,
        })
        .onConflictDoUpdate({
          target: [te.tenantId, te.sectionId, te.weekday, te.slotId],
          set: {
            subjectId: input.subjectId,
            membershipId: teacher,
            updatedBy: access.userId,
            updatedAt: new Date(),
          },
        });
      return {
        weekday: input.weekday,
        slotId: input.slotId,
        subjectId: input.subjectId,
        membershipId: teacher,
      };
    });
  }

  /* ----------------------------------------- the day ----------------------------------------- */

  /** A teacher's periods on a date: own timetable (minus periods given to a substitute) plus cover. */
  private async periodsOf(tx: Transaction, membershipId: string, date: string) {
    const wd = weekdayOf(date);
    return (
      await tx.execute(sql`
        select e.id as "entryId", p.seq, p.label, to_char(p.starts_at, 'HH24:MI') as "startsAt",
          to_char(p.ends_at, 'HH24:MI') as "endsAt", sec.id as "sectionId", g.name as "className", sec.name as "sectionName",
          sb.name as "subjectName", false as "isCover", su.full_name as "coveredBy", null::text as "absentTeacher"
        from timetable_entries e
        join period_slots p on p.tenant_id = e.tenant_id and p.id = e.slot_id
        join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
        join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
        join subjects sb on sb.tenant_id = e.tenant_id and sb.id = e.subject_id
        left join substitutions s on s.tenant_id = e.tenant_id and s.entry_id = e.id and s.on_date = ${date}
        left join tenant_memberships sm on sm.tenant_id = s.tenant_id and sm.id = s.substitute_membership_id
        left join users su on su.id = sm.user_id
        where e.membership_id = ${membershipId} and e.weekday = ${wd}
        union all
        select e.id, p.seq, p.label, to_char(p.starts_at, 'HH24:MI'), to_char(p.ends_at, 'HH24:MI'), sec.id, g.name, sec.name,
          sb.name, true, null, au.full_name
        from substitutions s
        join timetable_entries e on e.tenant_id = s.tenant_id and e.id = s.entry_id
        join period_slots p on p.tenant_id = e.tenant_id and p.id = e.slot_id
        join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
        join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
        join subjects sb on sb.tenant_id = e.tenant_id and sb.id = e.subject_id
        left join tenant_memberships am on am.tenant_id = e.tenant_id and am.id = e.membership_id
        left join users au on au.id = am.user_id
        where s.substitute_membership_id = ${membershipId} and s.on_date = ${date}
        order by 2`)
    ).rows as Rows;
  }

  async mine(access: TenantAccess, date?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const [c] = (
          await tx.execute(sql`
            select c.timezone from tenant_memberships m join campuses c on c.tenant_id = m.tenant_id
            where m.id = ${access.membershipId} order by c.created_at limit 1`)
        ).rows as Array<{ timezone: string }>;
        const on = date ?? todayIn(c?.timezone ?? 'Asia/Kolkata');
        return {
          date: on,
          weekday: weekdayOf(on),
          periods: await this.periodsOf(tx, access.membershipId, on),
        };
      },
      { readOnly: true },
    );
  }

  /** Office: one teacher's periods on a date, with who is free to cover each. */
  teacherDay(access: TenantAccess, campusId: string, membershipId: string, date?: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!access.has('timetable.manage', campusId)) throw notFound('Campus');
        const c = await this.campus(tx, campusId);
        const on = date ?? todayIn(c.timezone);
        const wd = weekdayOf(on);
        const periods = (await this.periodsOf(tx, membershipId, on)).filter((p) => !p.isCover);
        const free = (
          await tx.execute(sql`
            select p.id as "slotId", m.id as "membershipId", u.full_name as "fullName"
            from period_slots p
            cross join tenant_memberships m
            join users u on u.id = m.user_id
            where p.campus_id = ${campusId} and m.status in ('active', 'invited') and m.id <> ${membershipId}
              and exists (select 1 from membership_roles mr join roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id
                          where mr.tenant_id = m.tenant_id and mr.membership_id = m.id and r.key = 'teacher')
              and not exists (select 1 from timetable_entries e where e.tenant_id = m.tenant_id and e.membership_id = m.id
                                and e.weekday = ${wd} and e.slot_id = p.id
                                and not exists (select 1 from substitutions s2 where s2.tenant_id = e.tenant_id
                                                  and s2.entry_id = e.id and s2.on_date = ${on}))
              and not exists (select 1 from substitutions s join timetable_entries e2 on e2.tenant_id = s.tenant_id and e2.id = s.entry_id
                                where s.tenant_id = m.tenant_id and s.substitute_membership_id = m.id
                                  and s.on_date = ${on} and e2.slot_id = p.id)
            order by u.full_name`)
        ).rows as Array<{ slotId: string; membershipId: string; fullName: string }>;
        const slotOf = (
          await tx
            .select({ id: te.id, slotId: te.slotId })
            .from(te)
            .where(eq(te.membershipId, membershipId))
        ).reduce<Record<string, string>>((m, e) => ({ ...m, [e.id]: e.slotId }), {});
        return {
          date: on,
          periods: periods.map((p) => ({
            ...p,
            freeTeachers: free
              .filter((f) => f.slotId === slotOf[p.entryId as string])
              .map((f) => ({ membershipId: f.membershipId, fullName: f.fullName })),
          })),
        };
      },
      { readOnly: true },
    );
  }

  setSubstitution(access: TenantAccess, input: SubstitutionInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [e] = (
        await tx.execute(sql`
          select e.id, e.membership_id as "membershipId", e.weekday, sec.campus_id as "campusId", e.slot_id as "slotId"
          from timetable_entries e join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
          where e.id = ${input.entryId}`)
      ).rows as Array<{
        id: string;
        membershipId: string | null;
        weekday: number;
        campusId: string;
        slotId: string;
      }>;
      if (!e || !access.has('timetable.manage', e.campusId)) throw notFound('Period');
      if (weekdayOf(input.onDate) !== e.weekday) {
        throw new AppError('VALIDATION_FAILED', 'That period is not on this day');
      }
      await tx.delete(sub).where(and(eq(sub.entryId, e.id), eq(sub.onDate, input.onDate)));
      if (input.substituteMembershipId) {
        if (input.substituteMembershipId === e.membershipId) {
          throw new AppError('VALIDATION_FAILED', 'Choose someone other than the absent teacher');
        }
        const [who] = (
          await tx.execute(sql`
            select status from tenant_memberships where id = ${input.substituteMembershipId}`)
        ).rows as Array<{ status: string }>;
        if (!who || !['active', 'invited'].includes(who.status)) {
          throw new AppError('VALIDATION_FAILED', 'Choose a current member of staff');
        }
        const busy = await tx.execute(sql`
          select 1 from timetable_entries x where x.membership_id = ${input.substituteMembershipId}
            and x.weekday = ${e.weekday} and x.slot_id = ${e.slotId}
            and not exists (select 1 from substitutions s where s.entry_id = x.id and s.on_date = ${input.onDate})
          union all
          select 1 from substitutions s join timetable_entries x on x.tenant_id = s.tenant_id and x.id = s.entry_id
            where s.substitute_membership_id = ${input.substituteMembershipId} and s.on_date = ${input.onDate}
              and x.slot_id = ${e.slotId}
          limit 1`);
        if (busy.rows.length) throw new AppError('CONFLICT', 'That teacher is busy in this period');
        await tx.insert(sub).values({
          id: newId(),
          tenantId: access.tenantId,
          onDate: input.onDate,
          entryId: e.id,
          absentMembershipId: e.membershipId,
          substituteMembershipId: input.substituteMembershipId,
          note: input.note,
          createdBy: access.userId,
        });
      }
      await this.audit.record(tx, access, {
        action: 'timetable.substitution',
        entity: 'timetable_entry',
        entityId: e.id,
        campusId: e.campusId,
        diff: { onDate: input.onDate, substitute: input.substituteMembershipId },
      });
      return {
        entryId: e.id,
        onDate: input.onDate,
        substituteMembershipId: input.substituteMembershipId,
      };
    });
  }

  /* ----------------------------------------- homework ----------------------------------------- */

  async addHomework(
    access: TenantAccess,
    input: HomeworkInput,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    let type: ReturnType<typeof sniffType> = null;
    if (file?.buffer?.length) {
      if (file.size > MAX_DOCUMENT_BYTES)
        throw new AppError('VALIDATION_FAILED', 'Files can be at most 5 MB');
      type = sniffType(file.buffer);
      if (!type)
        throw new AppError('VALIDATION_FAILED', 'Attach a photo (JPG, PNG, WebP) or a PDF');
    }
    const id = newId();
    const key =
      file && type
        ? `t/${access.tenantId}/d/${id}/${safeFileName(file.originalname || 'homework', type)}`
        : null;
    const check = await withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const s = await this.section(tx, access, input.sectionId);
        const [assigned] = await tx
          .select({ id: schema.teachingAssignments.id })
          .from(schema.teachingAssignments)
          .where(
            and(
              eq(schema.teachingAssignments.sectionId, input.sectionId),
              eq(schema.teachingAssignments.subjectId, input.subjectId),
              eq(schema.teachingAssignments.membershipId, access.membershipId),
            ),
          );
        if (!assigned && !s.isClassTeacher && !access.has('academic.manage', s.campusId)) {
          throw new AppError('FORBIDDEN', 'You can give homework only in the subjects you teach');
        }
        return { s, today: todayIn((await this.campus(tx, s.campusId)).timezone) };
      },
      { readOnly: true },
    );
    if (input.dueOn && input.dueOn < check.today) {
      throw new AppError('VALIDATION_FAILED', 'The due date is in the past', {
        fields: { dueOn: 'In the past' },
      });
    }
    if (key && type) await this.storage.put(key, file!.buffer, type);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.insert(hw).values({
        id,
        tenantId: access.tenantId,
        sectionId: input.sectionId,
        subjectId: input.subjectId,
        givenOn: check.today,
        dueOn: input.dueOn ?? null,
        title: input.title,
        details: input.details,
        storageKey: key,
        contentType: type,
        createdBy: access.userId,
      });
      return { id, givenOn: check.today };
    });
  }

  /** Recent homework of a section (last 30 days and anything still due). */
  private async homeworkRows(tx: Transaction, sectionId: string) {
    const rows = (
      await tx.execute(sql`
        select h.id, h.title, h.details, h.given_on::text as "givenOn", h.due_on::text as "dueOn",
          sb.name as "subjectName", h.subject_id as "subjectId", u.full_name as "teacherName",
          h.storage_key as "storageKey", h.content_type as "contentType", h.created_by as "createdBy"
        from homework h
        join subjects sb on sb.tenant_id = h.tenant_id and sb.id = h.subject_id
        left join users u on u.id = h.created_by
        where h.section_id = ${sectionId} and h.status = 'active'
          and (h.given_on >= current_date - 30 or h.due_on >= current_date)
        order by h.given_on desc, h.created_at desc limit 100`)
    ).rows as Rows;
    return Promise.all(
      rows.map(async ({ storageKey, ...r }) => ({
        ...(r as Record<string, unknown> & { createdBy: string | null }),
        attachmentUrl: storageKey
          ? await this.storage.signedDownloadUrl(storageKey as string, 600)
          : null,
      })),
    );
  }

  homeworkFor(access: TenantAccess, sectionId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const s = await this.section(tx, access, sectionId);
        const items = await this.homeworkRows(tx, sectionId);
        return {
          section: { id: s.id, name: s.name, className: s.className },
          items: items.map((i) => ({
            ...i,
            canRemove: i.createdBy === access.userId || access.has('academic.manage', s.campusId),
          })),
        };
      },
      { readOnly: true },
    );
  }

  /** For the parent app: the student's current section. Caller has checked the child. */
  homeworkForSectionTrusted(access: TenantAccess, sectionId: string) {
    return withTenant(this.handle.db, access.ctx, (tx) => this.homeworkRows(tx, sectionId), {
      readOnly: true,
    });
  }

  removeHomework(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [h] = await tx.select().from(hw).where(eq(hw.id, id));
      if (!h) throw notFound('Homework');
      const s = await this.section(tx, access, h.sectionId);
      if (h.createdBy !== access.userId && !access.has('academic.manage', s.campusId)) {
        throw new AppError('FORBIDDEN', 'Only the teacher who gave it can remove it');
      }
      if (h.status === 'removed') return { id, status: 'removed' };
      await tx.update(hw).set({ status: 'removed' }).where(eq(hw.id, id));
      return { id, status: 'removed' };
    });
  }
}
