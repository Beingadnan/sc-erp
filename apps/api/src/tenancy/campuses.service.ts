import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { CampusCreateInput, CampusUpdateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from './audit.service.js';

const c = schema.campuses;
const campusColumns = {
  id: c.id,
  code: c.code,
  name: c.name,
  board: c.board,
  udiseCode: c.udiseCode,
  address: c.address,
  phone: c.phone,
  email: c.email,
  timezone: c.timezone,
  status: c.status,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
};

@Injectable()
export class CampusesService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /** Campuses where the user holds any role (all campuses for tenant-wide roles). */
  list(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      (tx) => {
        const scope = access.campusScope;
        if (scope !== null && scope.size === 0) return Promise.resolve([]);
        return tx
          .select(campusColumns)
          .from(c)
          .where(scope === null ? undefined : inArray(c.id, [...scope]))
          .orderBy(asc(c.name));
      },
      { readOnly: true },
    );
  }

  async create(access: TenantAccess, input: CampusCreateInput) {
    if (!access.hasTenantWide('settings.manage')) {
      throw new AppError('FORBIDDEN', 'Only school-wide administrators can add campuses');
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      try {
        const [row] = await tx
          .insert(c)
          .values({ tenantId: access.tenantId, ...input })
          .returning(campusColumns);
        await this.audit.record(tx, access, {
          action: 'campus.created',
          entity: 'campus',
          entityId: row!.id,
          campusId: row!.id,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          campuses_tenant_code_uq: 'A campus with this code already exists',
        });
      }
    });
  }

  async update(access: TenantAccess, id: string, input: CampusUpdateInput) {
    if (!access.has('settings.manage', id)) throw notFound('Campus');
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [row] = await tx
        .update(c)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(c.id, id)))
        .returning(campusColumns);
      if (!row) throw notFound('Campus');
      await this.audit.record(tx, access, {
        action: 'campus.updated',
        entity: 'campus',
        entityId: id,
        campusId: id,
        diff: input,
      });
      return row;
    });
  }
}
