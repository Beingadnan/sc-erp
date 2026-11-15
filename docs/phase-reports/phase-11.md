# Phase 11 — Exams, marks and report cards

## Office (exam in-charge: owner, school admin, principal, vice principal, academic coordinator)

- **Exams → New exam** (Periodic Test 1, Half-yearly, Periodic Test 2, Annual are suggested).
- **Date sheet** per class: tick the subjects, set date, time, maximum and pass marks. Pass marks
  follow CBSE's 33% automatically unless changed by hand. A subject that already has marks cannot
  be removed, and the maximum cannot go below a mark already given.
- **Start marks entry** opens the exam to teachers. **Marks & results** shows a grid per class:
  each subject and section with entered/total, "Handed in", and the teacher's name.
- **Publish results** shows results and report cards to parents. **Take back results** reopens
  corrections (parents stop seeing them until published again).
- **Result** per section: every student's marks and grade per subject, total, percentage, overall
  grade, rank (ties share a place), subjects below pass marks, the class teacher's remarks, a
  report-card PDF per student, and Print.

## Teacher

- Today page: **Marks to enter** for open exams (their subjects in their classes only).
- Exams → **My marks entry** → a class: type marks and press Enter to move to the next student;
  type "a" for absent; also Medical and Exempt. Saves as they go; checks the maximum; flags marks
  below pass. **Hand in marks** when every student has marks or a status; after that the marks are
  locked until the exam in-charge reopens them.
- Class teacher: the class result page with a remark box for each student (printed on the
  report card).

## Parent

- Child page → **Results** tab: each published exam with marks, grades, total, percentage, rank,
  subjects to improve and the class teacher's remark; **Report card** PDF.

## Rules

- Grades use the class's grading scale if set (Academics → Grading), otherwise CBSE's eight-point
  scale (A1 91–100 … E below 33). Percentages are worked out on subjects the student was not
  exempt from; absent counts as 0 and a fail in that subject.
- Report card: school, exam, student details, father's/mother's name, attendance up to the exam,
  marks table, percentage, grade, rank, result, remark, grading key, signature lines. "Provisional"
  is printed on cards downloaded by staff before publishing.

## Security

- Five new tables with FORCE RLS and column grants; new permission `exams.manage`.
- Marks are entered only by the teacher assigned to that subject in that section, or the exam
  in-charge. Whole-class results are for the class teacher and the office (teachers' general
  `academic.view` is not enough). Parents see only published results of their own children.

## Tests

`apps/api/test/phase11.e2e.test.ts` (8) and `packages/validation/src/exams.test.ts` (4).
Full suite: 243 API + 47 DB + 51 validation + 11 shared + 8 worker. Browser check in Chrome:
exams list, date sheet, progress grid, section result, teacher Today + marks entry, parent Results
tab and report card PDF.

## Demo data

`node scripts/seed-demo.mjs` now also creates Periodic Test 1 (results published, remarks for
Class 8 A) and Half-yearly (open; teachers who can sign in have their papers left to fill).
The API allows 10 invite acceptances per 15 minutes, so run the seed at most once every 15 minutes.

## Migrations

`0032_exams`, `0033_exams_security`.
