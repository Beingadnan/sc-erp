# Phase 7a — Parent portal: accounts, attendance, fees, paying

## What was built

- **Sign in with a mobile number.** Staff keep using email; parents use the mobile number the
  school has for them. Users may now have no email (`users.login_phone`, unique).
- **Giving access (student page → Parent app access).** Each guardian shows *No access*,
  *Invited* or *Has access* (with last sign-in). **Give access** makes a one-time link valid 7 days,
  with **Send on WhatsApp** (guardian's number and a ready message) and **Copy link**. Also
  **Password reset link** (2 days) and **Remove access**.
- **Activation page `/portal/activate`.** The parent sees the school and their first name, sets a
  password (≥ 8 characters, typed twice) and lands in the app. If the mobile number already has a
  parent account (child at another school on the platform), they enter that password instead and the
  new school is added to the same account; the school switcher appears in the header.
- **Parent app (`/family`, phone-first).**
  - Home: each child with class, today's attendance, fees due now and total outstanding.
  - Child → Attendance: year percentage with a warning below the school's minimum, counts,
    a month calendar coloured by status, and the list of absences.
  - Child → Fees: due now / outstanding, each instalment with fee heads and concessions, receipts
    as PDFs, uploads still being checked or rejected (with reason), and **Pay fees**, which opens
    the school bank / UPI page from Phase 6c (screenshot + UTR, staff approve, receipt).
  - Someone who is only a parent is always sent to `/family`; staff who are also parents get
    **My children** in the menu.

## Safety

- The link token is random (256 bits); only its SHA-256 is stored. Links are single-use, and a new
  link cancels older ones.
- Accounts, school membership, the Parent role and the guardian link are created only inside a
  database function; the app role cannot set `guardians.user_id`, `users.login_phone` or mark links
  used.
- A school can reset a parent's password only for a parent-only account (no email, no platform role)
  that no other school uses — so one school cannot take over an account another school relies on.
  Resetting signs out every session.
- Every family query starts from the signed-in user's linked guardian records; other children,
  other schools and all staff endpoints return 404/403 (tested).
- Parents are hidden from Staff & access.

## Also fixed

- Phase 6c: saving payment details with only a UPI ID (no bank account) failed validation. Fixed and
  covered by a test.

## Tests

- `apps/api/test/phase7a.e2e.test.ts` — 14 tests: guardian status, permissions, activation and
  single-use links, weak password refused, family sees only own children (siblings yes, others no),
  staff endpoints refused, attendance and fees shown, receipt PDF only for own child, paying through
  the school account, phone sign-in, same parent at two schools, reset rules, removing access.
- Full suite: API 198, DB 47, validation 44, shared 11 — all passing; lint, typecheck, build clean.
- Chrome check: staff gives access, parent activates on a phone-size screen, sees attendance
  calendar and fees, downloads a receipt, starts a payment, signs out and back in with the mobile.

## Migrations

`0022_portal_access.sql`, `0023_portal_access_security.sql`. Run `pnpm db:setup`.

## Known limits

- Mobile numbers are not verified by OTP yet (needs an SMS gateway and DLT registration). The
  activation link is the proof, so staff must send it only to the guardian's own number.
- Notices and parent leave requests come in Phase 7b.
