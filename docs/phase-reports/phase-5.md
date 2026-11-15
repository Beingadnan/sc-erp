# Phase 5 Report — Attendance

Date: 2026-11-11 · Status: built and tested in the workspace; awaiting live check on Neon

## What was implemented (ATT-01 … ATT-06)

- **Taking attendance** (Attendance → Take attendance): a phone-friendly register for a
  section and date. Every student defaults to Present (or Leave when leave is approved); one
  tap sets Present / Absent / Late / Half day / Leave, with an optional note. "All present"
  for the usual day. Daily registers by default; a campus can switch to period registers.
- **Rules**: class teachers mark only their own sections; holidays, weekly offs, future dates
  and dates outside the year are refused; every enrolled student must be marked.
- **Cut-off and corrections**: the register can be changed freely for 12 hours (campus
  setting) after it is first taken. After that only staff with "correct attendance" can change
  it, a reason is required, and each changed student is kept in an append-only history shown
  under the register. A register never taken closes 12 hours after its day; correctors can
  still fill it in late.
- **Leave**: recorded from a parent's note, call or the (future) parent app; the class teacher
  approves or rejects (with a reason). Approval marks those days as Leave, including days
  already taken as absent; cancelling approved leave turns them back to absent — both with
  history. Overlapping leave is refused.
- **Reports**: today's overview per campus (registers taken, present/absent/leave counts),
  monthly register grid with percentages, attendance card on the student page, and a
  low-attendance list (threshold from settings or chosen; CSV download).
- **Percentages**: present and late count 1, half day 0.5; leave is left out or counts as
  absent per campus setting (CBSE schools usually track the 75 % rule).
- **Absence events**: `attendance.absent` is written to the outbox for each newly absent
  student (daily register or first period), ready for SMS/WhatsApp in the communication phase.
- **Settings** (Attendance → Settings): daily or period registers, periods per day, cut-off
  hours, low-attendance threshold, how leave counts.

## Database

Migrations `0014_attendance` and `0015_attendance_security`: `attendance_settings`,
`attendance_sessions`, `student_attendance`, `attendance_corrections`, `leave_requests` — all
with forced row-level security. The app role cannot delete attendance, can change only the
status and note of a record, cannot change or delete corrections, and records always belong to
the same student as their enrollment (composite foreign key).

## Performance

Saving a register is six to eight statements regardless of class size (one insert for new
rows, one update for changed rows, one for corrections, one for events). A 45-student register
saves in about 40 ms locally; the test fails above one second.

## Tests

- `phase5.e2e.test.ts` (15 tests): settings, defaults, 45-student save under 1 s with events,
  incomplete/future/holiday refusals, own-section rule, receptionist read-only, period mode,
  cut-off and corrections with history, late registers, database privileges, leave approve /
  reject / cancel with register changes, overlap, monthly grid, student summary, low list,
  today overview, and isolation between schools (all 404).
- Full suite: validation 32, shared 11, db 47, API 138 — all passing; lint, typecheck and web
  build clean. Screens checked in a headless browser (phone and desktop widths).

## Changes to earlier behaviour

- The teacher role now includes `attendance.mark`, so inviting teachers needs a role holding
  it (or `attendance.correct`, which covers it).

## Not in this phase

- Parent/student views of attendance and SMS/WhatsApp sending (communication phase).
- Subject-teacher period marking (with timetables); today only the class teacher or correctors
  mark period registers.
- Staff attendance (HR phase).
