# Phase 9b — Old fee balances

Schools moving from a register or another software carry last year's unpaid fees and advances.

## What the school does

Settings → Import old data → **3. Old fee balances**:

1. **Download template** (CSV): Admission no, Name, Previous dues, Advance (rupees).
2. **Upload balances** (CSV or Excel). Each row is matched to a student by admission number in the
   current year. Problems are listed by row (unknown admission no., both dues and advance, bad
   amount, student already has old dues); nothing is saved until the file is clean.
3. **Import balances**. Each student gets:
   - **Previous dues** → a demand "Previous year dues — Opening balance" on their fee account,
     collected at the counter like any fee and visible to parents.
   - **Advance** → a credit receipt `OB/<campus>/<year>/<n>` (mode "Old balance (brought forward)")
     that the counter uses against the next fees.
4. **Undo** from Past imports, until any of those dues are paid or any advance is used.

## Accounting

- New system account **3900 Opening balances (old records)**. Dues: Dr Fees receivable / Cr 3900.
  Advance: Dr 3900 / Cr Advance from students.
- Opening receipts are not cash: excluded from the day's collection, day closing and the collection
  report, and allowed without the 30-day back-date and closed-day checks.

## Tests

`apps/api/test/phase9b.e2e.test.ts` (7): template, preview problems, apply with ledger check, counter
collects old dues, advance used against new fees, undo refusals, permissions. Browser smoke: preview
with a bad row (blocked), clean re-upload, apply, parent sees "Previous year dues".

## Migration

`0029_opening_balances` (payment mode `opening`, `setup_imports.kind`).
