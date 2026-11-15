# ADR-004: Modular monolith

- Status: Accepted (2026-11-11)

## Decision

One NestJS API and one worker process with domain modules and strict internal boundaries
(controller → service → domain → repository). No microservices until a measured scaling or
team-ownership need appears.

## Consequences

- Simple deploys, transactions across modules, fast development.
  − Module boundaries must be policed in code review; circular imports blocked by lint later.
