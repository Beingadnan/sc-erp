# Phase 6c — Pay to the school account, payment proofs, refunds

Scope change agreed with the school owner: **no payment gateway yet**. Parents pay straight into the
school's own bank account or UPI ID and upload the screenshot; staff check it against the bank
statement and only then is a receipt issued. A gateway (Razorpay or similar) can be added later as
another way to settle a payment link, without changing receipts or the ledger.

## What was built

- **Payment details (Settings → Payment details).** Per campus: payee name, UPI ID, bank account,
  IFSC, bank, branch, note for parents, on/off switch, optional QR image from the bank. Without a QR
  image, a UPI QR is generated in the browser with the amount filled in (`upi://pay?pa=…&am=…`).
  Changes need `settings.manage` and are audited with the account number masked.
- **Payment links (FEE-05).** From a student's fee page: amount (default: what is due today),
  validity 3–30 days. The link is a 32-byte random token; only its SHA-256 is stored. Copy link or
  **Send on WhatsApp** (wa.me with the guardian's number and a ready message). Links can be cancelled;
  expiry is derived.
- **Parent page `/pay/<token>`** (no sign-in, mobile first): school and student first name and
  class only, amount, QR + "Open UPI app", copyable UPI ID / account / IFSC, upload form
  (screenshot or PDF ≤5 MB, UTR, date, name, mobile), status of uploads, receipt PDF after approval.
- **Payments to check (Fees → Payments to check).** Queue with the screenshot, amounts asked and
  claimed, UTR; approve (optionally correcting the amount to what the bank shows) → normal receipt
  (`mode` UPI / bank transfer, reference = UTR, oldest dues first, extra goes to advance); reject with
  a reason the parent sees.
- **Duplicate UTRs are refused**: a UTR can back only one pending/approved proof (unique index) and
  cannot match an existing UPI/bank/card receipt from the counter. UTRs are normalised (upper case,
  no spaces or dashes).
- **Refunds (FEE-07).** From the student's fee page: refund unused advance or a paid refundable
  deposit. The amount is reserved immediately (cannot be applied to fees or refunded twice). A
  different person with `fees.cancel_receipt` approves and records the payout (cash, cheque, bank,
  UPI; reference required except cash), which numbers it `RF/{campus}/{FY}/{00001}` and posts
  Dr advance (or the deposit liability) / Cr cash or bank. Fees → Refunds lists them.
- **Cancelling a paid demand** now moves the money to the student's advance (journal
  Dr receivable / Cr advance, allocation marked released) instead of refusing; from there it can be
  applied to other fees or refunded.

## Safety

- RLS on all five new tables; column-level UPDATE grants; statuses only move forward (trigger);
  refund parts are insert-only and checked by a trigger against what is held.
- The public lookup is a SECURITY DEFINER function that can see a request only through a policy
  limited to the migration role and to the one token hash being looked up.
- Public endpoints are rate-limited; files are type-sniffed; screenshots are private and opened
  through 5-minute signed links; viewing a proof is audited.
- A receipt that has been (partly) refunded, or a demand whose deposit was refunded, cannot be
  cancelled.

## Tests

- `apps/api/test/phase6c.e2e.test.ts` — 17 tests: settings permissions and validation, QR upload,
  link → public page → upload → duplicate UTR → approve → receipt and closed link, rejection and
  re-upload, counter UTR clash, cancelled link, isolation between schools, refunds maker-checker for
  advance and deposit with balanced trial balance, cancel demand → advance → refund, database guards.
- Updated 6b test: cancelling a paid demand now succeeds and moves the money to advance.
- Full suite: API 184, DB 47, validation 43, shared 11 — all passing. Lint, typecheck and build clean.
- Browser check in Chrome: admin saves details, accountant sends link, parent pays on a phone-size
  screen and uploads, accountant approves, parent downloads the receipt, refund asked and approved.

## Migrations

`0020_pay_to_school.sql` (tables) and `0021_pay_to_school_security.sql` (RLS, grants, triggers,
lookup). Run `pnpm db:setup`.

## Known limits / next

- No automatic bank-statement matching; staff check by eye. A gateway or bank API can come later.
- No SMS/WhatsApp sending from the server; staff share the link from their phone.
- Refund voucher PDF not yet printed (the refund number and journal are recorded).
