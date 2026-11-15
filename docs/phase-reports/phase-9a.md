# Phase 9a — Separate staff/parent sign-in, and the school setup workbook

## Separate sign-in for staff and parents

- **Staff:** `/login` ("Staff sign in", email or mobile). A parent-only account is refused with
  "This is a parent account. Please use the parent sign-in."
- **Parents:** `/parent/login` ("Parent sign in", mobile number). Lands in the parent app at
  `/parent` (child pages `/parent/child/<id>`); an account that is not a parent anywhere is refused.
- The landing page shows **Parent login** and **Staff login**; each login page links to the other.
- The login API takes `as: "staff" | "parent"`; the server picks a school where the person holds
  that kind of role (`app.user_tenant_kinds`). Wrong passwords still give only the generic message.
- Signing out of the parent app returns to `/parent/login`. The old `/family` address redirects.

## School setup workbook (Settings → Import old data)

- **Download template:** an .xlsx with _Read me_, _Classes_, _Subjects_, _Staff_, _Teaching_.
- **Classes:** one row per section; class written the way schools write it (1, Class 1, I, 1st, Std 1,
  LKG, UKG, Nursery, 11 Science, XII Commerce). Optional class teacher (mobile, email or name).
- **Subjects:** code optional (made from the name), classes as "All", "1-5", "6, 7, 8", "LKG, UKG".
- **Staff:** name, mobile or email, designation, role (Teacher, Accountant, Receptionist, Principal…),
  employee code. Existing staff are recognised by mobile/email and not added twice.
- **Teaching:** class, section, subject, teacher.
- **Preview** checks every row and lists problems by sheet and row; nothing is saved, and import is
  refused until the workbook is clean. A clean preview shows what is new vs already there.
- **Import** adds everything in one transaction, then shows each new teacher with **Send on WhatsApp**
  (links shown once, valid 7 days). Uploading the same workbook again adds nothing.
- **Undo** (Past imports) removes exactly what that import added: teaching assignments, class
  teachers (restored to before), sections, classes, subject links, subjects, and staff who have not
  signed in yet (staff who already signed in are kept and counted). Undo is refused once students
  are in the imported sections, or the classes/subjects are used elsewhere.
- Today page shows **Import old data** for school managers.

## Tests

- `test/phase9a.e2e.test.ts` (8): template sheets, problems by sheet/row, clean preview counts,
  other school refused, one-go import with WhatsApp links and correct chart, teacher sees classes,
  re-import adds nothing, undo (signed-in staff kept), undo refused after students added.
- `test/phase7a.e2e.test.ts` +1: parent vs staff sign-in pages.
- Validation: class label/list parsing and subject codes.
- Full suite: API 219, DB 47, validation 47 — passing; lint, typecheck, build clean.
- Chrome: download template, fill it, upload, preview, import, chart filled, undo.

## Migrations

`0026_login_audience.sql`, `0027_setup_imports.sql`, `0028_setup_imports_security.sql`.

## Next — 9b

Old fee balances (previous dues and advance per student) with preview and undo, completing the
"Import old data" page.
