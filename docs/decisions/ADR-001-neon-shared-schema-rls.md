# ADR-001: Neon Postgres, shared schema, Row-Level Security

- Status: Accepted (2026-11-11)

## Context

Hundreds of schools must share one deployment with strict isolation. The owner chose Neon for
the database. Options: database-per-tenant, schema-per-tenant, shared schema with `tenant_id`.

## Decision

Shared schema with `tenant_id` on every tenant table, enforced by Postgres RLS (ENABLE +
FORCE, default deny) and composite foreign keys, accessed through a non-bypass `erp_app` role
over Neon's pooled connection with transaction-local tenant context. Region AWS Singapore
(no India region); free plan in development.

## Consequences

- One migration path, cheap per-tenant cost, cross-tenant platform reporting possible.
- Isolation enforced by the database, not only by application code.
- Neon branches give each PR a disposable copy for tests.
  − Every query pays a small RLS predicate cost (mitigated by `tenant_id`-leading indexes).
  − Noisy-neighbour risk at scale; database-per-tenant path documented for enterprise customers.
  − Data residency: Singapore; revisit if a customer requires India.
