/**
 * Drizzle table definitions, one file per domain.
 *
 * Rules for every tenant-owned table (enforced by `pnpm db:check-rls` in CI):
 *  1. `tenant_id uuid not null` column.
 *  2. `unique (tenant_id, id)` so children can reference (tenant_id, id).
 *  3. Foreign keys to other tenant tables include tenant_id: (tenant_id, parent_id).
 *  4. In a migration: `select app.enable_tenant_rls('<table>');`
 *  5. Indexes lead with tenant_id.
 *
 * Tables WITHOUT tenant_id must be listed in src/global-tables.ts with a reason, and must
 * have RLS enabled unless declared a read-only catalogue.
 */
export * from './platform.js';
export * from './academic.js';
export * from './cms.js';
export * from './students.js';
export * from './admissions.js';
export * from './records.js';
export * from './attendance.js';
export * from './fees.js';
export * from './portal.js';
export * from './staff.js';
export * from './setup.js';
export * from './classroom.js';
export * from './exams.js';
