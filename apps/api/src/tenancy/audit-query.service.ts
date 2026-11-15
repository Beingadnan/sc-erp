import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError } from '@school-erp/shared';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';

const a = schema.auditLogs;

// Ids are UUIDv7 (time-ordered), so the id alone is a stable keyset cursor.
const encodeCursor = (id: string) => Buffer.from(id).toString('base64url');

const decodeCursor = (cursor: string): string => {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  return id;
};

@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}

  list(
    access: TenantAccess,
    q: { limit: number; cursor?: string; entity?: string; actorUserId?: string },
  ) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const filters: SQL[] = [];
        if (q.entity) filters.push(eq(a.entity, q.entity));
        if (q.actorUserId) filters.push(eq(a.actorUserId, q.actorUserId));
        // Campus-scoped viewers see entries for their campuses only.
        const scope = access.scopeOf('audit.view');
        if (scope !== null) {
          if (scope.size === 0) return { data: [], nextCursor: null };
          filters.push(inArray(a.campusId, [...scope]));
        }
        if (q.cursor) filters.push(lt(a.id, decodeCursor(q.cursor)));
        const rows = await tx
          .select({
            id: a.id,
            action: a.action,
            entity: a.entity,
            entityId: a.entityId,
            campusId: a.campusId,
            actorUserId: a.actorUserId,
            actorType: a.actorType,
            actorName: schema.users.fullName,
            diff: a.diff,
            requestId: a.requestId,
            createdAt: a.createdAt,
          })
          .from(a)
          .leftJoin(schema.users, eq(schema.users.id, a.actorUserId))
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(desc(a.id))
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
}
