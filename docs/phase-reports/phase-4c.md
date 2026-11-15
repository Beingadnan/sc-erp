# Phase 4c Report — Student Records Lifecycle

Date: 2026-11-11 · Status: built and tested in the workspace; awaiting live check on Neon

This completes Phase 4 (students and admissions).

## What was implemented

- **Year-end promotion** (Students → Promote): pick a section and next year; each student is
  promoted (next class suggested), kept in the same class, marked as completed school
  (alumni) or left for later. One step for the whole section, checked for seats, refuses to
  run twice, and cannot "promote" into a lower class.
- **Withdrawal** with date and reason; the enrollment ends and the student leaves class lists.
- **Transfer certificates**: numbered `TC/2027/0001` (gap-free per year), printable PDF
  (A4, school header, date of birth in words, PEN/APAAR, signatures), one valid TC at a time;
  a wrong TC is cancelled with a reason (it then prints with a CANCELLED stamp) and a new
  number is issued. The certificate is a snapshot, so later edits never change a printed TC.
- **Export** (Download CSV on the student list): opens in Excel with Hindi names intact, uses
  the same columns as the import template, masks Aadhaar, neutralises spreadsheet formulas,
  and every export is logged.
- **Import** (Students → Import): CSV or Excel; common headings understood ("DOB", "Adm No",
  "Father Name", "Mobile"); Indian date formats; preview lists every problem by row and column
  (bad dates, unknown class/section, duplicates in the file, admission number / PEN / APAAR /
  Aadhaar already used, same name and birth date as an existing student); valid rows import
  in the background with a per-row report; existing admission numbers can be kept; parents
  already in the school are linked (siblings) instead of duplicated; an interrupted import can
  be resumed.
- **Custom fields** (School → Custom fields): text, number, date or list fields for students and
  parents, optional or required; shown on admission and student forms, included in import and
  export; hidden instead of deleted.

## Security and data protection

- New permissions: promote, withdraw (TCs), export, import — given only to senior roles.
- TCs cannot be deleted or rewritten by the app (database grants); custom field definitions
  cannot be deleted; import records keep only what is needed and clear the row data when done.
- Imports require confirming that parents received the privacy notice; acknowledgements are
  recorded per student.
- Two dependency advisories (in `@vercel/blob` and `exceljs` sub-dependencies) fixed with
  version overrides; `pnpm audit` reports no known vulnerabilities.
- Cross-school checks for TCs, withdrawal, imports and exports.

## Tests

219 automated tests pass (validation 30, shared 11, database 47, worker 8, API 123), plus lint,
type checks, production build, RLS checker and dependency audit. The TC PDF was rendered and
checked visually.

## Setup needed

`pnpm install` (new packages: pdf-lib, exceljs, papaparse), then `pnpm db:setup`
(migrations 0012, 0013).

## Known limits

- The PDF uses standard fonts, so names are printed in English letters (Hindi names are kept in
  the record but not printed yet).
- Imports run inside the API process (no Redis needed); very large imports should be split
  into files of 2,000 rows.
- Rejoining after withdrawal is done as a new admission.
