/**
 * Tables that intentionally have NO tenant_id column. Each entry needs a reason.
 * The RLS checker fails CI for any table that has no tenant_id and is not listed here,
 * and for any listed table that is not a read-only catalogue but has RLS disabled.
 */
export interface GlobalTable {
  reason: string;
  /** Read-only reference data (no RLS needed; erp_app has SELECT only). */
  catalogue?: true;
}

export const GLOBAL_TABLES: Readonly<Record<string, GlobalTable>> = {
  users: {
    reason:
      'A person can belong to several tenants; visibility via RLS policies (self, same tenant).',
  },
  tenants: { reason: 'Tenant registry; erp_app sees only the current tenant.' },
  sessions: {
    reason: 'Sessions belong to users, not tenants; erp_app sees only its own user’s sessions.',
  },
  auth_tokens: { reason: 'Email verification / reset / invite tokens; definer functions only.' },
  platform_admins: { reason: 'Platform staff; definer functions only.' },
  user_memberships_index: {
    reason: 'Trigger-maintained index of a user’s tenants; definer functions only.',
  },
  outbox_pending_tenants: {
    reason: 'Trigger-maintained counters for the outbox relay; definer functions only.',
  },
  permissions: { reason: 'Permission catalogue.', catalogue: true },
  system_role_templates: { reason: 'System role catalogue.', catalogue: true },
  system_role_template_permissions: { reason: 'System role catalogue.', catalogue: true },
};

/** Schemas the checker ignores (system and migration bookkeeping). */
export const IGNORED_SCHEMAS = ['pg_catalog', 'information_schema', 'drizzle', 'pg_toast'];
