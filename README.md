# School ERP

Multi-tenant School ERP SaaS for Indian schools (CBSE and Rajasthan Board first).
Each school group is an isolated tenant; isolation is enforced by Postgres Row-Level Security.

**Status:** Phase 2 — SaaS platform foundation: school sign-up, sign-in with two-step
verification, password reset, staff invitations, campuses, roles and permissions (custom roles,
campus scope), audit log, outbox relay, platform administration, and the web app shell.
Next: Phase 3 (academic years, classes, sections, subjects, calendar, grading, CMS).

## Stack

Next.js 16 · NestJS 12 · TypeScript 6 · Drizzle ORM · Neon Postgres · BullMQ/Redis ·
pnpm + Turborepo · Vitest. See `docs/architecture/system-design.md`.

## Quick start

Requirements: Node 22.12+, pnpm 10. No Docker needed.

```bash
pnpm install
cp .env.example .env          # then follow docs/deployment/neon-setup.md
pnpm db:setup                 # build packages, migrate, enable erp_app, check RLS
pnpm dev                      # API on :4000 and web on :3000
```

The background worker (outbox relay, jobs) needs Redis and is optional during development:
`pnpm dev:worker` once `REDIS_URL` points at a Redis server (e.g. `brew install redis` or a free
Upstash database). Without it, events simply wait in the outbox.

Development emails are not sent: they are printed in the API terminal and appended to
`.dev-mail/outbox.log`.

- API: http://localhost:4000/api/v1/health · docs http://localhost:4000/api/docs
- Web: http://localhost:3000

## Running the tests

The test suite needs a Postgres that mirrors Neon's roles. Create a separate Neon branch (e.g.
`test`) and point the tests at it with `TEST_DATABASE_URL_OWNER` (direct) and
`TEST_DATABASE_URL_APP` (pooled, user `erp_app`). **Tests drop and create tables — never point
them at production.**

## Scripts

| Command                                      | What it does                                         |
| -------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                                   | api, worker and web in watch mode                    |
| `pnpm build` / `typecheck` / `lint` / `test` | across all packages (Turborepo)                      |
| `pnpm db:migrate`                            | apply SQL migrations (owner role, direct connection) |
| `pnpm db:setup-app-role`                     | enable login for `erp_app` with `ERP_APP_PASSWORD`   |
| `pnpm db:check-rls`                          | fail if any table could leak across tenants          |
| `pnpm db:generate`                           | generate a migration from Drizzle schema changes     |

## Ground rules

1. Tenant data is only reached through `withTenant()` from `@school-erp/db`.
2. Every tenant table: `tenant_id`, composite FKs, `select app.enable_tenant_rls('t')`.
3. Money uses `Money` (paise as bigint) and `numeric(14,2)` — never floats.
4. No personal data in logs.
5. A phase is complete only when lint, typecheck, build, all tests and the RLS check pass.

## Docs

`docs/PRD.md` · `docs/requirements.md` · `docs/architecture/` · `docs/database/` ·
`docs/security/` · `docs/api/conventions.md` · `docs/decisions/` · `docs/deployment/`

# sc-erp
