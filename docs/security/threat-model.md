# Threat Model and Security Checklist

Status: Phase 1 · Method: STRIDE over the main data flows · Review every phase.

## Assets

1. Children's personal data (names, DOB, photos, addresses, guardians' phones, PEN/APAAR).
2. Financial records (fee ledgers, receipts, refunds, payment references).
3. Academic records (marks, report cards, attendance).
4. Staff data (salary, bank details, documents).
5. Credentials and sessions; platform admin access.

## Trust boundaries

Browser ↔ API · API ↔ Neon · API/worker ↔ Redis · API/worker ↔ object storage ·
payment/SMS/WhatsApp providers ↔ webhooks · platform staff ↔ tenant data.

## Threats and mitigations

| #   | Threat (STRIDE)                                     | Mitigation                                                                                                                                                                                                                | Status                                                                           |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| T1  | School A reads/changes School B data via IDs (I, T) | RLS default-deny + FORCE, composite FKs, 404 on foreign ids, isolation suite                                                                                                                                              | Done (P1), per-table in each phase                                               |
| T2  | Tenant context leaks across pooled connections (I)  | Transaction-local `set_config`; leak tests incl. failed transactions                                                                                                                                                      | Done (P1)                                                                        |
| T3  | App connects with a role that bypasses RLS (E)      | `erp_app` NOBYPASSRLS; startup refusal; env refuses `neondb_owner`; CI check                                                                                                                                              | Done (P1)                                                                        |
| T4  | New table shipped without RLS (I)                   | `pnpm db:check-rls` in CI; unclassified tables fail                                                                                                                                                                       | Done (P1)                                                                        |
| T5  | Client-supplied tenant id trusted (S, E)            | Tenant comes only from the server-side session's active tenant, re-verified against an active membership on every request; switching requires membership                                                                  | Done (P2)                                                                        |
| T6  | Credential stuffing / brute force (S)               | Argon2id (19 MiB, t=2); per-IP and per-email limits; lockout after 5 failures for 15 min; identical errors for unknown email / wrong password / locked; dummy hash for timing; TOTP MFA                                   | Done (P2) — limiter is per-process: move to Redis before running >1 API instance |
| T7  | Session theft (S)                                   | 256-bit opaque tokens, only SHA-256 stored; HttpOnly + SameSite=Lax (+ Secure and `__Host-` prefix in production); new session after login and after MFA; 8 h idle / 7 d absolute; revocation; password reset revokes all | Done (P2)                                                                        |
| T8  | CSRF (T)                                            | SameSite=Lax + per-session CSRF token checked against a stored hash + Origin allow-list on every unsafe request                                                                                                           | Done (P2)                                                                        |
| T9  | XSS via CMS or names (T, I)                         | React escaping; sanitised CMS HTML (allowlist); nonce-based CSP                                                                                                                                                           | Phase 2–3                                                                        |
| T10 | Parent sees another family's child (I)              | Guardian–student link checked server-side on every portal call                                                                                                                                                            | Phase 10                                                                         |
| T11 | Teacher sees unassigned classes (I)                 | Scope from teacher assignments in the permission layer                                                                                                                                                                    | Phase 4–8                                                                        |
| T12 | File URL guessing / sharing (I)                     | Tenant-prefixed private bucket; signed URLs ≤ 5 min after permission check; no public ACLs                                                                                                                                | Phase 4                                                                          |
| T13 | Malicious upload (T)                                | Type/size allowlist, magic-byte check, re-encode images, AV scan job                                                                                                                                                      | Phase 4                                                                          |
| T14 | Fake or replayed payment webhook (S, T)             | HMAC signature verification, unique provider event id, idempotency keys, reconciliation                                                                                                                                   | Phase 6                                                                          |
| T15 | Receipt or ledger tampering (T, R)                  | Append-only ledger, reversal-only corrections, audit log, gap-free sequences under lock                                                                                                                                   | Phase 6                                                                          |
| T16 | Insider/platform support abuse (E, R)               | No default memberships; platform role granted only by an owner-role script; status changes audited in the school's own log                                                                                                | Partly done (P2) — time-boxed "view as" in P14                                   |
| T17 | PII in logs/errors (I)                              | Error filter hides internals; log ids only; redaction in audit diffs                                                                                                                                                      | Done (P1 filter), ongoing                                                        |
| T18 | Job processes wrong tenant (I, T)                   | Tenant envelope, re-validation, handler inside `withTenant`                                                                                                                                                               | Done (P1)                                                                        |
| T19 | Cache key collision (I)                             | `tenantCacheKey()` only                                                                                                                                                                                                   | Done (P1 helper)                                                                 |
| T20 | Secrets leak (I)                                    | `.env` git-ignored; secrets in CI/host secret stores; scripts never print credentials                                                                                                                                     | Done (P1)                                                                        |
| T21 | Vulnerable dependency (T)                           | `pnpm audit` in CI; pinned versions; Dependabot                                                                                                                                                                           | Audit in CI; enable Dependabot once on GitHub                                    |
| T22 | Data loss (D)                                       | Neon PITR; nightly logical dump to separate storage; tested restores                                                                                                                                                      | Phase 14                                                                         |
| T23 | DoS on login/attendance bursts (D)                  | Rate limiting, pooled connections, autoscaling, queue back-pressure                                                                                                                                                       | Phase 2 + 14                                                                     |
| T25 | Privilege escalation through roles (E)              | Users can only create or assign roles whose every permission they hold at the needed scope; built-in roles are immutable; the last owner cannot be removed                                                                | Done (P2), mutation-tested                                                       |
| T26 | Account enumeration (I)                             | Forgot-password always answers 202; login errors are identical; sign-up reveals a taken email (accepted trade-off, rate-limited)                                                                                          | Done (P2)                                                                        |
| T27 | Email links leaked or replayed (S)                  | Random tokens stored hashed, single-use, short-lived (reset 1 h, verify 3 d, invite 7 d)                                                                                                                                  | Done (P2)                                                                        |
| T24 | Non-compliant handling of children's data (legal)   | Processor DPA, no ads/profiling, consent records, retention + deletion jobs                                                                                                                                               | Phase 2–4, legal review                                                          |

## Phase gate checklist

- [ ] Isolation suite extended to every new tenant table and endpoint
- [ ] `pnpm db:check-rls` passes
- [ ] New endpoints have permission + scope checks and a negative test
- [ ] No PII in logs (grep test fixtures' names in log output)
- [ ] Inputs validated with Zod; outputs mapped through DTOs
- [ ] Money paths use `Money`; no `parseFloat`/`Number()` on amounts
- [ ] `pnpm audit` clean at high severity
- [ ] Threat table updated
