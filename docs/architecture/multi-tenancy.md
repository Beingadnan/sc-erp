# Multi-tenancy and Isolation

Status: Phase 1 · Implemented in `packages/db` · Verified by `packages/db/test/*`

## 1. Model

```
Platform
└── Tenant (customer account / school group)   ← isolation boundary
    ├── Campus 1
    ├── Campus 2
    └── Campus N
```

- **Tenant** is the security boundary. A single school is a tenant with one campus.
- **Campus** scoping is an authorization rule inside a tenant (staff assigned to campuses).
- Shared database, shared schema; every tenant-owned row has `tenant_id` (ADR-001).

## 2. Defence in depth

| Layer           | Mechanism                                                                                             | Where                                            |
| --------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1. Identity     | Tenant resolved from verified session + membership; client-supplied tenant ids ignored                | API guards (Phase 2)                             |
| 2. Code         | Only `withTenant()` can reach tenant data; lint blocks raw `pg`/Drizzle imports outside `packages/db` | `packages/db/src/tenant.ts`, `eslint.config.mjs` |
| 3. Database     | RLS `ENABLE` + `FORCE`, policy `tenant_id = app.current_tenant_id()` for USING and WITH CHECK         | migration helper `app.enable_tenant_rls()`       |
| 4. Schema       | Composite FKs `(tenant_id, parent_id)` make cross-tenant links impossible                             | every migration; enforced by checker             |
| 5. Role         | App connects as `erp_app`: NOBYPASSRLS, no DDL, owns nothing. Process refuses to start otherwise      | `assertAppRoleIsSafe()`                          |
| 6. Verification | CI fails if any table lacks RLS/FORCE/policy, has unclassified globals, or FK skips tenant_id         | `pnpm db:check-rls`                              |

Any single layer failing must not leak data.

## 3. Tenant context and Neon's pooler

Neon's pooler is PgBouncer in **transaction mode**: consecutive transactions from one client
can run on different server connections, and one server connection serves many clients.
Session state (`SET app.tenant_id = …`) would leak to the next client.

So the tenant is set **per transaction**:

```ts
await withTenant(db, ctx, async (tx) => {
  // inside: select set_config('app.tenant_id', $1, true)  ← true = transaction-local
  return studentsRepo.list(tx, filters);
});
```

At COMMIT or ROLLBACK the setting disappears. With no setting, `app.current_tenant_id()`
returns NULL and every policy matches nothing — **default deny**.

The test suite proves: default deny, A-only visibility, IDOR reads/updates/deletes return
nothing, WITH CHECK blocks inserts/moves into B, composite FKs block cross links, no leakage on
a reused connection (including after a failed transaction), 24 interleaved A/B requests on a
shared pool, and that `erp_app` cannot disable RLS, drop policies, `SET ROLE` or run DDL.
A mutation test (switching to session-level `set_config`) makes the suite fail as expected.

## 4. Roles

| Role                   | Created by                                                        | Used for                                                                                                                        | Can bypass RLS?                                |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `neondb_owner` (owner) | Neon                                                              | Migrations and setup scripts only (direct connection)                                                                           | Owns tables, but `FORCE` RLS applies to it too |
| `erp_app`              | Migration 0000 (`NOLOGIN`), password via `pnpm db:setup-app-role` | API and worker (pooled connection)                                                                                              | **No** (checked at startup and in CI)          |
| _(no third role)_      | —                                                                 | Cross-tenant work (login, sign-up, provisioning, outbox relay, platform admin) uses narrow SECURITY DEFINER functions — ADR-006 | —                                              |

Do **not** create `erp_app` in the Neon console: console roles join `neon_superuser`, which
can bypass RLS. Roles created by SQL do not.

## 5. Writing a tenant table (checklist)

```sql
create table students (
  id uuid primary key default app.uuid_v7(),
  tenant_id uuid not null references tenants(id),
  campus_id uuid not null,
  admission_number text not null,
  …,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, admission_number),
  foreign key (tenant_id, campus_id) references campuses (tenant_id, id)
);
create index students_tenant_campus_idx on students (tenant_id, campus_id);
create trigger students_updated_at before update on students
  for each row execute function app.set_updated_at();
select app.enable_tenant_rls('students');
```

Global tables (no `tenant_id`) must be listed in `packages/db/src/global-tables.ts` with a
reason, or CI fails.

## 6. Outside the database

| Surface                    | Rule                                                                                                    | Helper                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Cache                      | Keys `t:{tenantId}:…`                                                                                   | `tenantCacheKey()`                       |
| Files                      | Keys `tenants/{tenantId}/…`; downloads only via short-lived signed URLs issued after a permission check | `tenantStorageKey()`                     |
| Jobs                       | Envelope `{tenantId,userId,requestId,payload}`; worker re-validates; handler runs in `withTenant`       | `buildTenantJobData()`, `runTenantJob()` |
| Search / exports / reports | Same `withTenant` path; exports are jobs                                                                | —                                        |
| Logs                       | Ids only; no names, phone numbers, payloads                                                             | filter + logger conventions              |

## 7. Global tables and platform staff (Phase 2)

Tables without `tenant_id` still have RLS enabled (ADR-006):

| Table                                                                        | What `erp_app` can see / do                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| users                                                                        | Own row, plus users who are members of the current school. Password hash and MFA secret columns are not selectable. Only own row updatable. |
| tenants                                                                      | Current school only; name and time zone editable.                                                                                           |
| sessions                                                                     | Own sessions only; can revoke them. Created and resolved by definer functions.                                                              |
| auth_tokens, platform_admins, user_memberships_index, outbox_pending_tenants | Nothing — definer functions only.                                                                                                           |
| permissions, system_role_templates(+_permissions)                            | Read-only catalogues.                                                                                                                       |

Platform staff are listed in `platform_admins` (granted only with the owner-role script
`pnpm --filter @school-erp/db grant-platform-admin <email> <role>`). They can list schools and
suspend/restore them; every status change is written to that school's own audit log with
actor type `platform`. Support staff never get a school membership by default.
**Not built yet:** time-boxed "view as school" for support (planned for Phase 14 hardening).

## 8. Future: database-per-tenant for enterprise

Every row already carries `tenant_id`, so one tenant can move to its own Neon project:

1. Create the project and run the same migrations.
2. Copy that tenant's rows (logical export filtered by `tenant_id`).
3. Add a `tenant_routing` entry pointing the tenant to the new connection string.
4. Run in read-compare mode, then cut over writes; delete source rows after a retention window.

Only the connection resolver changes; application code and RLS stay the same. Not built until
a customer needs it.
