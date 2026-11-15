# Phase 10 — The school day: timetable, substitutions, homework, notices, parent leave

## Office

- **Academics → Timetable.** Set the **bell** once (starts from a usual 8-period day with short
  break and lunch; edit times, add/remove periods, mark breaks). Then pick a class and click a cell
  to choose the subject; the teacher fills in from *Who teaches what* and can be changed. A teacher
  cannot be put in two classes in the same period ("Sushma Rao already teaches Class 5 A in Period 1
  on Mon"). Breaks and subjects not taught in the class are refused.
- **Academics → Substitutions.** Morning job: pick the date and the absent teacher; each of their
  periods lists only teachers free at that time (including staff who have not logged in yet).
  Choosing one records the cover; busy teachers are refused.
- **Notices.** Write a circular for parents and staff, parents only, or staff only; optionally only
  some classes or sections; pin it; hide after a date. Save as draft or send now; take down later.
  The list shows how many people read each notice.
- Today page: **Teacher absent?** and **Send a notice** buttons for those who can.

## Teacher

- Today page: **My periods today** in order, the current one highlighted; cover periods marked
  "Cover for …"; their own periods show who is covering if they are away. Staff notices below.
- My classes → a class: **Give homework** (subject limited to what they teach there; class teachers
  and office can choose any class subject), optional due date and a photo of the board or a PDF.
  Only the teacher who gave it (or academic manager) can remove it.

## Parent (app)

- Home: **From the school** notices for their children's classes (staff-only notices never show).
  Opening one marks it read.
- Child page tabs: **Homework** (first), Attendance, Fees.
- Attendance tab: **Ask for leave** (from/to, reason). It goes to the class teacher in
  Attendance → Leave; the parent sees Waiting / Approved / Not approved and can withdraw while
  waiting.
- The absent alert to parents already goes out when attendance is saved (Phase 5,
  `attendance.absent` outbox event); WhatsApp/SMS delivery comes with the messaging phase.

## Security

- Six new tables (`period_slots`, `timetable_entries`, `substitutions`, `homework`, `notices`,
  `notice_reads`) with FORCE RLS and column grants; homework and notice status can only move forward.
- New permissions `timetable.manage` (owner, school admin, principal) and `notices.manage` (also
  receptionist).
- Parent feeds are filtered on the server by the parent's own children; homework sent to parents
  hides who created it internally.

## Tests

`apps/api/test/phase10.e2e.test.ts` (9): bell save/overlap/permission/rename keeps ids; timetable
default teacher, clash 409, break and subject checks; teacher's periods; substitution with free
list, busy 409, wrong day; homework permissions, photo, parent view, remove rules; notice audience
and class filters, read counts, archive, tenant isolation; parent leave request, overlap 409, class
teacher approval, withdraw rules. Full suite: 235 API + 47 DB + 47 validation + 11 shared + 8 worker.
Browser smoke (Chrome): bell → grid, substitution, notices, teacher Today, homework with photo,
parent home/homework/leave on a phone-size screen, class teacher sees the request.

## Migrations

`0030_classroom`, `0031_classroom_security`.
