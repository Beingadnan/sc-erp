# Functional Requirements (MVP)

IDs are stable; reference them in tests and PRs. Priority: M = must for MVP, S = should, C = could.

## PLT — Platform & tenancy

| ID     | Requirement                                                                                                                                                                | P   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| PLT-01 | A visitor can register a school; this creates a tenant, a first campus, default roles and an owner membership atomically.                                                  | M   |
| PLT-02 | Each tenant gets a subdomain `{slug}.<app-domain>`; custom domains later.                                                                                                  | M   |
| PLT-03 | A user may belong to several tenants and switch between them; tenant context always comes from the verified session, never from client input.                              | M   |
| PLT-04 | Email verification, password reset, session list + revoke, login rate limit, lockout after repeated failures.                                                              | M   |
| PLT-05 | TOTP MFA mandatory for owner, admin, accountant and platform roles.                                                                                                        | M   |
| PLT-06 | Platform staff can view tenant list and suspend/reactivate tenants. Support "view as" requires reason, is time-boxed, and is visible to the tenant owner in the audit log. | M   |
| PLT-07 | Every create/update/delete on business records writes an audit entry (actor, tenant, campus, entity, action, diff with PII redacted, IP, timestamp).                       | M   |

## RBAC — Roles & permissions

| ID      | Requirement                                                                                                                                                                                                       | P   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| RBAC-01 | Permissions are granular strings (`students.view`, `fees.collect`, …) grouped by module.                                                                                                                          | M   |
| RBAC-02 | System roles ship pre-configured (owner, admin, principal, vice principal, academic coordinator, accountant, admission officer, HR, teacher, librarian, transport manager, receptionist, parent, student, staff). | M   |
| RBAC-03 | Tenants can create custom roles from permissions without code changes.                                                                                                                                            | M   |
| RBAC-04 | Role assignments carry a scope: all campuses, specific campuses; teacher data scope derived from teacher assignments; parent scope from guardian links; student scope = self.                                     | M   |
| RBAC-05 | Navigation and actions in the UI reflect permissions; the server re-checks every request.                                                                                                                         | M   |

## CFG — School configuration

| ID     | Requirement                                                                                                           | P   |
| ------ | --------------------------------------------------------------------------------------------------------------------- | --- |
| CFG-01 | Onboarding wizard: profile, logo, board, timezone (default Asia/Kolkata), currency (default INR), academic year.      | M   |
| CFG-02 | Academic years with terms; exactly one current year per campus; closing a year locks its enrollments and fee demands. | M   |
| CFG-03 | Classes (grade levels), sections with capacity, subjects, class-subject mapping — all tenant-defined.                 | M   |
| CFG-04 | Calendar: holidays, working-day rules, events.                                                                        | M   |
| CFG-05 | Grading scales and bands configurable per class range.                                                                | M   |
| CFG-06 | Custom fields for students, guardians and staff (text, number, date, select).                                         | S   |
| CFG-07 | Basic CMS pages with draft/publish and version history; inquiry form creates an admission lead.                       | S   |

## ADM — Admissions

| ID     | Requirement                                                                                                             | P   |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | --- |
| ADM-01 | Capture inquiries/leads with source and follow-up status.                                                               | M   |
| ADM-02 | Online and staff-entered applications with configurable fields and document uploads.                                    | M   |
| ADM-03 | Workflow: submitted → under review → (assessment) → approved / waitlisted / rejected, with history.                     | M   |
| ADM-04 | On confirmation: admission number generated from a tenant-configurable pattern, gap-free; student + enrollment created. | M   |
| ADM-05 | Admission reports by status, class, source.                                                                             | S   |

## STU — Students & guardians

| ID     | Requirement                                                                                          | P   |
| ------ | ---------------------------------------------------------------------------------------------------- | --- |
| STU-01 | Permanent student identity separate from yearly enrollment (year, class, section, roll no., status). | M   |
| STU-02 | Multiple guardians per student; one guardian linked to multiple students (siblings).                 | M   |
| STU-03 | Optional identifiers: PEN, APAAR ID, Aadhaar (masked display, restricted permission).                | S   |
| STU-04 | Documents stored per tenant with signed, short-lived URLs.                                           | M   |
| STU-05 | Bulk promotion, section transfer, withdrawal, TC generation (PDF), alumni — history preserved.       | M   |
| STU-06 | Excel/CSV import with preview, duplicate detection, row errors, confirm, async processing, report.   | M   |
| STU-07 | Search and filter; export requires `students.export` and is audited.                                 | M   |
| STU-08 | Record guardian acknowledgement of privacy notice (version, time, channel).                          | M   |

## ATT — Attendance

| ID     | Requirement                                                                                                  | P   |
| ------ | ------------------------------------------------------------------------------------------------------------ | --- |
| ATT-01 | Mark a section for a date (daily mode) or period (period mode); statuses present/absent/late/half-day/leave. | M   |
| ATT-02 | Teachers can mark only assigned sections; holidays block marking.                                            | M   |
| ATT-03 | Corrections after cut-off need `attendance.correct`, a reason, and keep history.                             | M   |
| ATT-04 | Parent leave requests approved by class teacher set "leave" status.                                          | S   |
| ATT-05 | Monthly summary and percentage per student; low-attendance list by threshold.                                | M   |
| ATT-06 | Absence event emitted for notifications.                                                                     | M   |

## FEE — Fees & payments

| ID     | Requirement                                                                                                                                 | P   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FEE-01 | Fee heads with tax category; fee structures per year × class (× campus) with items and installment plans.                                   | M   |
| FEE-02 | Concessions by rule (sibling, staff ward, scholarship, RTE) or per student with approval.                                                   | M   |
| FEE-03 | Demand generation per installment; late fee by rule; waivers with approval.                                                                 | M   |
| FEE-04 | Counter collection: cash, cheque/DD (clear/bounce), UPI reference, card, bank transfer; partial payments with allocation.                   | M   |
| FEE-05 | Online payment via Razorpay to the school's account; webhook signature verified; idempotent.                                                | M   |
| FEE-06 | Receipts per series, gap-free, PDF; cancellation creates reversal, never deletes.                                                           | M   |
| FEE-07 | Refunds with approval and ledger entries.                                                                                                   | M   |
| FEE-08 | Day closing per cashier; reports: daily collection, outstanding, class-wise, student ledger, mode-wise, concessions, refunds; CSV/XLSX/PDF. | M   |
| FEE-09 | Double-entry ledger; balances derived, never stored as mutable totals without a ledger.                                                     | M   |

## PAR — Parent portal (MVP slice)

| ID     | Requirement                                                              | P   |
| ------ | ------------------------------------------------------------------------ | --- |
| PAR-01 | Guardian logs in (mobile OTP or password) and sees only linked children. | M   |
| PAR-02 | View attendance, dues, pay online, download receipts, read notices.      | M   |

## NFR — cross-cutting

See PRD §7. Every requirement above has at least one automated test, and every tenant table is covered by the isolation suite.
