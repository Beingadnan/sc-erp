import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from './audit.service.js';

const t = schema.tenants;
const tenantColumns = {
  id: t.id,
  slug: t.slug,
  name: t.name,
  status: t.status,
  plan: t.plan,
  defaultTimezone: t.defaultTimezone,
  defaultCurrency: t.defaultCurrency,
  createdAt: t.createdAt,
};

@Injectable()
export class TenantService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  get(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const [row] = await tx.select(tenantColumns).from(t).where(eq(t.id, access.tenantId));
        if (!row) throw notFound('School');
        return { ...row, permissions: access.permissions(), permissionScopes: access.scopes() };
      },
      { readOnly: true },
    );
  }

  async update(access: TenantAccess, input: { name?: string; defaultTimezone?: string }) {
    if (!access.hasTenantWide('settings.manage')) {
      throw new AppError(
        'FORBIDDEN',
        'Only school-wide administrators can edit the school profile',
      );
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [row] = await tx
        .update(t)
        .set(input)
        .where(eq(t.id, access.tenantId))
        .returning(tenantColumns);
      if (!row) throw notFound('School');
      await this.audit.record(tx, access, {
        action: 'tenant.updated',
        entity: 'tenant',
        entityId: access.tenantId,
        diff: input,
      });
      return row;
    });
  }
}
