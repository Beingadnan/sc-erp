# Phase 6a Report — Fee Setup, Concessions, Demands and Ledger

Date: 2026-11-12 · Status: built and tested in the workspace; awaiting live check on Neon

Phase 6 (fees) is built in three parts: **6a** (this) setup, concessions, demands and the
ledger; **6b** counter collection, receipts, day closing and reports; **6c** Razorpay online
payments and refunds.

## What was implemented

- **Fee heads** (FEE-01): tuition, annual, transport, exam, refundable deposits… with GST rate
  (school fees are exempt; amounts are tax-inclusive). Each head gets its own ledger account.
- **Fee structures** (FEE-01): per campus and year. _Class_ structures bill every student of
  the chosen classes; _optional_ ones (transport, hostel) bill students added to them. An
  installment plan grid (one row per installment, one column per fee head) with quick starts
  for yearly, half-yearly, quarterly and monthly plans. Amounts lock when published.
- **Late fee rules** (FEE-03): none, fixed, or per day after a grace period with a cap.
  "Apply late fees" adds exactly what is owed as of today; repeating it adds nothing more.
- **Concessions** (FEE-02): types (sibling, staff ward, scholarship, RTE, merit) as a percent or
  a fixed amount per installment, limited to chosen fee heads. Given per student with a reason;
  accountants request, owner/admin/principal approve. Approval also reduces demands already
  raised; revoking puts it back (by reversal).
- **Demands** (FEE-03): raised per structure and installment in one click; safe to run again
  (only unbilled students); students admitted after a due date are not billed for it unless
  named. Waivers on any line with approval. A wrong demand is cancelled with a reason and can
  be raised again.
- **Student fee account**: every demand with its lines, concessions and waivers, optional
  fees on/off, and a running statement; summary card on the student profile.
- **Ledger** (FEE-09): see ADR-008 — balanced journals checked by the database, append-only,
  reversals for corrections, trial balance page.

## Database

Migrations `0016_fees` and `0017_fees_security`: 14 tables, all with forced row-level security;
balanced-journal constraint trigger; reductions can never exceed a line; money rows are
insert-only for the app role.

## Tests

- `phase6a.e2e.test.ts` (16): heads and accounts, school-wide rule, structure plan / publish /
  lock / delete, concession types, concession before and after demands, 240 demands for 120
  students (≈0.2 s) raised once, late joiners, list filters and totals, late fees once, waivers
  with approval and limits, revoke with reversals, optional fees, cancel and re-raise, trial
  balance agreeing after every step, database privileges and unbalanced-journal rejection,
  isolation between schools.
- Unit tests for late fee rules, concession splitting (never more than the lines) and rupee
  formatting/parsing.
- Full suite: 257 tests pass; lint, typecheck, build and RLS check clean. Built a structure
  through the screens in a headless browser (quarterly plan, publish, raise 24 demands); totals
  matched the trial balance.

## Changes to earlier behaviour

- Granting: `fees.configure` covers `fees.collect`, `fees.cancel_receipt` covers `fees.refund`
  (so owners and school admins can invite accountants).

## Not in this phase

- Taking payments, receipts, day closing and collection reports (6b); Razorpay and refunds
  (6c). Until then outstanding amounts only fall through concessions and waivers.
- A nightly automatic late-fee run (the worker will call the same action).
