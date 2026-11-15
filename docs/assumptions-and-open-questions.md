# Assumptions and Open Questions

## Assumptions (in force unless you change them)

| #   | Assumption                                                                                                                                                                                         | Impact if wrong                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| A1  | Greenfield repository; no existing code to migrate.                                                                                                                                                | — (confirmed)                  |
| A2  | India-first: INR, Asia/Kolkata, April–March academic year default (confirm the session start month with the Rajasthan pilot schools — keep configurable), CBSE + RBSE templates first, ICSE later. | Seed data and report templates |
| A3  | Database: Neon Postgres, AWS Singapore, shared schema + RLS.                                                                                                                                       | Region / residency             |
| A4  | ORM: Drizzle; migrations as committed SQL.                                                                                                                                                         | Phase 1 tooling                |
| A5  | Auth: own session auth in NestJS (no Clerk/Auth0).                                                                                                                                                 | Phase 2 effort                 |
| A6  | Payment gateway: Razorpay with settlement to each school's account.                                                                                                                                | Phase 6 integration            |
| A7  | Team: 2 full-time developers → ~51 weeks full scope, ~22 weeks MVP.                                                                                                                                | Timeline                       |
| A8  | Each school is its own DLT entity for SMS (we provide the checklist).                                                                                                                              | Phase 11 onboarding            |
| A9  | Fee module is a sub-ledger; schools keep books in Tally.                                                                                                                                           | Phase 6/13 scope               |
| A10 | PWA first; native apps later.                                                                                                                                                                      | Phase 10                       |
| A11 | Our legal role is Data Processor for each school (Data Fiduciary).                                                                                                                                 | Contracts, DPDP duties         |

## Decisions recorded (2026-11-11)

| #   | Decision                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Start from an empty monorepo in `~/Desktop/school-erp`.                                                                                                                       |
| D2  | Pilot boards: **CBSE** and **Rajasthan Board (RBSE / BSER Ajmer)**. Rajasthan state defaults: Hindi + English notices, Rajasthan Professional Tax rules for payroll (verify). |
| D3  | Neon **free plan** during development, region AWS Singapore; move to a paid plan before the pilot.                                                                            |
| D4  | **20 schools** available for interviews and pilot. Use 3–5 for Phase 0/1 interviews and 3 for the first pilot cohort.                                                         |

## Open questions — blocking

| #   | Question                                                                           | Needed by    |
| --- | ---------------------------------------------------------------------------------- | ------------ |
| Q2  | Will any of the 20 schools refuse data stored in Singapore? Ask during interviews. | Before pilot |
| Q3  | How many developers, and is ~22 weeks to MVP acceptable?                           | Planning     |

## Open questions — non-blocking (default in brackets)

| #   | Question                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ |
| Q5  | Pricing model: per student per year vs flat tiers? [per student per year, all core modules included]         |
| Q6  | Product/brand name and app domain? [placeholder `school-erp`, `*.example.in`]                                |
| Q7  | Fee holds on report cards/hall tickets for defaulters — allow as a school setting? [allowed, off by default] |
| Q8  | Tally export format (XML vouchers vs Excel)? [Excel first]                                                   |
| Q9  | Languages for parent notices? [English + Hindi]                                                              |
| Q10 | Should parents be able to see class rank? [school setting, off by default]                                   |

## Needs professional validation ⚖️

- DPDP: scope of the educational-institution exemption for our processing; DPA template; retention periods.
- GST treatment of non-tuition heads (uniforms, books, coaching) and receipt format.
- Payment flow structure (school as sub-merchant) under RBI PA guidelines.
- Payroll statutory calculations (PF, ESI, PT by state, TDS).
