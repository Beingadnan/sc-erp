# Phase 2 Report — SaaS Platform Foundation

Date: 2026-11-11 · Status: complete, awaiting approval

## What was implemented

- **School sign-up**: one step creates the owner account, the school (tenant), its first
  campus, all 15 built-in roles and the owner membership — in one transaction.
- **Authentication**: Argon2id passwords; opaque server-side sessions in HttpOnly cookies;
  CSRF tokens; Origin allow-list; lockout after 5 failures; per-IP/per-email rate limits; email
  verification; password reset; password change; session list and revoke.
- **Two-step verification (TOTP)**: QR enrolment, 10 single-use recovery codes, replay
  protection, encrypted secrets (AES-256-GCM); required for settings/roles/staff changes when
  enforcement is on (default on in production).
- **Tenancy**: active school held in the server-side session and re-verified against an
  active membership on every request; school switcher for people in several schools;
  suspended schools are blocked.
- **Roles and permissions**: permission catalogue, 15 built-in roles (immutable), custom roles,
  role assignments per campus or for all campuses, no privilege escalation, last owner protected.
- **Staff**: invite (new people get a set-password link; existing accounts are added directly),
  change roles, suspend/restore.
- **Campuses**: list (scoped), add, edit, archive; UDISE code, board (CBSE/RBSE/…).
- **Audit log**: written in the same transaction as each change; secrets removed and contact
  details masked; append-only for the app; paginated API and screen.
- **Outbox**: events stored with the change; worker relay publishes them to a queue per school,
  safely under concurrency.
- **Platform administration**: list schools, suspend/restore with a reason (audited in the
  school's own log).
- **Web app**: sign-in (with MFA step), sign-up, forgot/reset password, verify email, accept
  invitation, app shell with permission-based navigation and mobile menu, dashboard checklist,
  school profile, campuses, staff & access, roles, audit log, security (MFA, password, sessions).

## Database changes

- `0001_platform_tables` (generated from the Drizzle schema): 17 tables.
- `0002_platform_security`: RLS on all 7 school tables (ENABLE + FORCE + tenant policy) and on
  7 non-school tables; column-level grants; 24 SECURITY DEFINER functions (incl. 2 triggers and 1 internal helper); triggers; seed data
  (5 permissions, 15 role templates). Design: ADR-006.

## APIs added

35 endpoints plus 2 health checks — see `docs/api/endpoints.md`.

## Security checks

All of the following are covered by automated tests with two independent schools: default deny;
school A cannot read, change or link to school B data by id (404); cannot switch into a school
without membership; a person in two schools sees only the active one; teachers cannot manage
people/settings; custom-role managers cannot escalate; built-in roles immutable; last owner
protected; suspension takes effect on the next request; campus-scoped admins stay in their
campus; CSRF and cross-origin requests blocked; cookie flags; session revoke, logout, reset
revokes sessions; identical login errors; lockout; MFA challenge, replay and recovery codes;
MFA enforcement; audit log immutable and redacted; platform routes hidden; support role
cannot suspend; background jobs and the outbox relay stay within one school; secrets columns
unreadable; definer functions refuse other users.

Mutation checks: disabling the CSRF check, the escalation check, or transaction-local tenant
context each makes the suite fail.

## Tests executed

| Package                                                        | Tests   | Result                                        |
| -------------------------------------------------------------- | ------- | --------------------------------------------- |
| shared                                                         | 11      | pass                                          |
| validation                                                     | 10      | pass                                          |
| db (isolation, RLS checker, platform policies)                 | 36      | pass                                          |
| api (e2e security suite, health, units incl. RFC 6238 vectors) | 51      | pass                                          |
| worker (tenant jobs, outbox relay)                             | 8       | pass                                          |
| **Total**                                                      | **116** | **pass** — on a fresh database and on re-runs |

Also: lint, typecheck, production build (API, worker, web), RLS coverage check, `pnpm audit`
(no known vulnerabilities), and a scripted browser walkthrough of the main screens on desktop
and mobile.

## Known limitations

- **Email is not delivered.** In development, emails (verification, reset, invite) are printed
  in the API console. Production refuses to send until the communication module (Phase 11) adds
  a real provider. Registration in production would therefore fail at the email step.
- Rate limits are per API process; move them to Redis before running more than one instance.
- Not yet run against your Neon project (only against Postgres 16 with Neon's role model).
- No "view as school" for support staff yet (Phase 14).
- No custom domains / per-school subdomains in the web app yet; the active school is chosen
  in the app (Phase 3 CMS adds public school sites).
- Invitations cannot be re-sent from the UI yet; re-inviting needs removal first.
- Platform administration has an API but no screen yet.

## Next phase dependencies (Phase 3)

Academic years, terms, classes, sections, subjects, calendar, grading scales and the basic
CMS build on: campuses (done), permissions catalogue + role templates (add `academic.*` and
`cms.*` permissions via migration + `app.sync_system_role_permissions()`), audit log (done).
