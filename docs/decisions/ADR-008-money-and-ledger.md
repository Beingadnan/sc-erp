# ADR-008: Money in paise and an append-only double-entry ledger

Date: 2026-11-12 · Status: accepted

## Context

Fees are the money of a school; mistakes or silent edits are expensive and must be traceable
(FEE-09, threat-model T15). Amounts in Indian schools run from paise (late fees per day) to
crores (school totals).

## Decision

- **Whole paise in `bigint` columns**, integers in the API. No floating point anywhere; rupee
  formatting (Indian grouping) happens only at the edge (`formatInr`, `parseRupees`).
- **Demands are fixed once raised.** A demand line's amount never changes; reductions are
  _adjustments_ (concessions, waivers), each with its own approval and status.
- **Every financial event posts a balanced journal** (`ledger_journals` + `ledger_entries`):
  raising a demand (Dr receivable / Cr fee-head income), a concession or waiver (Dr concessions
  / Cr receivable), a late fee (Dr receivable / Cr late fee income). The receivable entries
  carry the student id, so a student's statement is a query.
- **Corrections are reversals**: a mirror journal with debits and credits swapped
  (`reverses_id`, one reversal per journal, never a reversal of a reversal).
- **Database guarantees**, not just code: a deferred constraint trigger checks every journal
  balances with at least two entries at commit; the app role has no UPDATE/DELETE on journals,
  entries or demand lines, only status columns elsewhere; a trigger stops reductions from
  exceeding a line.
- **Balances are derived**, never stored: outstanding = lines − approved adjustments
  (− payments from Phase 6b).

## Consequences

- Reports always reconcile with the ledger; a trial balance is a single query.
- Fixing a wrong demand means cancelling (reversing) and raising again — the history stays.
- Bulk work posts journals in a few statements (240 demands with ledger in ~0.2 s locally).
- Schools keep their books in Tally (A9); a Tally export can be built from the journals later.
