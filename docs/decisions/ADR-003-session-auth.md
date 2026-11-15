# ADR-003: First-party session authentication

- Status: Accepted (2026-11-11), implemented in Phase 2

## Context

Users belong to one or more tenants with campus-scoped roles; parents log in by mobile OTP.
Hosted identity providers charge per monthly active user, which is costly at school scale
(every parent is a user), and add another processor of children's data.

## Decision

Build authentication in the API: Argon2id passwords, opaque random session ids in HttpOnly
Secure SameSite cookies stored hashed in Postgres, TOTP MFA for privileged roles, OTP login
for guardians via SMS/WhatsApp, rate limiting and lockout.

## Consequences

- Full control of tenant membership, campus scope and session revocation.
- No per-user vendor cost; fewer data processors under DPDP.
  − We own the security of this code: requires focused tests and an external review (Phase 14).
