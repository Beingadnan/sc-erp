# Phase 3a Report — School Structure

Date: 2026-11-11 · Status: built and tested in the workspace; awaiting live check on Neon

Phase 3 is split: **3a** (this report) covers academic years, classes, sections, subjects,
calendar and grading. **3b** will cover the school website pages (CMS) and the inquiry form.

## What was implemented

- **Academic years** per campus: dates, weekly offs (any weekday) and Saturday-off rules
  (e.g. 2nd and 4th Saturday). No overlapping years on a campus. One current year per campus
  (database-enforced). Planned → active → closed; a closed year is read-only and can only be
  reopened by school-wide staff. Planned years without sections can be deleted.
- **Terms** inside a year, no overlaps; the year cannot be shortened past its terms.
- **Classes** (grade levels) per campus with code, stage, order and grading scale; archive /
  restore.
- **Sections** per academic year and class: capacity, room and class teacher (active staff
  only). The database guarantees a section's year and class are on the same campus.
- **Subjects** (school-wide, scholastic / co-scholastic) and **class subject lists** with
  optional subjects.
- **Grading scales** with bands (label, % range, grade point, remark); overlapping or duplicate
  bands are rejected; a scale used by a class cannot be deleted.
- **Calendar**: holidays, vacations, exams and events, per campus or for all campuses.
  **Working-day calculation** per day (weekly off, Saturday off, holiday, outside year) — this
  is what attendance will use in Phase 5.
- **Starter structure** in one click: Nursery–Class 12, 11 common subjects, board grading scales
  (CBSE 8-band or RBSE divisions, plus a primary scale), subject lists per stage. Safe to run
  twice. See `docs/research/academic-templates.md` for sources and open questions.
- **Permissions**: `academic.view`, `academic.manage`, `calendar.manage`, added to the built-in
  roles (teachers, accountants, admission and front-office staff can view). `/tenant` now returns
  campus scopes so the screens hide buttons a campus-scoped user cannot use.
- **Screens**: Academics section with Academic years (+ terms), Classes & sections (+ subjects,
  starter setup), Subjects, Calendar (month grid with working-day count), Grading.

## Security

- All 9 new tables: `tenant_id`, RLS forced, composite foreign keys, RLS checker passes.
- Ownership columns (`tenant_id`, `campus_id`, parent ids) cannot be updated by the app role
  (column-level grants); tested at database level.
- Every record of another school, or of a campus outside the caller's scope, answers 404 —
  23 cross-school checks in the e2e suite, including creating records on another school's campus.
- Concurrent year/term date checks are serialised per campus with an advisory lock.
- Foreign-key names are explicit (Postgres truncates names over 63 characters, which had
  affected several auto-generated names).

## Fixes found along the way

- Section names in Hindi failed validation (Devanagari vowel signs are combining marks) — fixed.
- Campus edits did not update `updated_at` — fixed.
- An older Phase 2 test assumed a role without `academic.view` could hand out the teacher role;
  the no-escalation rule now correctly blocks that, and the test covers both cases.

## Tests

136 automated tests pass (validation 16, shared 11, database 40, API 69), plus lint, type
checks, production build and the RLS checker.

## Database changes

Migrations `0004_academic_structure` and `0005_academic_security` (plus `0003` from the
Phase 2 speed fix). Apply with `pnpm db:migrate`.

## Not done yet / next

- 3b: CMS pages, public school page, inquiry form (feeds Phase 4 admissions).
- Custom fields (CFG-06) — planned with student profiles in Phase 4.
- Promotion of sections into the next year — Phase 4 (needs students).
- Grading templates need confirmation from pilot schools (questions listed in the research note).
