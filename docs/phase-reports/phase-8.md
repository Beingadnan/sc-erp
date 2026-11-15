# Phase 8 — Teachers and who teaches what

Follows `docs/product/school-day-by-role.md`: a teacher must see only their own classes, and the
office must be able to set up the school the way the timetable chart on the staff-room wall does.

## What was built

- **Staff by mobile number** (Settings → Staff & access → Add staff). Choose _Mobile number_ (default)
  or _Email_, plus designation (e.g. "PRT Hindi"). For a mobile, the office gets a link with
  **Send on WhatsApp**; the teacher sets a password and signs in with the mobile. Staff list shows
  designation and mobile. Staff profile (designation, employee code, mobile, joining date) can be
  edited (`PUT /members/:id/profile`).
- **Who teaches what** (Academics → Who teaches what): one table per class — sections down the side,
  _Class teacher_ and each of the class's subjects across the top, a teacher picker in each cell,
  saved as soon as it is picked. A side list shows each teacher's load (class teacher of · subject
  classes). Teachers who have not signed in yet can already be placed.
- **My classes** for teachers (Today page and the _My classes_ menu item): class-teacher section
  first with "Attendance due/done" and **Take attendance**, then subject classes ("Class 3 B · Hindi").
  **Class list** shows the students of that section.
- **Strict scope:**
  - Subject teacher: class list only (roll, name, admission number) for sections they teach — no
    parents' phones, no profiles, nothing from other sections.
  - Class teacher: their section's full student profiles, parents' phones with Call / WhatsApp, and
    attendance (as before).
  - The Today page hides attendance tiles for teachers with no register of their own.
- **One person, many roles:** a parent of the school who joins the staff keeps one account (staff
  roles are added). A staff link stops working once that mobile number already has a password (for
  example it was activated as a parent), so a link cannot be used to sign in as someone else.
- "My classes" uses the current academic year, or the latest one when none is marked current.

## Tests

- `apps/api/test/phase8.e2e.test.ts` — 12 tests: invite by mobile and sign in, email/mobile rules,
  profile and duplicate employee code, chart contents, assigning/clearing, subject not in class
  refused, permission and other-school checks, Hindi teacher sees exactly Class 1 A and 3 B,
  subject teacher gets no parents/profiles, class teacher gets their section only, staff+parent
  on one number.
- Full suite passing (API 210, DB 47, validation 44, shared 11); lint, typecheck, build clean.
- Chrome: owner adds a teacher by mobile, assigns Hindi in two sections and class teacher of one,
  teacher signs in on a phone and sees My classes and the class list.

## Migrations

`0024_staff_teaching.sql`, `0025_staff_teaching_security.sql`. Run `pnpm db:setup`.

## Next

Phase 9 — bring old data in one Excel workbook (classes/sections, subjects, staff, who-teaches-what,
students + parents, opening fee balances) with preview, errors and undo.
