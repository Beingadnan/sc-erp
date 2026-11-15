import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { InquiryCreateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { assertCampus } from '../academic/campus-check.js';

const i = schema.admissionInquiries;

const columns = {
  id: i.id,
  campusId: i.campusId,
  parentName: i.parentName,
  phone: i.phone,
  email: i.email,
  studentName: i.studentName,
  classSought: i.classSought,
  message: i.message,
  source: i.source,
  status: i.status,
  createdAt: i.createdAt,
};

const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');
const decodeCursor = (cursor: string): string => {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  return id;
};

/**
 * Campus-scoped staff see inquiries for their campuses only. Inquiries that name no campus
 * are visible to school-wide staff.
 */
const scopeFilter = (access: TenantAccess, permission: string): SQL | undefined | false => {
  const scope = access.scopeOf(permission);
  if (scope === null) return undefined;
  if (scope.size === 0) return false;
  return inArray(i.campusId, [...scope]);
};

@Injectable()
export class InquiriesService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  list(
    access: TenantAccess,
    q: { limit: number; cursor?: string; status?: string; campusId?: string },
  ) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const scope = scopeFilter(access, 'admissions.view');
        if (scope === false) return { data: [], nextCursor: null };
        const filters: SQL[] = scope ? [scope] : [];
        if (q.status) filters.push(eq(i.status, q.status));
        if (q.campusId) filters.push(eq(i.campusId, q.campusId));
        if (q.cursor) filters.push(lt(i.id, decodeCursor(q.cursor)));
        const rows = await tx
          .select(columns)
          .from(i)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(desc(i.id))
          .limit(q.limit + 1);
        const page = rows.slice(0, q.limit);
        const last = page.at(-1);
        return {
          data: page,
          nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null,
        };
      },
      { readOnly: true },
    );
  }

  create(access: TenantAccess, input: InquiryCreateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (input.campusId) {
        await assertCampus(tx, access, input.campusId, 'admissions.manage');
      } else if (!access.hasTenantWide('admissions.manage')) {
        throw new AppError('VALIDATION_FAILED', 'Choose the campus for this inquiry', {
          fields: { campusId: 'Required' },
        });
      }
      const { consent: _consent, ...values } = input;
      const [row] = await tx
        .insert(i)
        .values({ tenantId: access.tenantId, ...values, consentAt: new Date() })
        .returning(columns);
      await this.audit.record(tx, access, {
        action: 'inquiry.created',
        entity: 'admission_inquiry',
        entityId: row!.id,
        campusId: row!.campusId,
        diff: { source: input.source, classSought: input.classSought },
      });
      return row!;
    });
  }

  setStatus(access: TenantAccess, id: string, status: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const scope = scopeFilter(access, 'admissions.manage');
      if (scope === false) throw notFound('Inquiry');
      const [row] = await tx
        .update(i)
        .set({ status, updatedAt: new Date() })
        .where(scope ? and(eq(i.id, id), scope) : eq(i.id, id))
        .returning(columns);
      if (!row) throw notFound('Inquiry');
      await this.audit.record(tx, access, {
        action: 'inquiry.status_changed',
        entity: 'admission_inquiry',
        entityId: id,
        campusId: row.campusId,
        diff: { status },
      });
      return row;
    });
  }
}
