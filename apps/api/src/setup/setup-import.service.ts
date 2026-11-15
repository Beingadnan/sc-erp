import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import {
  SETUP_MAX_BYTES,
  SETUP_MAX_ROWS,
  emailSchema,
  indianPhoneSchema,
  parseClassLabel,
  parseClassList,
  subjectCodeFrom,
} from '@school-erp/validation';
import type { ClassInfo } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { MembersService } from '../tenancy/members.service.js';
import type { PendingMail } from '../tenancy/members.service.js';

const imp = schema.setupImports;
type Cells = Record<string, string>;
interface Problem {
  sheet: string;
  row: number;
  message: string;
}

/** A teacher as written in the workbook: mobile, email or exact name. */
type TeacherRef = { phone?: string; email?: string; name?: string; text: string };

interface Plan {
  classes: Array<ClassInfo & { existingId: string | null }>;
  sections: Array<{
    classCode: string;
    name: string;
    existingId: string | null;
    classTeacher: TeacherRef | null;
    row: number;
  }>;
  subjects: Array<{ code: string; name: string; existingId: string | null; classCodes: string[] }>;
  staff: Array<{
    fullName: string;
    phone: string | null;
    email: string | null;
    designation: string;
    employeeCode: string | null;
    roleId: string;
    roleName: string;
    existingMembershipId: string | null;
  }>;
  teaching: Array<{
    classCode: string;
    section: string;
    subjectCode: string;
    teacher: TeacherRef;
    row: number;
  }>;
}

interface Created {
  gradeLevels: string[];
  sections: string[];
  subjects: string[];
  classSubjects: string[];
  memberships: string[];
  teaching: string[];
  classTeachers: Array<{ sectionId: string; before: string | null }>;
}

const SHEETS = {
  classes: ['classes', 'classes_sections', 'class', 'sections'],
  subjects: ['subjects', 'subject'],
  staff: ['staff', 'teachers', 'employees'],
  teaching: ['teaching', 'who_teaches_what', 'timetable', 'assignments'],
} as const;

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return String(v.result ?? '');
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? '');
  }
  return String(v);
};
const pick = (r: Cells, ...keys: string[]) => {
  for (const k of keys) if (r[k]) return r[k]!.trim();
  return '';
};
/** Plain header key (the student-import aliases do not apply here). */
const headerKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const teacherRef = (raw: string): TeacherRef | null => {
  const text = raw.trim();
  if (!text) return null;
  if (text.includes('@')) {
    const e = emailSchema.safeParse(text);
    return e.success ? { email: e.data, text } : { name: text, text };
  }
  const p = indianPhoneSchema.safeParse(text);
  return p.success ? { phone: p.data, text } : { name: text, text };
};

/**
 * The school setup workbook: classes and sections, subjects, staff and who teaches what, all in
 * one Excel file. Preview checks every row; import adds everything in one transaction and keeps a
 * list of what it added, so the whole import can be undone.
 */
@Injectable()
export class SetupImportService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly members: MembersService,
  ) {}

  /* --------------------------------------- template --------------------------------------- */

  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = (name: string, head: string[], rows: string[][], widths: number[]) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(head).font = { bold: true };
      rows.forEach((r) => ws.addRow(r));
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const help = wb.addWorksheet('Read me');
    [
      'School setup workbook',
      '',
      'Fill the four sheets and upload this file in Settings → Import old data. Delete the example rows first.',
      'Classes: one row per section. Class can be written as 1, Class 1, I, 1st, LKG, UKG, Nursery, 11 Science…',
      'Subjects: Classes can be "All", "1-5", "6, 7, 8" or "LKG, UKG". Code is optional.',
      'Staff: give a mobile number (preferred) or an email. Role: Teacher, Accountant, Receptionist, Principal, School admin, Admission officer.',
      'Teaching: who teaches which subject in which section. Teacher = mobile, email or the exact name from the Staff sheet.',
      'Students and old fee balances are imported separately (Students → Import, and Fees).',
      'You will see a preview with every problem marked before anything is saved, and you can undo the whole import afterwards.',
    ].forEach((l, i) => {
      const row = help.addRow([l]);
      if (i === 0) row.font = { bold: true, size: 14 };
    });
    help.getColumn(1).width = 120;
    sheet(
      'Classes',
      ['Class', 'Section', 'Class teacher', 'Capacity'],
      [
        ['LKG', 'A', '9829012345', '30'],
        ['1', 'A', 'Sushma Rao', '40'],
        ['1', 'B', '', '40'],
      ],
      [14, 10, 26, 10],
    );
    sheet(
      'Subjects',
      ['Code', 'Subject', 'Classes'],
      [
        ['HIN', 'Hindi', 'All'],
        ['ENG', 'English', 'All'],
        ['', 'EVS', 'LKG-UKG, 1-5'],
      ],
      [10, 24, 24],
    );
    sheet(
      'Staff',
      ['Name', 'Mobile', 'Email', 'Designation', 'Role', 'Employee code'],
      [
        ['Sushma Rao', '9829012345', '', 'PRT Hindi', 'Teacher', 'T-101'],
        ['Anil Mehta', '9829054321', 'anil@example.com', 'Accountant', 'Accountant', 'A-01'],
      ],
      [22, 14, 26, 18, 16, 14],
    );
    sheet(
      'Teaching',
      ['Class', 'Section', 'Subject', 'Teacher'],
      [
        ['1', 'A', 'Hindi', '9829012345'],
        ['1', 'B', 'HIN', 'Sushma Rao'],
      ],
      [10, 10, 18, 26],
    );
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /* ---------------------------------------- reading ---------------------------------------- */

  private async readWorkbook(
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError('VALIDATION_FAILED', 'Choose the Excel workbook', {
        fields: { file: 'Required' },
      });
    }
    if (file.size > SETUP_MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'Files can be at most 2 MB', {
        fields: { file: 'Too large' },
      });
    }
    if (file.buffer.subarray(0, 2).toString('latin1') !== 'PK') {
      throw new AppError(
        'VALIDATION_FAILED',
        'Upload the .xlsx workbook (download the template first)',
      );
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppError('VALIDATION_FAILED', 'This Excel file could not be read');
    }
    const out: Record<keyof typeof SHEETS, Array<{ row: number; cells: Cells }>> = {
      classes: [],
      subjects: [],
      staff: [],
      teaching: [],
    };
    let total = 0;
    for (const ws of wb.worksheets) {
      const key = (Object.keys(SHEETS) as Array<keyof typeof SHEETS>).find((k) =>
        (SHEETS[k] as readonly string[]).includes(headerKey(ws.name)),
      );
      if (!key) continue;
      const headers: string[] = [];
      ws.getRow(1).eachCell(
        { includeEmpty: true },
        (c, i) => (headers[i - 1] = headerKey(cellText(c.value))),
      );
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const cells: Cells = {};
        headers.forEach((h, i) => {
          if (h) cells[h] = cellText(row.getCell(i + 1).value).trim();
        });
        if (Object.values(cells).some(Boolean)) {
          out[key].push({ row: r, cells });
          if (++total > SETUP_MAX_ROWS) {
            throw new AppError(
              'VALIDATION_FAILED',
              `The workbook can have at most ${SETUP_MAX_ROWS} rows`,
            );
          }
        }
      }
    }
    if (!total) {
      throw new AppError(
        'VALIDATION_FAILED',
        'No rows found. Use the sheets Classes, Subjects, Staff and Teaching from the template.',
      );
    }
    return out;
  }

  private async yearFor(tx: Transaction, campusId: string, academicYearId?: string) {
    const [y] = (
      await tx.execute(sql`
        select id, name, status from academic_years where campus_id = ${campusId}
          ${academicYearId ? sql`and id = ${academicYearId}` : sql``}
        order by is_current desc, starts_on desc limit 1`)
    ).rows as Array<{ id: string; name: string; status: string }>;
    if (!y)
      throw new AppError('CONFLICT', 'Add the academic year first (Academics → Academic years)');
    if (y.status === 'closed') throw new AppError('CONFLICT', 'This academic year is closed');
    return y;
  }

  /** Staff of the school with the ways a workbook may name them. */
  private async staffDirectory(tx: Transaction) {
    return (
      await tx.execute(sql`
        select m.id as "membershipId", m.status, u.full_name as "fullName", u.email::text as email,
          u.login_phone as "loginPhone", p.phone as "profilePhone"
        from tenant_memberships m join users u on u.id = m.user_id
        left join staff_profiles p on p.tenant_id = m.tenant_id and p.membership_id = m.id
        where m.status <> 'suspended'
          and exists (select 1 from membership_roles mr join roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id
                      where mr.tenant_id = m.tenant_id and mr.membership_id = m.id and r.key <> 'parent')`)
    ).rows as Array<{
      membershipId: string;
      status: string;
      fullName: string;
      email: string | null;
      loginPhone: string | null;
      profilePhone: string | null;
    }>;
  }

  /* ---------------------------------------- preview ---------------------------------------- */

  async preview(
    access: TenantAccess,
    campusId: string,
    academicYearId: string | undefined,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    if (!access.has('academic.manage', campusId)) throw notFound('Campus');
    const book = await this.readWorkbook(file);
    if (book.staff.length && !access.has('members.manage')) {
      throw new AppError('FORBIDDEN', 'Only someone who manages staff can import the Staff sheet');
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [campus] = await tx
        .select({ id: schema.campuses.id })
        .from(schema.campuses)
        .where(eq(schema.campuses.id, campusId));
      if (!campus) throw notFound('Campus');
      const year = await this.yearFor(tx, campusId, academicYearId);
      const problems: Problem[] = [];
      const bad = (sheet: string, row: number, message: string) =>
        problems.push({ sheet, row, message });

      const existingClasses = await tx
        .select({
          id: schema.gradeLevels.id,
          code: schema.gradeLevels.code,
          name: schema.gradeLevels.name,
        })
        .from(schema.gradeLevels)
        .where(eq(schema.gradeLevels.campusId, campusId));
      const existingSections = await tx
        .select({
          id: schema.sections.id,
          gradeLevelId: schema.sections.gradeLevelId,
          name: schema.sections.name,
        })
        .from(schema.sections)
        .where(eq(schema.sections.academicYearId, year.id));
      const existingSubjects = await tx
        .select({ id: schema.subjects.id, code: schema.subjects.code, name: schema.subjects.name })
        .from(schema.subjects);
      const roles = await tx
        .select({ id: schema.roles.id, key: schema.roles.key, name: schema.roles.name })
        .from(schema.roles);
      const directory = await this.staffDirectory(tx);

      /* classes */
      const classes = new Map<string, Plan['classes'][number]>();
      const classOf = (code: string) => classes.get(code) ?? null;
      const ensureClass = (info: ClassInfo) => {
        if (!classes.has(info.code)) {
          const ex = existingClasses.find(
            (c) => c.code === info.code || norm(c.name) === norm(info.name),
          );
          classes.set(info.code, { ...info, existingId: ex?.id ?? null });
        }
        return classes.get(info.code)!;
      };
      for (const c of existingClasses) {
        const info = parseClassLabel(c.name) ?? parseClassLabel(c.code);
        if (info) classes.set(info.code, { ...info, code: info.code, existingId: c.id });
      }
      const sections: Plan['sections'] = [];
      for (const { row, cells } of book.classes) {
        const label = pick(cells, 'class', 'class_name', 'grade', 'standard');
        const sec = pick(cells, 'section', 'section_name', 'division').toUpperCase();
        const info = parseClassLabel(label);
        if (!info) {
          bad(
            'Classes',
            row,
            label
              ? `"${label}" is not a class we understand (try 1, Class 1, LKG, 11 Science)`
              : 'Class is empty',
          );
          continue;
        }
        if (!sec || sec.length > 10) {
          bad('Classes', row, 'Section is empty or too long (use A, B, Rose…)');
          continue;
        }
        const cls = ensureClass(info);
        if (sections.some((s) => s.classCode === info.code && s.name === sec)) {
          bad('Classes', row, `${info.name} ${sec} is listed twice`);
          continue;
        }
        const existing = cls.existingId
          ? existingSections.find(
              (s) => s.gradeLevelId === cls.existingId && s.name.toUpperCase() === sec,
            )
          : undefined;
        sections.push({
          classCode: info.code,
          name: sec,
          existingId: existing?.id ?? null,
          classTeacher: teacherRef(pick(cells, 'class_teacher', 'teacher', 'class_teacher_mobile')),
          row,
        });
      }
      const sectionKnown = (classCode: string, name: string) => {
        if (sections.some((s) => s.classCode === classCode && s.name === name)) return true;
        const cls = classOf(classCode);
        return (
          !!cls?.existingId &&
          existingSections.some(
            (s) => s.gradeLevelId === cls.existingId && s.name.toUpperCase() === name,
          )
        );
      };

      /* subjects */
      const subjects: Plan['subjects'] = [];
      const subjectBy = (text: string) => {
        const t = text.trim();
        return (
          subjects.find((s) => s.code === t.toUpperCase() || norm(s.name) === norm(t)) ??
          (() => {
            const ex = existingSubjects.find(
              (s) => s.code === t.toUpperCase() || norm(s.name) === norm(t),
            );
            if (!ex) return undefined;
            const entry = {
              code: ex.code,
              name: ex.name,
              existingId: ex.id,
              classCodes: [] as string[],
            };
            subjects.push(entry);
            return entry;
          })()
        );
      };
      for (const { row, cells } of book.subjects) {
        const name = pick(cells, 'subject', 'subject_name', 'name');
        let code = pick(cells, 'code', 'subject_code').toUpperCase().replace(/\s+/g, '');
        if (!name) {
          bad('Subjects', row, 'Subject name is empty');
          continue;
        }
        if (code && !/^[A-Z0-9][A-Z0-9_-]{0,14}$/.test(code)) {
          bad('Subjects', row, 'Code may have only letters, digits, - and _ (max 15)');
          continue;
        }
        const list = parseClassList(pick(cells, 'classes', 'class', 'taught_in'));
        if (list.bad.length) bad('Subjects', row, `Unknown classes: ${list.bad.join(', ')}`);
        const codes = list.all ? [...classes.keys()] : list.codes;
        for (const c of codes) {
          if (!classes.has(c)) {
            const info = parseClassLabel(c);
            if (info) ensureClass(info);
          }
        }
        const found = subjectBy(code || name);
        if (found) {
          found.classCodes = [...new Set([...found.classCodes, ...codes])];
          continue;
        }
        code ||= subjectCodeFrom(name);
        if (
          subjects.some((s) => s.code === code) ||
          existingSubjects.some((s) => s.code === code)
        ) {
          code = `${code.slice(0, 6)}${subjects.length + 1}`;
        }
        subjects.push({ code, name, existingId: null, classCodes: codes });
      }

      /* staff */
      const staff: Plan['staff'] = [];
      const roleFor = (text: string) => {
        const t = norm(text || 'teacher');
        return roles.find(
          (r) =>
            r.key !== 'owner' && r.key !== 'parent' && (norm(r.key) === t || norm(r.name) === t),
        );
      };
      for (const { row, cells } of book.staff) {
        const fullName = pick(cells, 'name', 'full_name', 'staff_name', 'teacher_name');
        const phoneRaw = pick(cells, 'mobile', 'phone', 'mobile_number', 'phone_number');
        const emailRaw = pick(cells, 'email', 'email_address');
        if (fullName.length < 2) {
          bad('Staff', row, 'Name is empty');
          continue;
        }
        const phone = phoneRaw ? indianPhoneSchema.safeParse(phoneRaw) : null;
        const email = emailRaw ? emailSchema.safeParse(emailRaw) : null;
        if (phone && !phone.success) {
          bad('Staff', row, `"${phoneRaw}" is not a valid mobile number`);
          continue;
        }
        if (email && !email.success) {
          bad('Staff', row, `"${emailRaw}" is not a valid email`);
          continue;
        }
        if (!phone && !email) {
          bad('Staff', row, 'Give a mobile number or an email');
          continue;
        }
        const role = roleFor(pick(cells, 'role', 'type'));
        if (!role) {
          bad(
            'Staff',
            row,
            `Unknown role "${pick(cells, 'role')}" (use Teacher, Accountant, Receptionist, Principal…)`,
          );
          continue;
        }
        const p = phone?.success ? phone.data : null;
        const e = email?.success ? email.data : null;
        if (staff.some((s) => (p && s.phone === p) || (e && s.email === e))) {
          bad('Staff', row, `${fullName} is listed twice`);
          continue;
        }
        const ex = directory.find(
          (d) =>
            (p && (d.loginPhone === p || d.profilePhone === p)) ||
            (e && d.email?.toLowerCase() === e.toLowerCase()),
        );
        staff.push({
          fullName,
          phone: p,
          email: p ? null : e,
          designation: pick(cells, 'designation', 'post'),
          employeeCode: pick(cells, 'employee_code', 'emp_code', 'code') || null,
          roleId: role.id,
          roleName: role.name,
          existingMembershipId: ex?.membershipId ?? null,
        });
      }
      const teacherKnown = (ref: TeacherRef) =>
        staff.some(
          (s) =>
            (ref.phone && s.phone === ref.phone) ||
            (ref.email && s.email?.toLowerCase() === ref.email.toLowerCase()) ||
            (ref.name && norm(s.fullName) === norm(ref.name)),
        ) ||
        directory.some(
          (d) =>
            (ref.phone && (d.loginPhone === ref.phone || d.profilePhone === ref.phone)) ||
            (ref.email && d.email?.toLowerCase() === ref.email.toLowerCase()) ||
            (ref.name && norm(d.fullName) === norm(ref.name)),
        );
      for (const s of sections) {
        if (s.classTeacher && !teacherKnown(s.classTeacher)) {
          bad(
            'Classes',
            s.row,
            `Class teacher "${s.classTeacher.text}" is not in the Staff sheet or the school's staff`,
          );
        }
      }

      /* teaching */
      const teaching: Plan['teaching'] = [];
      for (const { row, cells } of book.teaching) {
        const info = parseClassLabel(pick(cells, 'class', 'class_name', 'grade'));
        const sec = pick(cells, 'section', 'division').toUpperCase();
        const subjText = pick(cells, 'subject', 'subject_code', 'subject_name');
        const ref = teacherRef(pick(cells, 'teacher', 'teacher_mobile', 'mobile', 'teacher_name'));
        if (!info) {
          bad('Teaching', row, `Unknown class "${pick(cells, 'class')}"`);
          continue;
        }
        if (!sectionKnown(info.code, sec)) {
          bad(
            'Teaching',
            row,
            `${info.name} ${sec || '(no section)'} is not in the Classes sheet or the school`,
          );
          continue;
        }
        const subj = subjText ? subjectBy(subjText) : undefined;
        if (!subj) {
          bad('Teaching', row, `Subject "${subjText}" is not in the Subjects sheet or the school`);
          continue;
        }
        if (!subj.classCodes.includes(info.code)) subj.classCodes.push(info.code);
        if (!ref || !teacherKnown(ref)) {
          bad(
            'Teaching',
            row,
            `Teacher "${ref?.text ?? ''}" is not in the Staff sheet or the school's staff`,
          );
          continue;
        }
        teaching.push({
          classCode: info.code,
          section: sec,
          subjectCode: subj.code,
          teacher: ref,
          row,
        });
      }

      const plan: Plan = { classes: [...classes.values()], sections, subjects, staff, teaching };
      const usedClassCodes = new Set([
        ...sections.map((s) => s.classCode),
        ...subjects.flatMap((s) => s.classCodes),
      ]);
      plan.classes = plan.classes.filter((c) => usedClassCodes.has(c.code));
      const summary = {
        yearName: year.name,
        newClasses: plan.classes.filter((c) => !c.existingId).length,
        newSections: sections.filter((s) => !s.existingId).length,
        newSubjects: subjects.filter((s) => !s.existingId).length,
        subjectLinks: subjects.reduce((n, s) => n + s.classCodes.length, 0),
        newStaff: staff.filter((s) => !s.existingMembershipId).length,
        existingStaff: staff.filter((s) => s.existingMembershipId).length,
        classTeachers: sections.filter((s) => s.classTeacher).length,
        teaching: teaching.length,
      };
      const [row] = await tx
        .insert(imp)
        .values({
          tenantId: access.tenantId,
          campusId,
          academicYearId: year.id,
          fileName: (file!.originalname || 'workbook.xlsx').slice(0, 200),
          plan: plan as unknown as Record<string, unknown>,
          problems,
          summary,
          createdBy: access.userId,
        })
        .returning({ id: imp.id });
      return {
        id: row!.id,
        status: 'previewed',
        summary,
        problems: problems.slice(0, 500),
        problemCount: problems.length,
        plan: {
          classes: plan.classes.map((c) => ({ name: c.name, isNew: !c.existingId })),
          sections: sections.map((s) => ({
            className: classes.get(s.classCode)!.name,
            name: s.name,
            isNew: !s.existingId,
            classTeacher: s.classTeacher?.text ?? null,
          })),
          subjects: subjects.map((s) => ({
            code: s.code,
            name: s.name,
            isNew: !s.existingId,
            classes: s.classCodes.map((c) => classes.get(c)?.name ?? c),
          })),
          staff: staff.map((s) => ({
            fullName: s.fullName,
            contact: s.phone ?? s.email,
            role: s.roleName,
            designation: s.designation,
            isNew: !s.existingMembershipId,
          })),
          teaching: teaching.map((t) => ({
            className: classes.get(t.classCode)?.name ?? t.classCode,
            section: t.section,
            subject: subjects.find((s) => s.code === t.subjectCode)?.name ?? t.subjectCode,
            teacher: t.teacher.text,
          })),
        },
      };
    });
  }

  /* ----------------------------------------- apply ----------------------------------------- */

  private async row(tx: Transaction, access: TenantAccess, id: string) {
    const [r] = await tx.select().from(imp).where(eq(imp.id, id));
    if (!r || !access.has('academic.manage', r.campusId)) throw notFound('Import');
    return r;
  }

  async apply(access: TenantAccess, id: string) {
    const mails: PendingMail[] = [];
    const result = await withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`setup:${access.tenantId}`}, 0))`,
      );
      const r = await this.row(tx, access, id);
      if (r.status !== 'previewed')
        throw new AppError('CONFLICT', `This import is already ${r.status}`);
      if ((r.problems as unknown[]).length) {
        throw new AppError('CONFLICT', 'Fix the problems in the workbook and upload it again');
      }
      const plan = r.plan as unknown as Plan;
      if (plan.staff.length && !access.has('members.manage')) {
        throw new AppError(
          'FORBIDDEN',
          'Only someone who manages staff can import the Staff sheet',
        );
      }
      const year = await this.yearFor(tx, r.campusId, r.academicYearId);
      const created: Created = {
        gradeLevels: [],
        sections: [],
        subjects: [],
        classSubjects: [],
        memberships: [],
        teaching: [],
        classTeachers: [],
      };

      /* classes and sections */
      const classId = new Map<string, string>();
      for (const c of plan.classes) {
        const [ex] = await tx
          .select({ id: schema.gradeLevels.id })
          .from(schema.gradeLevels)
          .where(
            and(
              eq(schema.gradeLevels.campusId, r.campusId),
              sql`(${schema.gradeLevels.code} = ${c.code} or lower(${schema.gradeLevels.name}) = lower(${c.name}))`,
            ),
          );
        if (ex) {
          classId.set(c.code, ex.id);
          continue;
        }
        const [ins] = await tx
          .insert(schema.gradeLevels)
          .values({
            tenantId: access.tenantId,
            campusId: r.campusId,
            code: c.code,
            name: c.name,
            stage: c.stage,
            sortOrder: c.sortOrder,
          })
          .returning({ id: schema.gradeLevels.id });
        classId.set(c.code, ins!.id);
        created.gradeLevels.push(ins!.id);
      }
      const sectionId = new Map<string, string>();
      const allSections = async () =>
        tx
          .select({
            id: schema.sections.id,
            gradeLevelId: schema.sections.gradeLevelId,
            name: schema.sections.name,
          })
          .from(schema.sections)
          .where(eq(schema.sections.academicYearId, year.id));
      for (const s of await allSections()) {
        for (const [code, gid] of classId)
          if (gid === s.gradeLevelId) sectionId.set(`${code}|${s.name.toUpperCase()}`, s.id);
      }
      for (const s of plan.sections) {
        const key = `${s.classCode}|${s.name}`;
        if (sectionId.has(key)) continue;
        const [ins] = await tx
          .insert(schema.sections)
          .values({
            tenantId: access.tenantId,
            campusId: r.campusId,
            academicYearId: year.id,
            gradeLevelId: classId.get(s.classCode)!,
            name: s.name,
          })
          .returning({ id: schema.sections.id });
        sectionId.set(key, ins!.id);
        created.sections.push(ins!.id);
      }

      /* subjects */
      const subjectId = new Map<string, string>();
      for (const s of plan.subjects) {
        const [ex] = await tx
          .select({ id: schema.subjects.id })
          .from(schema.subjects)
          .where(
            sql`${schema.subjects.code} = ${s.code} or lower(${schema.subjects.name}) = lower(${s.name})`,
          );
        let sid = ex?.id;
        if (!sid) {
          const [ins] = await tx
            .insert(schema.subjects)
            .values({ tenantId: access.tenantId, code: s.code, name: s.name })
            .returning({ id: schema.subjects.id });
          sid = ins!.id;
          created.subjects.push(sid);
        }
        subjectId.set(s.code, sid);
        for (const cc of s.classCodes) {
          const gid = classId.get(cc);
          if (!gid) continue;
          const ins = await tx
            .insert(schema.classSubjects)
            .values({ tenantId: access.tenantId, gradeLevelId: gid, subjectId: sid })
            .onConflictDoNothing()
            .returning({ id: schema.classSubjects.id });
          if (ins[0]) created.classSubjects.push(ins[0].id);
        }
      }

      /* staff */
      const staffLinks: Array<{ fullName: string; phone: string; url: string; message: string }> =
        [];
      for (const s of plan.staff) {
        if (s.existingMembershipId) continue;
        const inv = await this.members.inviteInTx(
          tx,
          access,
          {
            ...(s.phone ? { phone: s.phone } : { email: s.email! }),
            fullName: s.fullName,
            designation: s.designation,
            employeeCode: s.employeeCode ?? undefined,
            assignments: [{ roleId: s.roleId, campusId: r.campusId }],
          },
          mails,
        );
        created.memberships.push(inv.id);
        if (inv.link) staffLinks.push({ fullName: s.fullName, ...inv.link });
      }
      const directory = await this.staffDirectory(tx);
      const memberFor = (ref: TeacherRef) =>
        directory.find(
          (d) =>
            (ref.phone && (d.loginPhone === ref.phone || d.profilePhone === ref.phone)) ||
            (ref.email && d.email?.toLowerCase() === ref.email.toLowerCase()),
        ) ?? directory.find((d) => ref.name && norm(d.fullName) === norm(ref.name));

      /* class teachers */
      for (const s of plan.sections) {
        if (!s.classTeacher) continue;
        const who = memberFor(s.classTeacher);
        if (!who)
          throw new AppError(
            'CONFLICT',
            `Class teacher "${s.classTeacher.text}" was not found; preview again`,
          );
        const sid = sectionId.get(`${s.classCode}|${s.name}`)!;
        const [before] = await tx
          .select({ ct: schema.sections.classTeacherMembershipId })
          .from(schema.sections)
          .where(eq(schema.sections.id, sid));
        if (before?.ct === who.membershipId) continue;
        await tx
          .update(schema.sections)
          .set({ classTeacherMembershipId: who.membershipId, updatedAt: new Date() })
          .where(eq(schema.sections.id, sid));
        created.classTeachers.push({ sectionId: sid, before: before?.ct ?? null });
      }

      /* teaching */
      for (const t of plan.teaching) {
        const who = memberFor(t.teacher);
        const sid =
          sectionId.get(`${t.classCode}|${t.section}`) ??
          (await allSections()).find(
            (s) =>
              s.gradeLevelId === classId.get(t.classCode) && s.name.toUpperCase() === t.section,
          )?.id;
        const subj = subjectId.get(t.subjectCode);
        if (!who || !sid || !subj)
          throw new AppError('CONFLICT', 'The school changed since the preview; preview again');
        const ins = await tx
          .insert(schema.teachingAssignments)
          .values({
            tenantId: access.tenantId,
            sectionId: sid,
            subjectId: subj,
            membershipId: who.membershipId,
            createdBy: access.userId,
          })
          .onConflictDoNothing()
          .returning({ id: schema.teachingAssignments.id });
        if (ins[0]) created.teaching.push(ins[0].id);
      }

      await tx
        .update(imp)
        .set({
          status: 'applied',
          appliedAt: new Date(),
          created: created as unknown as Record<string, unknown>,
        })
        .where(eq(imp.id, id));
      await this.audit.record(tx, access, {
        action: 'setup.imported',
        entity: 'setup_import',
        entityId: id,
        campusId: r.campusId,
        diff: Object.fromEntries(
          Object.entries(created).map(([k, v]) => [k, (v as unknown[]).length]),
        ),
      });
      return {
        id,
        status: 'applied',
        added: Object.fromEntries(
          Object.entries(created).map(([k, v]) => [k, (v as unknown[]).length]),
        ),
        staffLinks,
      };
    });
    await this.members.sendMails(mails);
    return result;
  }

  /* ------------------------------------------ undo ------------------------------------------ */

  undo(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`setup:${access.tenantId}`}, 0))`,
      );
      const r = await this.row(tx, access, id);
      if (r.status !== 'applied')
        throw new AppError('CONFLICT', `This import is ${r.status}; nothing to undo`);
      const c = r.created as unknown as Created;
      const enrolled = c.sections.length
        ? (
            (
              await tx.execute(sql`
              select count(*)::int as n from student_enrollments where section_id in (${sql.join(
                c.sections.map((s) => sql`${s}`),
                sql`, `,
              )})`)
            ).rows[0] as { n: number }
          ).n
        : 0;
      if (enrolled) {
        throw new AppError(
          'CONFLICT',
          `Students have been added to the imported sections (${enrolled}). Undo is no longer possible; change things by hand.`,
        );
      }
      if (c.teaching.length) {
        await tx
          .delete(schema.teachingAssignments)
          .where(inArray(schema.teachingAssignments.id, c.teaching));
      }
      for (const ct of c.classTeachers) {
        await tx
          .update(schema.sections)
          .set({ classTeacherMembershipId: ct.before, updatedAt: new Date() })
          .where(eq(schema.sections.id, ct.sectionId));
      }
      // Staff who already signed in keep their account; the others are removed again.
      let keptStaff = 0;
      if (c.memberships.length) {
        const rows = await tx
          .select({ id: schema.tenantMemberships.id, status: schema.tenantMemberships.status })
          .from(schema.tenantMemberships)
          .where(inArray(schema.tenantMemberships.id, c.memberships));
        const invited = rows.filter((x) => x.status === 'invited').map((x) => x.id);
        keptStaff = rows.length - invited.length;
        if (invited.length) {
          await tx
            .delete(schema.tenantMemberships)
            .where(inArray(schema.tenantMemberships.id, invited));
        }
      }
      try {
        if (c.sections.length)
          await tx.delete(schema.sections).where(inArray(schema.sections.id, c.sections));
        if (c.classSubjects.length) {
          await tx
            .delete(schema.classSubjects)
            .where(inArray(schema.classSubjects.id, c.classSubjects));
        }
        if (c.gradeLevels.length) {
          await tx.delete(schema.gradeLevels).where(inArray(schema.gradeLevels.id, c.gradeLevels));
        }
        if (c.subjects.length)
          await tx.delete(schema.subjects).where(inArray(schema.subjects.id, c.subjects));
      } catch {
        throw new AppError(
          'CONFLICT',
          'Some imported classes or subjects are already in use (fees, exams or other records). Undo is no longer possible.',
        );
      }
      await tx.update(imp).set({ status: 'undone', undoneAt: new Date() }).where(eq(imp.id, id));
      await this.audit.record(tx, access, {
        action: 'setup.undone',
        entity: 'setup_import',
        entityId: id,
        campusId: r.campusId,
        diff: { keptStaff },
      });
      return { id, status: 'undone', keptStaff };
    });
  }

  cancel(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const r = await this.row(tx, access, id);
      if (r.status !== 'previewed')
        throw new AppError('CONFLICT', `This import is already ${r.status}`);
      await tx.update(imp).set({ status: 'cancelled' }).where(eq(imp.id, id));
      return { id, status: 'cancelled' };
    });
  }

  list(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!access.has('academic.manage', campusId)) throw notFound('Campus');
        const rows = (
          await tx.execute(sql`
            select i.id, i.status, i.file_name as "fileName", i.summary, jsonb_array_length(i.problems)::int as "problemCount",
              i.created_at as "createdAt", i.applied_at as "appliedAt", i.undone_at as "undoneAt", u.full_name as "byName"
            from setup_imports i left join users u on u.id = i.created_by
            where i.campus_id = ${campusId} order by i.created_at desc limit 20`)
        ).rows;
        return { items: rows };
      },
      { readOnly: true },
    );
  }
}
