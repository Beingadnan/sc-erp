import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { RoleCreateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from './audit.service.js';

const r = schema.roles;
const rp = schema.rolePermissions;

@Injectable()
export class RolesService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  catalogue(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      (tx) =>
        tx
          .select({
            key: schema.permissions.key,
            module: schema.permissions.module,
            description: schema.permissions.description,
          })
          .from(schema.permissions)
          .orderBy(asc(schema.permissions.sortOrder)),
      { readOnly: true },
    );
  }

  list(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const roles = await tx
          .select({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
            isSystem: r.isSystem,
          })
          .from(r)
          .orderBy(asc(r.isSystem), asc(r.name));
        const perms = await tx.select({ roleId: rp.roleId, key: rp.permissionKey }).from(rp);
        const members = await tx
          .select({ roleId: schema.membershipRoles.roleId, n: count() })
          .from(schema.membershipRoles)
          .groupBy(schema.membershipRoles.roleId);
        return roles.map((role) => ({
          ...role,
          permissions: perms
            .filter((p) => p.roleId === role.id)
            .map((p) => p.key)
            .sort(),
          assignmentCount: Number(members.find((m) => m.roleId === role.id)?.n ?? 0),
        }));
      },
      { readOnly: true },
    );
  }

  async create(access: TenantAccess, input: RoleCreateInput) {
    this.assertTenantWideManager(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await this.assertGrantable(tx, access, input.permissions);
      try {
        const [role] = await tx
          .insert(r)
          .values({
            tenantId: access.tenantId,
            key: input.key,
            name: input.name,
            description: input.description,
            isSystem: false,
          })
          .returning({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
            isSystem: r.isSystem,
          });
        await this.replacePermissions(tx, access, role!.id, input.permissions);
        await this.audit.record(tx, access, {
          action: 'role.created',
          entity: 'role',
          entityId: role!.id,
          diff: { key: input.key, name: input.name, permissions: input.permissions },
        });
        return { ...role!, permissions: [...input.permissions].sort(), assignmentCount: 0 };
      } catch (err) {
        return rethrowConflicts(err, {
          roles_tenant_key_uq: 'A role with this key already exists',
        });
      }
    });
  }

  async update(access: TenantAccess, id: string, input: { name?: string; description?: string }) {
    this.assertTenantWideManager(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const role = await this.customRole(tx, id);
      await tx.update(r).set(input).where(eq(r.id, role.id));
      await this.audit.record(tx, access, {
        action: 'role.updated',
        entity: 'role',
        entityId: id,
        diff: input,
      });
    });
  }

  async setPermissions(access: TenantAccess, id: string, permissions: string[]) {
    this.assertTenantWideManager(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const role = await this.customRole(tx, id);
      await this.assertGrantable(tx, access, permissions);
      await this.replacePermissions(tx, access, role.id, permissions);
      await this.audit.record(tx, access, {
        action: 'role.permissions_changed',
        entity: 'role',
        entityId: id,
        diff: { permissions },
      });
    });
  }

  async remove(access: TenantAccess, id: string) {
    this.assertTenantWideManager(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const role = await this.customRole(tx, id);
      const [used] = await tx
        .select({ n: count() })
        .from(schema.membershipRoles)
        .where(eq(schema.membershipRoles.roleId, role.id));
      if (Number(used?.n ?? 0) > 0) {
        throw new AppError('CONFLICT', 'Remove this role from all members before deleting it');
      }
      await tx.delete(r).where(eq(r.id, role.id));
      await this.audit.record(tx, access, {
        action: 'role.deleted',
        entity: 'role',
        entityId: id,
        diff: { key: role.key },
      });
    });
  }

  // -----------------------------------------------------------------------------

  private assertTenantWideManager(access: TenantAccess): void {
    if (!access.hasTenantWide('roles.manage')) {
      throw new AppError('FORBIDDEN', 'Only school-wide administrators can manage roles');
    }
  }

  /** System roles follow their templates and cannot be edited; clone them instead. */
  private async customRole(tx: Transaction, id: string) {
    const [role] = await tx
      .select({ id: r.id, key: r.key, isSystem: r.isSystem })
      .from(r)
      .where(eq(r.id, id));
    if (!role) throw notFound('Role');
    if (role.isSystem) {
      throw new AppError(
        'CONFLICT',
        'Built-in roles cannot be changed. Create a custom role instead.',
      );
    }
    return role;
  }

  /** Users can only hand out permissions they hold school-wide (no privilege escalation). */
  private async assertGrantable(tx: Transaction, access: TenantAccess, permissions: string[]) {
    const unique = [...new Set(permissions)];
    if (unique.length === 0) return;
    const known = await tx
      .select({ key: schema.permissions.key })
      .from(schema.permissions)
      .where(inArray(schema.permissions.key, unique));
    const unknown = unique.filter((p) => !known.some((k) => k.key === p));
    if (unknown.length) {
      throw new AppError('VALIDATION_FAILED', 'Unknown permissions', {
        fields: { permissions: unknown.join(', ') },
      });
    }
    const notHeld = unique.filter((p) => !access.canGrant(p, null));
    if (notHeld.length) {
      throw new AppError('FORBIDDEN', 'You can only grant permissions you hold yourself', {
        permissions: notHeld,
      });
    }
  }

  private async replacePermissions(
    tx: Transaction,
    access: TenantAccess,
    roleId: string,
    permissions: string[],
  ) {
    await tx.delete(rp).where(and(eq(rp.roleId, roleId)));
    const unique = [...new Set(permissions)];
    if (unique.length) {
      await tx
        .insert(rp)
        .values(unique.map((key) => ({ tenantId: access.tenantId, roleId, permissionKey: key })));
    }
  }
}
