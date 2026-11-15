import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  importRowSchema,
  maskAadhaar,
  normaliseHeader,
  validateCustomValues,
} from '@school-erp/validation';
import type { ImportRow } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { StudentsService } from '../students/students.service.js';
import { PiiVault } from '../students/pii-vault.js';
import { CustomFieldsService } from './custom-fields.service.js';

const st = schema.students;
const jobs = schema.importJobs;

interface Problem {
  row: number;
  field: string;
  message: string;
}

/** A validated row ready to import (row = line number in the file, header = 1). */
interface ReadyRow {
  row: number;
  data: ImportRow;
  sectionId: string;
  custom: Record<string, string | number>;
}

interface ReportLine {
  row: number;
  status: 'created' | 'failed';
  admissionNumber?: string;
  studentId?: string;
  message?: string;
}

/** Byte-order mark so Excel opens UTF-8 (Hindi names) correctly. */
const BOM = String.fromCharCode(0xfeff);

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const toCsv = (header: string[], rows: unknown[][]) =>
  // BOM so Excel opens Hindi names correctly.
  `${BOM}${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v);
};

@Injectable()
export class ImportExportService {
  private readonly logger = new Logger(ImportExportService.name);

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
    private readonly customFields: CustomFieldsService,
    private readonly vault: PiiVault,
  ) {}

  /* --------------------------------------- export --------------------------------------- */

  async exportCsv(
    access: TenantAccess,
    q: {
      campusId?: string;
      academicYearId?: string;
      gradeLevelId?: string;
      sectionId?: string;
      status?: 'active' | 'withdrawn' | 'alumni';
      q?: string;
    },
  ): Promise<{ csv: string; count: number }> {
    const scope = access.scopeOf('students.export');
    if (scope !== null && !scope.size)
      throw new AppError('FORBIDDEN', 'You cannot export students');
    const list = await this.students.list(
      access,
      { ...q, limit: 100 },
      { all: true, exportScope: scope },
    );
    const ids = list.data.map((r) => r.id);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const defs = (await this.customFields.definitions(tx, 'student')).filter((d) => !d.archived);
      const details = ids.length ? await tx.select().from(st).where(inArray(st.id, ids)) : [];
      const guardians = ids.length
        ? await tx
            .select({
              studentId: schema.studentGuardians.studentId,
              isPrimary: schema.studentGuardians.isPrimary,
              relationship: schema.studentGuardians.relationship,
              name: schema.guardians.fullName,
              phone: schema.guardians.phone,
              email: schema.guardians.email,
            })
            .from(schema.studentGuardians)
            .innerJoin(
              schema.guardians,
              and(
                eq(schema.guardians.tenantId, schema.studentGuardians.tenantId),
                eq(schema.guardians.id, schema.studentGuardians.guardianId),
              ),
            )
            .where(inArray(schema.studentGuardians.studentId, ids))
        : [];
      const byId = new Map(details.map((d) => [d.id, d]));
      const header = [...IMPORT_COLUMNS, 'status', ...defs.map((d) => `cf_${d.key}`)];
      const rows = list.data.map((r) => {
        const s = byId.get(r.id)!;
        const gs = guardians
          .filter((g) => g.studentId === r.id)
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
        const [p1, p2] = gs;
        return [
          s.admissionNumber,
          s.firstName,
          s.lastName,
          s.nameLocal,
          s.dateOfBirth,
          s.gender,
          r.className,
          r.sectionName,
          r.rollNumber,
          s.admissionDate,
          s.bloodGroup,
          s.address,
          s.pen,
          s.apaarId,
          s.aadhaarLast4 ? maskAadhaar(s.aadhaarLast4) : '',
          p1?.name,
          p1?.phone,
          p1?.relationship,
          p1?.email,
          p2?.name,
          p2?.phone,
          p2?.relationship,
          s.status,
          ...defs.map((d) => s.customFields[d.key]),
        ];
      });
      await this.audit.record(tx, access, {
        action: 'students.exported',
        entity: 'student',
        entityId: null,
        campusId: q.campusId ?? null,
        diff: { count: rows.length, filters: q },
      });
      return { csv: toCsv(header, rows), count: rows.length };
    });
  }

  /** Empty template with the school's custom fields, plus one example row. */
  async template(access: TenantAccess): Promise<string> {
    const defs = await withTenant(
      this.handle.db,
      access.ctx,
      (tx) => this.customFields.definitions(tx, 'student'),
      { readOnly: true },
    );
    const active = defs.filter((d) => !d.archived);
    const header = [...IMPORT_COLUMNS, ...active.map((d) => `cf_${d.key}`)];
    const example = [
      '',
      'Aarav',
      'Sharma',
      '',
      '15-06-2019',
      'M',
      'Class 1',
      'A',
      '',
      '',
      'B+',
      'Jaipur',
      '',
      '',
      '',
      'Rakesh Sharma',
      '9829012345',
      'father',
      '',
      'Sunita Sharma',
      '9829054321',
      'mother',
      ...active.map((d) => (d.fieldType === 'select' ? d.options[0] : '')),
    ];
    return toCsv(header, [example]);
  }

  /* --------------------------------------- import --------------------------------------- */

  private async readRows(file: {
    buffer: Buffer;
    originalname: string;
  }): Promise<Array<Record<string, string>>> {
    const isXlsx =
      /\.xlsx$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString('latin1') === 'PK';
    if (isXlsx) {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
      } catch {
        throw new AppError('VALIDATION_FAILED', 'This Excel file could not be read');
      }
      const ws = wb.worksheets[0];
      if (!ws) return [];
      const headers: string[] = [];
      ws.getRow(1).eachCell(
        { includeEmpty: true },
        (c, i) => (headers[i - 1] = normaliseHeader(cellText(c.value))),
      );
      const out: Array<Record<string, string>> = [];
      for (let r = 2; r <= Math.min(ws.rowCount, IMPORT_MAX_ROWS + 2); r++) {
        const row = ws.getRow(r);
        const rec: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (h) rec[h] = cellText(row.getCell(i + 1).value).trim();
        });
        out.push(rec);
      }
      return out;
    }
    const text = file.buffer.toString('utf8').replace(new RegExp(`^${BOM}`), '');
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normaliseHeader,
      transform: (v) => v.trim(),
    });
    return parsed.data;
  }

  preview(
    access: TenantAccess,
    campusId: string,
    academicYearId: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError('VALIDATION_FAILED', 'Choose a CSV or Excel file', {
        fields: { file: 'Required' },
      });
    }
    if (file.size > IMPORT_MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'Files can be at most 2 MB', {
        fields: { file: 'Too large' },
      });
    }
    if (!access.has('students.import', campusId)) throw notFound('Campus');
    return (async () => {
      const raw = (await this.readRows(file)).filter((r) => Object.values(r).some((v) => v));
      if (!raw.length) throw new AppError('VALIDATION_FAILED', 'The file has no student rows');
      if (raw.length > IMPORT_MAX_ROWS) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Import at most ${IMPORT_MAX_ROWS} students at a time`,
        );
      }
      return withTenant(this.handle.db, access.ctx, async (tx) => {
        const [year] = await tx
          .select({
            id: schema.academicYears.id,
            status: schema.academicYears.status,
            campusId: schema.academicYears.campusId,
          })
          .from(schema.academicYears)
          .where(eq(schema.academicYears.id, academicYearId));
        if (!year || year.campusId !== campusId) throw notFound('Academic year');
        if (year.status === 'closed')
          throw new AppError('CONFLICT', 'This academic year is closed', { reason: 'year_closed' });

        const sections = await tx
          .select({
            id: schema.sections.id,
            name: schema.sections.name,
            className: schema.gradeLevels.name,
            classCode: schema.gradeLevels.code,
          })
          .from(schema.sections)
          .innerJoin(
            schema.gradeLevels,
            and(
              eq(schema.gradeLevels.tenantId, schema.sections.tenantId),
              eq(schema.gradeLevels.id, schema.sections.gradeLevelId),
            ),
          )
          .where(eq(schema.sections.academicYearId, academicYearId));
        const sectionKey = (cls: string, secName: string) =>
          `${cls.trim().toLowerCase()}|${secName.trim().toLowerCase()}`;
        const sectionMap = new Map<string, string>();
        for (const s of sections) {
          sectionMap.set(sectionKey(s.className, s.name), s.id);
          sectionMap.set(sectionKey(s.classCode, s.name), s.id);
        }
        const defs = await this.customFields.definitions(tx, 'student');

        const problems: Problem[] = [];
        const ready: ReadyRow[] = [];
        raw.forEach((rec, i) => {
          const row = i + 2;
          const custom: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rec)) if (k.startsWith('cf_')) custom[k.slice(3)] = v;
          const parsed = importRowSchema.safeParse(rec);
          const rowProblems: Problem[] = [];
          if (!parsed.success) {
            for (const issue of parsed.error.issues) {
              rowProblems.push({ row, field: String(issue.path[0] ?? ''), message: issue.message });
            }
          }
          const cv = validateCustomValues(defs, custom);
          for (const [k, m] of Object.entries(cv.errors))
            rowProblems.push({ row, field: `cf_${k}`, message: m });
          const sectionId = parsed.success
            ? sectionMap.get(sectionKey(parsed.data.class, parsed.data.section))
            : undefined;
          if (parsed.success && !sectionId) {
            rowProblems.push({
              row,
              field: 'section',
              message: `No section "${parsed.data.section}" in "${parsed.data.class}" for this year`,
            });
          }
          if (rowProblems.length || !parsed.success) problems.push(...rowProblems);
          else ready.push({ row, data: parsed.data, sectionId: sectionId!, custom: cv.values });
        });

        // Duplicates inside the file.
        const seen = new Map<string, number>();
        const dupInFile = (key: string | null, r: ReadyRow, field: string, what: string) => {
          if (!key) return false;
          const first = seen.get(`${field}|${key}`);
          if (first) {
            problems.push({ row: r.row, field, message: `Same ${what} as row ${first}` });
            return true;
          }
          seen.set(`${field}|${key}`, r.row);
          return false;
        };
        const unique = ready.filter((r) => {
          const d = r.data;
          const person = `${d.first_name}|${d.last_name ?? ''}|${d.date_of_birth}`.toLowerCase();
          return ![
            dupInFile(d.admission_number, r, 'admission_number', 'admission number'),
            dupInFile(d.aadhaar, r, 'aadhaar', 'Aadhaar'),
            dupInFile(d.pen, r, 'pen', 'PEN'),
            dupInFile(d.apaar_id, r, 'apaar_id', 'APAAR ID'),
            dupInFile(person, r, 'first_name', 'name and date of birth'),
          ].some(Boolean);
        });

        // Duplicates against students already in the school.
        const inDb = async (column: 'admissionNumber' | 'pen' | 'apaarId', values: string[]) =>
          values.length
            ? new Set(
                (
                  await tx
                    .select({ v: st[column] })
                    .from(st)
                    .where(and(isNotNull(st[column]), inArray(st[column], values)))
                ).map((x) => x.v as string),
              )
            : new Set<string>();
        const takenNumbers = await inDb(
          'admissionNumber',
          unique.flatMap((r) => (r.data.admission_number ? [r.data.admission_number] : [])),
        );
        const takenPen = await inDb(
          'pen',
          unique.flatMap((r) => (r.data.pen ? [r.data.pen] : [])),
        );
        const takenApaar = await inDb(
          'apaarId',
          unique.flatMap((r) => (r.data.apaar_id ? [r.data.apaar_id] : [])),
        );
        const aadhaarIndexes = unique.flatMap((r) =>
          r.data.aadhaar ? [this.vault.index(r.data.aadhaar, access.tenantId, 'aadhaar')] : [],
        );
        const takenAadhaar = aadhaarIndexes.length
          ? new Set(
              (
                await tx
                  .select({ v: st.aadhaarIndex })
                  .from(st)
                  .where(inArray(st.aadhaarIndex, aadhaarIndexes))
              ).map((x) => x.v),
            )
          : new Set<string | null>();
        const people = await tx
          .select({
            key: sql<string>`lower(${st.firstName} || '|' || ${st.lastName} || '|' || ${st.dateOfBirth})`,
            admissionNumber: st.admissionNumber,
          })
          .from(st);
        const personMap = new Map(people.map((p) => [p.key, p.admissionNumber]));

        const finalRows = unique.filter((r) => {
          const d = r.data;
          const issues: Problem[] = [];
          if (d.admission_number && takenNumbers.has(d.admission_number))
            issues.push({
              row: r.row,
              field: 'admission_number',
              message: 'Admission number already used in the school',
            });
          if (d.pen && takenPen.has(d.pen))
            issues.push({
              row: r.row,
              field: 'pen',
              message: 'PEN already recorded for another student',
            });
          if (d.apaar_id && takenApaar.has(d.apaar_id))
            issues.push({
              row: r.row,
              field: 'apaar_id',
              message: 'APAAR ID already recorded for another student',
            });
          if (
            d.aadhaar &&
            takenAadhaar.has(this.vault.index(d.aadhaar, access.tenantId, 'aadhaar'))
          )
            issues.push({
              row: r.row,
              field: 'aadhaar',
              message: 'Aadhaar already recorded for another student',
            });
          const existing = personMap.get(
            `${d.first_name}|${d.last_name ?? ''}|${d.date_of_birth}`.toLowerCase(),
          );
          if (existing)
            issues.push({
              row: r.row,
              field: 'first_name',
              message: `Looks like existing student ${existing} (same name and date of birth)`,
            });
          problems.push(...issues);
          return !issues.length;
        });
        problems.sort((a, b) => a.row - b.row);

        const [job] = await tx
          .insert(jobs)
          .values({
            tenantId: access.tenantId,
            campusId,
            academicYearId,
            fileName: file.originalname.slice(0, 200),
            totalRows: raw.length,
            validRows: finalRows.length,
            rows: finalRows as unknown as unknown[],
            problems: problems.slice(0, 1000) as unknown as unknown[],
            createdBy: access.userId,
          })
          .returning({ id: jobs.id });
        return {
          jobId: job!.id,
          totalRows: raw.length,
          validRows: finalRows.length,
          problems: problems.slice(0, 500),
          sample: finalRows.slice(0, 10).map((r) => ({
            row: r.row,
            name: `${r.data.first_name} ${r.data.last_name ?? ''}`.trim(),
            dateOfBirth: r.data.date_of_birth,
            class: `${r.data.class} ${r.data.section}`,
            parent: r.data.parent_name,
            admissionNumber: r.data.admission_number ?? '(new)',
          })),
        };
      });
    })();
  }

  get(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            campusId: jobs.campusId,
            status: jobs.status,
            fileName: jobs.fileName,
            totalRows: jobs.totalRows,
            validRows: jobs.validRows,
            problems: jobs.problems,
            report: jobs.report,
            createdAt: jobs.createdAt,
            finishedAt: jobs.finishedAt,
          })
          .from(jobs)
          .where(eq(jobs.id, id));
        if (!job || !access.has('students.import', job.campusId)) throw notFound('Import');
        const report = job.report as ReportLine[];
        return {
          ...job,
          created: report.filter((r) => r.status === 'created').length,
          failed: report.filter((r) => r.status === 'failed').length,
        };
      },
      { readOnly: true },
    );
  }

  list(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const rows = await tx
          .select({
            id: jobs.id,
            campusId: jobs.campusId,
            status: jobs.status,
            fileName: jobs.fileName,
            totalRows: jobs.totalRows,
            validRows: jobs.validRows,
            createdAt: jobs.createdAt,
            finishedAt: jobs.finishedAt,
          })
          .from(jobs)
          .orderBy(desc(jobs.createdAt))
          .limit(20);
        return rows.filter((r) => access.has('students.import', r.campusId));
      },
      { readOnly: true },
    );
  }

  /**
   * Starts importing the valid rows in the background. Each student is admitted in its own
   * transaction, so one bad row never undoes the others; progress is saved as it goes and
   * an interrupted import can be resumed (rows already done are skipped).
   */
  confirm(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
      if (!job || !access.has('students.import', job.campusId)) throw notFound('Import');
      const resumable =
        job.status === 'processing' &&
        Date.now() - (job.finishedAt ?? job.createdAt).getTime() > 10 * 60_000;
      if (job.status !== 'previewed' && !resumable) {
        throw new AppError('CONFLICT', `This import is ${job.status}`, {
          reason: 'import_not_ready',
        });
      }
      if (!job.validRows)
        throw new AppError('CONFLICT', 'No valid rows to import', { reason: 'nothing_to_import' });
      // finished_at doubles as "last progress" while processing.
      await tx
        .update(jobs)
        .set({ status: 'processing', finishedAt: new Date() })
        .where(eq(jobs.id, id));
      await this.audit.record(tx, access, {
        action: 'students.import_started',
        entity: 'import',
        entityId: id,
        campusId: job.campusId,
        diff: { fileName: job.fileName, rows: job.validRows },
      });
      setImmediate(() => {
        this.process(access, id).catch((e: unknown) =>
          this.logger.error(`Import ${id} failed: ${String(e)}`),
        );
      });
      return { status: 'processing' };
    });
  }

  cancel(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [job] = await tx
        .select({ campusId: jobs.campusId, status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, id));
      if (!job || !access.has('students.import', job.campusId)) throw notFound('Import');
      if (job.status !== 'previewed')
        throw new AppError('CONFLICT', `This import is ${job.status}`);
      await tx
        .update(jobs)
        .set({ status: 'cancelled', rows: [], finishedAt: new Date() })
        .where(eq(jobs.id, id));
    });
  }

  /** Exposed for tests: runs the import to completion. */
  async process(access: TenantAccess, id: string): Promise<void> {
    const job = await withTenant(this.handle.db, access.ctx, async (tx) => {
      const [j] = await tx.select().from(jobs).where(eq(jobs.id, id));
      return j!;
    });
    const rows = job.rows as unknown as ReadyRow[];
    const report = [...(job.report as unknown as ReportLine[])];
    const done = new Set(report.map((r) => r.row));
    const save = (status?: 'completed') =>
      withTenant(this.handle.db, access.ctx, (tx) =>
        tx
          .update(jobs)
          .set({
            report: report as unknown as unknown[],
            finishedAt: new Date(),
            ...(status ? { status, rows: [] } : {}),
          })
          .where(eq(jobs.id, id)),
      );

    for (const r of rows) {
      if (done.has(r.row)) continue;
      const d = r.data;
      try {
        const result = await withTenant(this.handle.db, access.ctx, async (tx) => {
          // Reuse a parent already in the school with the same mobile and name (siblings).
          const findParent = async (name: string, phone: string) => {
            const [g] = await tx
              .select({ id: schema.guardians.id })
              .from(schema.guardians)
              .where(
                and(
                  eq(schema.guardians.phone, phone),
                  sql`lower(${schema.guardians.fullName}) = lower(${name})`,
                ),
              )
              .limit(1);
            return g?.id ?? null;
          };
          const parent = async (
            name: string,
            phone: string,
            rel: string,
            primary: boolean,
            email: string | null,
          ) => {
            const existing = await findParent(name, phone);
            return existing
              ? {
                  guardianId: existing,
                  relationship: rel as never,
                  isPrimary: primary,
                  isFeePayer: primary,
                }
              : {
                  fullName: name,
                  phone,
                  email,
                  occupation: null,
                  relationship: rel as never,
                  isPrimary: primary,
                  isFeePayer: primary,
                };
          };
          const guardians = [
            await parent(
              d.parent_name,
              d.parent_phone,
              d.parent_relationship ?? 'guardian',
              true,
              d.parent_email,
            ),
          ];
          if (d.second_parent_name && d.second_parent_phone) {
            guardians.push(
              await parent(
                d.second_parent_name,
                d.second_parent_phone,
                d.second_parent_relationship ?? 'guardian',
                false,
                null,
              ),
            );
          }
          return this.students.admitInTx(
            tx,
            access,
            {
              firstName: d.first_name,
              lastName: d.last_name ?? '',
              nameLocal: d.name_hindi,
              dateOfBirth: d.date_of_birth,
              gender: d.gender,
              bloodGroup: d.blood_group,
              address: d.address,
              pen: d.pen,
              apaarId: d.apaar_id,
              aadhaar: d.aadhaar,
              customFields: r.custom,
              admissionDate: d.admission_date ?? undefined,
              sectionId: r.sectionId,
              rollNumber: d.roll_number,
              guardians,
              privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
            },
            { admissionNumber: d.admission_number, requireCustomFields: true },
          );
        });
        report.push({
          row: r.row,
          status: 'created',
          admissionNumber: result.admissionNumber,
          studentId: result.id,
        });
      } catch (e) {
        report.push({
          row: r.row,
          status: 'failed',
          message: e instanceof AppError ? e.message : 'Unexpected error',
        });
        if (!(e instanceof AppError)) this.logger.error(`Import ${id} row ${r.row}: ${String(e)}`);
      }
      if (report.length % 25 === 0) await save();
    }
    await save('completed');
    await withTenant(this.handle.db, access.ctx, (tx) =>
      this.audit.record(tx, access, {
        action: 'students.imported',
        entity: 'import',
        entityId: id,
        campusId: job.campusId,
        diff: {
          created: report.filter((x) => x.status === 'created').length,
          failed: report.filter((x) => x.status === 'failed').length,
        },
      }),
    );
  }
}
