import type { ClientBase, Pool } from 'pg';
import { GLOBAL_TABLES, IGNORED_SCHEMAS } from './global-tables.js';
import type { GlobalTable } from './global-tables.js';

export type RlsViolationKind =
  | 'RLS_NOT_ENABLED'
  | 'RLS_NOT_FORCED'
  | 'MISSING_TENANT_POLICY'
  | 'UNCLASSIFIED_TABLE'
  | 'GLOBAL_TABLE_WITHOUT_RLS'
  | 'CATALOGUE_WRITABLE_BY_APP'
  | 'FK_WITHOUT_TENANT_ID'
  | 'APP_ROLE_CAN_BYPASS_RLS';

export interface RlsViolation {
  kind: RlsViolationKind;
  table: string;
  detail: string;
}

type Queryable = Pick<ClientBase | Pool, 'query'>;

/**
 * Inspects the live schema and reports every way tenant isolation could be broken.
 * Runs in CI after migrations (`pnpm db:check-rls`) and in the test suite.
 */
export const findRlsViolations = async (
  db: Queryable,
  options: { appRole?: string; globalTables?: Readonly<Record<string, GlobalTable>> } = {},
): Promise<RlsViolation[]> => {
  const globalTables = options.globalTables ?? GLOBAL_TABLES;
  const appRole = options.appRole ?? 'erp_app';
  const violations: RlsViolation[] = [];

  const { rows: tables } = await db.query<{
    schema: string;
    table: string;
    rls: boolean;
    forced: boolean;
    has_tenant_id: boolean;
    has_policy: boolean;
    app_can_write: boolean;
  }>(
    `select n.nspname as schema,
            c.relname as table,
            c.relrowsecurity as rls,
            c.relforcerowsecurity as forced,
            exists (select 1 from pg_attribute a
                     where a.attrelid = c.oid and a.attname = 'tenant_id'
                       and not a.attisdropped) as has_tenant_id,
            exists (select 1 from pg_policies p
                     where p.schemaname = n.nspname and p.tablename = c.relname
                       and p.qual like '%current_tenant_id()%'
                       and coalesce(p.with_check, p.qual) like '%current_tenant_id()%') as has_policy,
            exists (select 1 from pg_roles r where r.rolname = $2
                     and (has_table_privilege(r.oid, c.oid, 'INSERT')
                          or has_table_privilege(r.oid, c.oid, 'UPDATE')
                          or has_table_privilege(r.oid, c.oid, 'DELETE'))) as app_can_write
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname <> all($1::text[])
        and n.nspname not like 'pg_temp%'
      order by 1, 2`,
    [IGNORED_SCHEMAS, appRole],
  );

  for (const t of tables) {
    const name = t.schema === 'public' ? t.table : `${t.schema}.${t.table}`;
    if (!t.has_tenant_id) {
      const global = globalTables[name];
      if (!global) {
        violations.push({
          kind: 'UNCLASSIFIED_TABLE',
          table: name,
          detail: 'Table has no tenant_id and is not listed in GLOBAL_TABLES',
        });
      } else if (!global.catalogue && !t.rls) {
        violations.push({
          kind: 'GLOBAL_TABLE_WITHOUT_RLS',
          table: name,
          detail:
            'Global tables must have RLS enabled (declare catalogue: true for read-only data)',
        });
      } else if (global.catalogue && t.app_can_write) {
        violations.push({
          kind: 'CATALOGUE_WRITABLE_BY_APP',
          table: name,
          detail: `${appRole} must have SELECT only on catalogue tables`,
        });
      }
      continue;
    }
    if (!t.rls) {
      violations.push({
        kind: 'RLS_NOT_ENABLED',
        table: name,
        detail: 'ENABLE ROW LEVEL SECURITY missing',
      });
    }
    if (!t.forced) {
      violations.push({
        kind: 'RLS_NOT_FORCED',
        table: name,
        detail: 'FORCE ROW LEVEL SECURITY missing',
      });
    }
    if (!t.has_policy) {
      violations.push({
        kind: 'MISSING_TENANT_POLICY',
        table: name,
        detail: 'No policy filtering on app.current_tenant_id() for USING and WITH CHECK',
      });
    }
  }

  // Every FK between two tenant tables must include tenant_id, so a row can never
  // point at another tenant's row.
  const { rows: fks } = await db.query<{ constraint: string; table: string; ref_table: string }>(
    `select con.conname as constraint,
            con.conrelid::regclass::text as table,
            con.confrelid::regclass::text as ref_table
       from pg_constraint con
      where con.contype = 'f'
        and exists (select 1 from pg_attribute a where a.attrelid = con.conrelid
                      and a.attname = 'tenant_id' and not a.attisdropped)
        and exists (select 1 from pg_attribute a where a.attrelid = con.confrelid
                      and a.attname = 'tenant_id' and not a.attisdropped)
        and not exists (
          select 1 from unnest(con.conkey) k(attnum)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
           where a.attname = 'tenant_id')`,
  );
  for (const fk of fks) {
    violations.push({
      kind: 'FK_WITHOUT_TENANT_ID',
      table: fk.table,
      detail: `Foreign key ${fk.constraint} → ${fk.ref_table} must include tenant_id`,
    });
  }

  const { rows: roles } = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `select rolsuper, rolbypassrls from pg_roles where rolname = $1`,
    [appRole],
  );
  const role = roles[0];
  if (role && (role.rolsuper || role.rolbypassrls)) {
    violations.push({
      kind: 'APP_ROLE_CAN_BYPASS_RLS',
      table: '-',
      detail: `Role ${appRole} is SUPERUSER or BYPASSRLS`,
    });
  }

  return violations;
};
