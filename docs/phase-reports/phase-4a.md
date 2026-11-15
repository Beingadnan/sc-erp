# Phase 4a Report — Students

Date: 2026-11-11 · Status: built and tested in the workspace; awaiting live check on Neon

Phase 4 is split: **4a** students (this report) · **4b** admissions workflow and documents ·
**4c** promotion, withdrawal, transfer certificates, import/export, custom fields.

## What was implemented

- **Student records** separate from yearly **enrollments** (year, section, roll number,
  status), with name in Hindi, date of birth, gender, blood group, address, PEN, APAAR ID and
  Aadhaar.
- **Admission** in one step: student, parents/guardians, enrollment in a section (capacity and
  closed-year checks), automatic roll number, and the parent's privacy-notice acknowledgement —
  all in one transaction.
- **Admission numbers** from a school pattern (`{SEQ:n}`, `{YYYY}`, `{YY}`, `{CAMPUS}`),
  optionally per campus and restarting yearly. Gap-free (allocated in the admission's
  transaction) and safe under simultaneous admissions; patterns that would repeat numbers are
  refused; a pattern change never re-issues an existing number.
- **Guardians and siblings**: up to 4 per student, one main contact, fee payer flag; typing a
  known mobile number offers to link the existing parent (sibling). Guardians are shared, so
  correcting a parent's number fixes it for all their children.
- **Privacy acknowledgements** (DPDP): version, channel, time, who recorded it; append-only.
- **Aadhaar**: validated (12 digits, Verhoeff check digit), stored encrypted (AES-256-GCM bound
  to school + student), shown as `XXXX XXXX 1234`; full number only with
  `students.sensitive.view`, and every view is in the audit log. Duplicates detected with a
  per-school keyed hash — the number itself is never stored or logged.
- **Class lists**: section roster in roll order, alphabetical renumbering, section moves and
  roll changes.
- **Search** by name, admission number or parent's mobile; filters by year, class, section.
- **Who sees what**: campus staff see their campus; a class teacher sees only their section's
  students; only admission staff and administrators can change records.
- Screens: Students list / class list, Admit a student, Student record, Admission numbers.

## Fixes found along the way

- Owners and admins could not invite teachers once teachers gained "see my section's students"
  (the no-escalation rule did not know the broader permission covers it) — fixed with an
  explicit "implied by" rule, tested.
- Validation errors for either/or inputs (new vs. existing guardian) now point at the exact
  field.
- Screens could not tell success from failure for actions with no response body (e.g. deleting
  a website page did not navigate away) — fixed for all screens.

## Tests

189 automated tests pass (validation 24, shared 11, database 47, worker 8, API 99), plus lint,
type checks, production build and the RLS checker.

## Database changes

Migrations `0008_students` and `0009_students_security`. Apply with `pnpm db:setup`.

## Next (4b)

Applications from inquiries, review workflow with history, document uploads (needs a storage
decision: local disk for development, Cloudflare R2 or S3-compatible storage for production).
