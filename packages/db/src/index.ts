export { createDatabase } from './client.js';
export type { Database, DatabaseHandle, Transaction, CreateDatabaseOptions } from './client.js';
export { withTenant, withContext, setContext, assertAppRoleIsSafe } from './tenant.js';
export type { WithTenantOptions, DbContext } from './tenant.js';
export { findRlsViolations } from './rls-check.js';
export type { RlsViolation, RlsViolationKind } from './rls-check.js';
export { GLOBAL_TABLES } from './global-tables.js';
export * as schema from './schema/index.js';
export { runMigrations, setupAppRole, MIGRATIONS_FOLDER } from './admin.js';
