# ADR-002: Drizzle ORM with committed SQL migrations

- Status: Accepted (2026-11-11)

## Context

We need typed queries, reviewable migrations, and first-class control over RLS, roles,
triggers and functions. Prisma and Drizzle were considered.

## Decision

Drizzle ORM (node-postgres driver) and drizzle-kit. Migrations are committed SQL files; RLS,
roles and functions are written as custom SQL migrations. Raw driver access is confined to
`packages/db` (lint rule).

## Consequences

- SQL-first, no engine binary, transactions and `set_config` are straightforward.
- Migrations are readable in code review.
  − Fewer batteries than Prisma (no generated admin UI); acceptable.
