import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { guardians } from './students.js';
import { tenants, users } from './platform.js';
import { bytea, idColumn } from './types.js';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/**
 * One-time links that give a guardian access to the parent portal (or reset its password).
 * Only the SHA-256 of the token is stored; accepting goes through app.portal_accept_invite.
 */
export const portalInvites = pgTable(
  'portal_invites',
  {
    id: idColumn(),
    tenantId: tenantId(),
    guardianId: uuid('guardian_id').notNull(),
    /** activate | reset */
    purpose: text('purpose').notNull().default('activate'),
    tokenHash: bytea('token_hash').notNull().unique(),
    /** The mobile number the account will sign in with (copied from the guardian). */
    phone: text('phone').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('portal_invites_tenant_id_id_uq').on(t.tenantId, t.id),
    index('portal_invites_guardian_idx').on(t.tenantId, t.guardianId),
    foreignKey({
      name: 'portal_invites_guardian_fk',
      columns: [t.tenantId, t.guardianId],
      foreignColumns: [guardians.tenantId, guardians.id],
    }).onDelete('cascade'),
    check('portal_invites_purpose_chk', sql`${t.purpose} in ('activate', 'reset')`),
    check('portal_invites_phone_chk', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);
