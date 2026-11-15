import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { validateCustomValues } from '@school-erp/validation';
import type {
  CustomFieldCreateInput,
  CustomFieldDef,
  CustomFieldUpdateInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';

const cf = schema.customFieldDefinitions;
const columns = {
  id: cf.id,
  entity: cf.entity,
  key: cf.key,
  label: cf.label,
  fieldType: cf.fieldType,
  options: cf.options,
  required: cf.required,
  sortOrder: cf.sortOrder,
  archived: cf.archived,
};

@Injectable()
export class CustomFieldsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  definitions(tx: Transaction, entity: 'student' | 'guardian') {
    return tx
      .select(columns)
      .from(cf)
      .where(eq(cf.entity, entity))
      .orderBy(asc(cf.sortOrder), asc(cf.label)) as Promise<
      Array<CustomFieldDef & { id: string; entity: string; sortOrder: number }>
    >;
  }

  /**
   * Validates incoming values and merges them into `current` (empty value = remove).
   * Throws VALIDATION_FAILED with `customFields.<key>` field errors.
   */
  async check(
    tx: Transaction,
    entity: 'student' | 'guardian',
    input: Record<string, unknown>,
    current: Record<string, unknown> = {},
    { partial = false }: { partial?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions(tx, entity);
    const { values, errors } = validateCustomValues(defs, input, { partial });
    if (Object.keys(errors).length) {
      throw new AppError('VALIDATION_FAILED', 'Some fields need attention', {
        fields: Object.fromEntries(
          Object.entries(errors).map(([k, v]) => [`customFields.${k}`, v]),
        ),
      });
    }
    const merged: Record<string, unknown> = { ...current, ...values };
    for (const [k, v] of Object.entries(input)) {
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))
        delete merged[k];
    }
    return merged;
  }

  list(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => ({
        student: await this.definitions(tx, 'student'),
        guardian: await this.definitions(tx, 'guardian'),
      }),
      { readOnly: true },
    );
  }

  private assertCanManage(access: TenantAccess) {
    if (!access.hasTenantWide('settings.manage')) {
      throw new AppError('FORBIDDEN', 'Only school-wide administrators can change custom fields');
    }
  }

  create(access: TenantAccess, input: CustomFieldCreateInput) {
    this.assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      try {
        const [row] = await tx
          .insert(cf)
          .values({ tenantId: access.tenantId, ...input })
          .returning(columns);
        await this.audit.record(tx, access, {
          action: 'custom_field.created',
          entity: 'custom_field',
          entityId: row!.id,
          diff: input,
        });
        return row!;
      } catch (err) {
        return rethrowConflicts(err, {
          custom_field_definitions_key_uq: 'A field with this key already exists',
        });
      }
    });
  }

  update(access: TenantAccess, id: string, input: CustomFieldUpdateInput) {
    this.assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [current] = await tx.select(columns).from(cf).where(eq(cf.id, id));
      if (!current) throw notFound('Custom field');
      if (input.options && current.fieldType !== 'select') {
        throw new AppError('VALIDATION_FAILED', 'Only list fields have options');
      }
      const [row] = await tx.update(cf).set(input).where(eq(cf.id, id)).returning(columns);
      await this.audit.record(tx, access, {
        action: 'custom_field.updated',
        entity: 'custom_field',
        entityId: id,
        diff: input,
      });
      return row!;
    });
  }
}
