import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext, idColumn, timestamps } from './types.js';

/* ------------------------------------------------------------------------------------
 * GLOBAL tables (no tenant_id). Row-Level Security is enabled on all of them; the app
 * role reaches them only through narrow policies or SECURITY DEFINER functions
 * (migration 0002). Listed in src/global-tables.ts.
 * ---------------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    /** Staff sign in with email; parents may have only a mobile number. */
    email: citext('email').unique(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    /** Mobile number used to sign in (parents); unique across the platform. */
    loginPhone: text('login_phone').unique(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
    mfaRecoveryHashes: text('mfa_recovery_hashes').array(),
    status: text('status').notNull().default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('users_status_chk', sql`${t.status} in ('active', 'disabled')`),
    check('users_phone_chk', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'users_login_phone_chk',
      sql`${t.loginPhone} is null or ${t.loginPhone} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check('users_identity_chk', sql`${t.email} is not null or ${t.loginPhone} is not null`),
  ],
);

export const tenants = pgTable(
  'tenants',
  {
    id: idColumn(),
    slug: citext('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    plan: text('plan').notNull().default('trial'),
    defaultTimezone: text('default_timezone').notNull().default('Asia/Kolkata'),
    defaultCurrency: text('default_currency').notNull().default('INR'),
    ...timestamps,
  },
  (t) => [
    check('tenants_status_chk', sql`${t.status} in ('active', 'suspended', 'closed')`),
    check('tenants_slug_chk', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'`),
  ],
);

export const platformAdmins = pgTable(
  'platform_admins',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('platform_admins_role_chk', sql`${t.role} in ('super_admin', 'support', 'operations')`),
  ],
);

/** Permission catalogue — same for every tenant. */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Templates copied into each tenant's roles at provisioning time. */
export const systemRoleTemplates = pgTable('system_role_templates', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const systemRoleTemplatePermissions = pgTable(
  'system_role_template_permissions',
  {
    roleKey: text('role_key')
      .notNull()
      .references(() => systemRoleTemplates.key, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    csrfHash: bytea('csrf_hash').notNull(),
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    mfaPending: boolean('mfa_pending').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Invites only: the tenant whose membership the token activates. */
    tenantRef: uuid('tenant_ref').references(() => tenants.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'auth_tokens_purpose_chk',
      sql`${t.purpose} in ('verify_email', 'reset_password', 'invite')`,
    ),
    index('auth_tokens_user_idx').on(t.userId, t.purpose),
  ],
);

/** Maintained by trigger from tenant_memberships so a user's tenant list can be read without crossing RLS. */
export const userMembershipsIndex = pgTable(
  'user_memberships_index',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantRef: uuid('tenant_ref')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    status: text('status').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tenantRef] })],
);

/** Tenants with undispatched outbox events (maintained by trigger) so the relay need not scan every tenant. */
export const outboxPendingTenants = pgTable('outbox_pending_tenants', {
  tenantRef: uuid('tenant_ref')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  since: timestamp('since', { withTimezone: true }).notNull().defaultNow(),
  pendingCount: integer('pending_count').notNull().default(0),
});

/* ------------------------------------------------------------------------------------
 * TENANT tables (tenant_id + RLS + composite foreign keys).
 * ---------------------------------------------------------------------------------- */

export const campuses = pgTable(
  'campuses',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    board: text('board').notNull(),
    udiseCode: text('udise_code'),
    address: text('address'),
    phone: text('phone'),
    email: citext('email'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('campuses_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('campuses_tenant_code_uq').on(t.tenantId, t.code),
    check('campuses_status_chk', sql`${t.status} in ('active', 'archived')`),
    check(
      'campuses_board_chk',
      sql`${t.board} in ('CBSE', 'RBSE', 'CISCE', 'STATE_OTHER', 'IB', 'CAMBRIDGE', 'OTHER')`,
    ),
    check('campuses_udise_chk', sql`${t.udiseCode} is null or ${t.udiseCode} ~ '^[0-9]{11}$'`),
    check('campuses_code_chk', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'`),
  ],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    invitedBy: uuid('invited_by'),
    ...timestamps,
  },
  (t) => [
    unique('tenant_memberships_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('tenant_memberships_tenant_user_uq').on(t.tenantId, t.userId),
    check('tenant_memberships_status_chk', sql`${t.status} in ('invited', 'active', 'suspended')`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('roles_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('roles_tenant_key_uq').on(t.tenantId, t.key),
    check('roles_key_chk', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,49}$'`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.roleId, t.permissionKey] }),
    foreignKey({
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
  ],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
    /** Null = all campuses of the tenant. */
    campusId: uuid('campus_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('membership_roles_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('membership_roles_assignment_uq')
      .on(t.tenantId, t.membershipId, t.roleId, t.campusId)
      .nullsNotDistinct(),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    index('membership_roles_membership_idx').on(t.tenantId, t.membershipId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id'),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    campusId: uuid('campus_id'),
    diff: jsonb('diff'),
    requestId: text('request_id'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_logs_actor_type_chk', sql`${t.actorType} in ('user', 'system', 'platform')`),
    index('audit_logs_tenant_id_idx').on(t.tenantId, t.id.desc()),
    index('audit_logs_tenant_entity_idx').on(t.tenantId, t.entity, t.entityId),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    index('outbox_events_pending_idx')
      .on(t.tenantId, t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);
