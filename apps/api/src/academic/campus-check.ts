import { eq } from 'drizzle-orm';
import type { Transaction } from '@school-erp/db';
import { schema } from '@school-erp/db';
import { notFound } from '@school-erp/shared';
import type { TenantAccess } from '../auth/access.js';

/**
 * The campus must exist in the current school (RLS hides other schools' campuses) and the
 * caller must hold `permission` there. Otherwise: not found, so ids cannot be probed.
 */
export const assertCampus = async (
  tx: Transaction,
  access: TenantAccess,
  campusId: string,
  permission: string,
): Promise<void> => {
  if (!access.has(permission, campusId)) throw notFound('Campus');
  const [row] = await tx
    .select({ id: schema.campuses.id })
    .from(schema.campuses)
    .where(eq(schema.campuses.id, campusId));
  if (!row) throw notFound('Campus');
};
