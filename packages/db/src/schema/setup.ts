import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { academicYears } from './academic.js';
import { campuses, tenants, users } from './platform.js';
import { idColumn } from './types.js';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/**
 * One upload of the school setup workbook (classes, subjects, staff, who teaches what).
 * `plan` is what the preview checked; `created` lists every row the import added, so it can be
 * undone exactly.
 */
export const setupImports = pgTable(
  'setup_imports',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    /** setup (classes, subjects, staff) | opening (old fee balances) */
    kind: text('kind').notNull().default('setup'),
    /** previewed → applied → undone; or cancelled */
    status: text('status').notNull().default('previewed'),
    fileName: text('file_name').notNull(),
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    problems: jsonb('problems').$type<unknown[]>().notNull().default([]),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    created: jsonb('created').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (t) => [
    unique('setup_imports_tenant_id_id_uq').on(t.tenantId, t.id),
    index('setup_imports_tenant_created_idx').on(t.tenantId, t.createdAt),
    foreignKey({
      name: 'setup_imports_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    foreignKey({
      name: 'setup_imports_year_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.campusId, academicYears.id],
    }),
    check('setup_imports_kind_chk', sql`${t.kind} in ('setup', 'opening')`),
    check(
      'setup_imports_status_chk',
      sql`${t.status} in ('previewed', 'applied', 'undone', 'cancelled')`,
    ),
  ],
);
