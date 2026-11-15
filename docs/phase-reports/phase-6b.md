# Phase 6b Report — Fee Counter, Receipts, Day Closing and Reports

Date: 2026-11-12 · Status: built and tested in the workspace; awaiting live check on Neon

## What was implemented

- **Fee counter** (FEE-04): find a student by name, admission number or parent's phone; see
  every unpaid fee with what is overdue; take cash, UPI, cheque, demand draft, card or bank
  transfer. Part payments settle the oldest dues first (fees before late fees), or tick the
  fees a payment is for. Paying more than is due keeps the rest as advance, which can later
  be used for new dues in one click. A double click or a retry never takes money twice.
- **Receipts** (FEE-06): numbered `MAIN/2026-27/00001` — gap-free per campus and financial
  year (April–March), cancelled ones keep their number. A PDF receipt with the amount in
  words (lakh/crore), the fees settled, payment details and "subject to realisation" for
  cheques; cancelled and bounced receipts are watermarked.
- **Cheques and DDs**: held as pending ("cheques awaiting clearance" in the books) until
  marked cleared (moves to bank) or bounced (receipt reversed, dues reopen, an event is
  queued for parent messages later).
- **Cancelling a receipt**: only with "cancel receipts" rights and a reason; the ledger is
  reversed, never edited.
- **Day closing** (FEE-08): each cashier closes their day with a cash count; differences need
  a note; no more receipts can be dated on a closed day. Closed days are listed for review.
- **Reports** (FEE-08): collection (receipts, by mode, by cashier, by fee head), outstanding by
  class and section (billed, concessions, paid, outstanding, overdue, students overdue), and
  concessions & waivers — each downloadable as CSV or Excel.
- **Everything from 6a now counts payments**: demand balances and statuses, late fees stop
  once fees are paid, waivers and concessions only on what is unpaid, demands with payments
  cannot be cancelled.

## Database

Migrations `0018_fee_payments` and `0019_fee_payments_security`: payments, allocations and
day closings with forced row-level security. Receipts can only change status, forward only
(pending → cleared/bounced/cancelled, cleared → cancelled). The database refuses any
allocation or reduction that would take a fee line past its amount, or a receipt past its
own amount.

## Tests

- `phase6b.e2e.test.ts` (13): cash with numbering and idempotent retries, chosen fees and
  over-allocation refusals, advance and applying it, cheque clear and bounce with the books
  checked, late fees stopping on paid dues, cancellation keeping numbers gap-free, cancel
  rights, demand-cancel guard, receipt PDF, day closing with cash difference and lock-out,
  collection report (CSV with BOM, Excel), outstanding report equal to the ledger, database
  privileges, isolation between schools.
- Unit tests for amounts in words, financial years and payment validation.
- Full suite: all tests pass; lint, typecheck, build and RLS check clean. In a headless
  browser an accountant took cash, UPI (with advance) and cheque payments at the counter,
  printed a receipt, cleared the cheque and closed the day ₹100 short; the outstanding report
  matched (₹1,05,000 billed, ₹67,000 paid, ₹38,000 outstanding).

## Fixed during the browser check

- Switching report tabs could show the previous tab's data in the new view and crash.
- Dashes in fee names printed as "?" on receipts.

## Known limits

- Receipts use the built-in PDF fonts, so names in Devanagari or other Indian scripts print as
  "?" (the transfer certificate has the same limit). Embedding a Unicode font is a follow-up.
- Admission-office collection limited to admission fees, refunds and Razorpay come in 6c.
