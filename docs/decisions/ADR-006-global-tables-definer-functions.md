# ADR-006: Global tables behind RLS, cross-tenant work through SECURITY DEFINER functions

- Status: Accepted (2026-11-11) — supersedes the `erp_platform` role sketched in Phase 1

## Context

Some work cannot run inside a single tenant: looking up a user by email at login, resolving a
session cookie, creating a school, listing a user's schools, relaying the outbox, and platform
administration. Phase 1 proposed a separate `erp_platform` database role for this. On Neon the
owner role cannot create roles with `BYPASSRLS`, and a broad second role would be one more
credential that can see every school.

## Decision

- Tables without `tenant_id` (users, tenants, sessions, auth_tokens, platform_admins, two
  trigger-maintained index tables) have RLS **enabled**. `erp_app` reaches them only through
  narrow policies (own user row, same-school users, current tenant, own sessions) and
  column-level grants (password hashes and MFA secrets are not selectable).
- Cross-tenant operations are ~20 `SECURITY DEFINER` functions in schema `app`, each doing one
  job, re-checking the caller (`app.current_user_id()`), validating arguments, with a fixed
  `search_path`. They are granted to `erp_app` explicitly; maintenance functions are not.
- Definer functions run as the owner, which bypasses RLS on global tables (not forced) but is
  still bound by `FORCE` RLS on tenant tables — so functions that write tenant rows set the
  tenant context themselves and restore it afterwards.
- A user's list of schools and the outbox relay's work list come from trigger-maintained
  global index tables, so no function needs to read across tenants.

## Consequences

- No credential exists that can read every school's data through normal queries.
- Each cross-tenant path is small, reviewable SQL with its own tests (`platform-policies.test.ts`).
  − Business logic in SQL functions must be kept minimal and versioned through migrations.
  − Definer functions trust their (application) caller for arguments like the user id at
  sign-up; the application paths are covered by end-to-end tests.
