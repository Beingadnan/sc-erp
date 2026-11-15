# Product Requirements Document — School ERP SaaS

Status: Phase 0 draft for approval · Owner: Adnan Khan · Last updated: 2026-11-11

## 1. Problem

Indian schools run admissions, attendance, fees and exams across registers, Excel and dated ERPs. Accountants can't reconcile collections, parents get little visibility, and school groups can't see across campuses. Existing products are either broad-but-dated (Entab, Fedena, MyClassboard) or modern-but-shallow on finance (Teachmint).

## 2. Vision

One multi-tenant platform where any school or school group self-onboards, configures its own structure (board, classes, fees, grading, roles), and runs daily operations with complete isolation from every other school.

## 3. Target customers (initial)

| Segment                                                         | Size      | Why they buy                                       |
| --------------------------------------------------------------- | --------- | -------------------------------------------------- |
| Single private K-12 school, 300–2,000 students, CBSE/ICSE/state | Primary   | Fee collection + parent app + report cards         |
| School groups, 2–20 campuses                                    | Secondary | Consolidated finance and strength, central control |
| Pre-schools / chains                                            | Later     | Simpler fee + communication needs                  |

## 4. Personas

- **Owner / Trustee** — wants collections, dues and strength at a glance; approves concessions.
- **Principal** — academic performance, attendance trends, staff workload, notices.
- **School Admin / Office** — admissions, student records, certificates, imports.
- **Accountant / Cashier** — counter collection in seconds, day closing, defaulters, reconciliation.
- **Teacher / Class Teacher** — mark attendance, homework, marks entry for assigned classes only.
- **Parent** — mostly mobile; pay fees, see attendance, results, notices; one login for all children.
- **Student** — timetable, homework, results (age-appropriate).
- **Platform Support** — help schools without seeing more than needed; every access audited.

## 5. Goals and success metrics (pilot)

| Goal                  | Metric                                 | Target                                   |
| --------------------- | -------------------------------------- | ---------------------------------------- |
| Fast onboarding       | Time from sign-up to first fee receipt | ≤ 3 working days with import             |
| Accountant efficiency | Counter receipt time                   | ≤ 30 seconds                             |
| Parent adoption       | Parents active monthly                 | ≥ 60% of enrolled families               |
| Online collection     | Share of fees paid online              | ≥ 30% in first term                      |
| Isolation             | Cross-tenant leaks                     | 0 (automated suite green on every build) |
| Reliability           | Monthly availability                   | ≥ 99.5% during pilot                     |

## 6. Scope

### MVP (Phases 0–6 + parent portal slice)

1. Platform: sign-up, tenants, campuses, roles/permissions (custom roles), audit log, platform admin.
2. School configuration: profile, branding, academic years/terms, classes, sections, subjects, calendar/holidays, grading scales, custom fields.
3. Admissions: inquiry → application → documents → approval/waitlist → admission number → enrollment.
4. Students & guardians: profiles, siblings, documents, promotion, transfer, withdrawal, TC, alumni, Excel import.
5. Attendance: daily/period-wise, corrections with audit, leave requests, reports, low-attendance alerts (in-app).
6. Fees: heads, structures, installments, concessions, demands, late fees, counter + online (Razorpay) collection, receipts, cheque lifecycle, refunds, cancellations, day closing, core reports.
7. Parent portal (slice): children, attendance, dues, pay online, receipts, notices.
8. Basic public website CMS.

### Post-MVP (Phases 7–14)

Staff & leave, timetable, homework, exams & report cards, full parent/student portals, SMS/email/WhatsApp/push, transport, library, hostel, inventory, payroll, advanced analytics, production hardening.

### Explicitly out of scope (for now)

LMS/live classes, full general-ledger accounting (Tally export instead), GPS hardware, biometric data collection, native mobile apps (PWA first).

## 7. Non-functional requirements

- **Isolation**: shared Postgres (Neon) with `tenant_id` + RLS (default-deny) + composite FKs; tenant context transaction-local; tests with ≥ 2 tenants.
- **Security**: Argon2id, HttpOnly session cookies, MFA for privileged roles, rate limits, CSP, signed file URLs, PII-redacted logs, audit trail.
- **Money**: decimal only, immutable ledger, idempotent payments, verified webhooks, gap-free receipt numbers per series.
- **Performance (initial)**: p95 API < 300 ms for list/detail; attendance save for a 45-student section < 1 s; reports up to 5,000 students < 5 s or async.
- **Scale assumption for design**: 500 schools × avg 1,500 students ≈ 750k students in year 2; peak 30k concurrent users around 8–10 am IST.
- **Accessibility**: WCAG 2.1 AA for core flows; works on low-end Android over 3G/4G.
- **Localisation**: English first; Hindi + one regional language for parent-facing screens and notices.
- **Compliance**: DPDP-aligned (processor role, consent records, rights requests, retention, breach runbook).

## 8. Release plan

See the phase-wise build plan (Neon edition). Each phase ends with passing tests, updated docs and owner approval.

## 9. Risks

Cross-tenant leakage, payment/receipt integrity, board-format churn, DLT/WhatsApp onboarding delays, legal ambiguity on DPDP school exemption scope, data residency objections. Mitigations in `docs/security/threat-model.md` (Phase 1).
