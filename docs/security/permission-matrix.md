# Permission Matrix

Status: Phase 1 design; seeded in Phase 2. Schools can create custom roles from these
permissions. Scope column: **T** = whole tenant, **C** = assigned campuses, **A** = assigned
classes/sections, **L** = linked children, **S** = self only.

Legend: ✓ granted · – not granted.

Phase 3a note: `academic_structure.manage` from the Phase 1 design shipped as
`academic.manage` (plus `academic.view` and `calendar.manage`). Subjects, grading scales and
the starter template are school-wide records, so changing them needs `academic.manage` for
**all** campuses; campus-scoped holders manage years, classes, sections and calendar entries of
their own campuses only.

Phase 3b: `cms.manage` (owner, school admin, principal; school-wide only, since the website is
shared) and `admissions.view` / `admissions.manage` as in the rows below. In 3b
`admissions.manage` covers inquiries only; Phase 4 extends it to applications.

Phase 4a shipped: `students.view` (campus scope), `students.view_assigned` (teachers: students
of sections where they are class teacher — subject-teacher assignment comes with timetables),
`students.manage` (create + update; there is no delete), `students.sensitive.view` (full
Aadhaar, audited). For granting, `students.view` covers `students.view_assigned`.

Phase 4c added `students.promote` (owner, school admin, principal, academic coordinator),
`students.withdraw` (owner, school admin, principal — includes issuing/cancelling TCs),
`students.export` (owner, school admin, principal) and `students.import` (owner, school
admin). Custom field definitions need `settings.manage` for all campuses.

Phase 5 shipped attendance: `attendance.view` (campus registers, reports and leave lists —
owner, school admin, principal, vice principal, academic coordinator, receptionist),
`attendance.mark` (teachers: registers and leave of sections where they are class teacher;
\* teachers see their own sections through this right) and `attendance.correct` (any section of
the campus, changes after the cut-off with a reason, late registers, campus attendance
settings — owner, school admin, principal, vice principal). For granting, `attendance.correct`
covers `attendance.mark`. Parent/student views (✓L/✓S) arrive with the portals.

Phase 6a seeded the fee permissions: `fees.view` (owner, school admin, principal,
accountant), `fees.configure` (owner, school admin, accountant), `fees.collect` (school admin,
accountant), `fees.concession.approve` (owner, school admin, principal), `fees.refund` (owner,
accountant) and `fees.cancel_receipt` (owner, school admin). Fee heads and concession types
are shared by all campuses, so changing them needs `fees.configure` school-wide. For granting,
`fees.configure` covers `fees.collect` and `fees.cancel_receipt` covers `fees.refund`, so owners
and school admins can invite accountants. Admission-officer and receptionist collection
(✓C limited) come with the counter in Phase 6b.

| Permission                                | Owner | School Admin | Principal | Vice Principal | Acad. Coord. | Accountant   | Admission Officer  | HR Manager | Teacher | Librarian  | Transport Mgr | Receptionist    | Parent      | Student         |
| ----------------------------------------- | ----- | ------------ | --------- | -------------- | ------------ | ------------ | ------------------ | ---------- | ------- | ---------- | ------------- | --------------- | ----------- | --------------- |
| settings.manage                           | ✓T    | ✓C           | –         | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| roles.manage                              | ✓T    | ✓C           | –         | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| audit.view                                | ✓T    | ✓C           | ✓C        | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| academic.view                             | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | ✓C           | ✓C                 | –          | ✓C      | –          | –             | ✓C              | –           | –               |
| academic.manage                           | ✓T    | ✓C           | ✓C        | –              | ✓C           | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| calendar.manage                           | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| admissions.view                           | ✓T    | ✓C           | ✓C        | ✓C             | –            | ✓C           | ✓C                 | –          | –       | –          | –             | ✓C              | –           | –               |
| admissions.manage                         | ✓T    | ✓C           | ✓C        | –              | –            | –            | ✓C                 | –          | –       | –          | –             | ✓C (inquiries)  | –           | –               |
| students.view                             | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | ✓C           | ✓C                 | –          | ✓A      | ✓C (basic) | ✓C (basic)    | ✓C (basic)      | ✓L          | ✓S              |
| students.create / update                  | ✓T    | ✓C           | ✓C        | –              | –            | –            | ✓C                 | –          | –       | –          | –             | –               | –           | –               |
| students.delete (archive)                 | ✓T    | ✓C           | –         | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| students.export                           | ✓T    | ✓C           | ✓C        | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| students.sensitive.view (Aadhaar, health) | ✓T    | ✓C           | ✓C        | –              | –            | –            | –                  | –          | –       | –          | –             | –               | ✓L          | –               |
| attendance.view                           | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | –            | –                  | –          | ✓A*     | –          | –             | ✓C              | ✓L          | ✓S              |
| attendance.mark                           | –     | ✓C           | –         | –              | –            | –            | –                  | –          | ✓A      | –          | –             | –               | –           | –               |
| attendance.correct                        | ✓T    | ✓C           | ✓C        | ✓C             | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| fees.view                                 | ✓T    | ✓C           | ✓C        | –              | –            | ✓C           | ✓C (admission fee) | –          | –       | –          | –             | –               | ✓L          | ✓S (if enabled) |
| fees.configure                            | ✓T    | ✓C           | –         | –              | –            | ✓C           | –                  | –          | –       | –          | –             | –               | –           | –               |
| fees.collect                              | –     | ✓C           | –         | –              | –            | ✓C           | ✓C (admission fee) | –          | –       | –          | –             | ✓C (if enabled) | ✓L (online) | –               |
| fees.concession.approve                   | ✓T    | ✓C           | ✓C        | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| fees.refund                               | ✓T    | –            | –         | –              | –            | ✓C (request) | –                  | –          | –       | –          | –             | –               | –           | –               |
| fees.cancel_receipt                       | ✓T    | ✓C           | –         | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| exams.manage                              | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| marks.enter                               | –     | –            | –         | –              | –            | –            | –                  | –          | ✓A      | –          | –             | –               | –           | –               |
| results.publish                           | ✓T    | ✓C           | ✓C        | –              | –            | –            | –                  | –          | –       | –          | –             | –               | –           | –               |
| results.view                              | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | –            | –                  | –          | ✓A      | –          | –             | –               | ✓L          | ✓S              |
| staff.view                                | ✓T    | ✓C           | ✓C        | ✓C             | –            | –            | –                  | ✓C         | –       | –          | –             | ✓C (directory)  | –           | –               |
| staff.manage                              | ✓T    | ✓C           | –         | –              | –            | –            | –                  | ✓C         | –       | –          | –             | –               | –           | –               |
| staff.salary.view                         | ✓T    | –            | –         | –              | –            | ✓C           | –                  | ✓C         | –       | –          | –             | –               | –           | –               |
| homework.manage                           | –     | –            | –         | –              | ✓C           | –            | –                  | –          | ✓A      | –          | –             | –               | –           | –               |
| announcements.send                        | ✓T    | ✓C           | ✓C        | ✓C             | ✓C           | –            | –                  | –          | ✓A      | –          | –             | –               | –           | –               |
| library.manage                            | –     | ✓C           | –         | –              | –            | –            | –                  | –          | –       | ✓C         | –             | –               | –           | –               |
| transport.manage                          | –     | ✓C           | –         | –              | –            | –            | –                  | –          | –       | –          | ✓C            | –               | –           | –               |
| reports.export                            | ✓T    | ✓C           | ✓C        | –              | –            | ✓C (finance) | –                  | ✓C (staff) | –       | –          | –             | –               | –           | –               |

Notes:

- "Owner" lacks day-to-day operational permissions like `attendance.mark` by default to keep
  audit trails meaningful; owners can grant themselves any role.
- Accountants never receive `marks.enter` or `results.publish` (separation of duties).
- Refunds above a tenant-configured threshold need a second approver (Phase 6).
- Platform roles (Super Admin, Support, Operations) are not tenant roles; see
  `docs/architecture/multi-tenancy.md` §7.

**Phase 6c notes.** Changing the school's bank / UPI details needs `settings.manage` (privileged, so MFA when enforced) and is always audited, because a changed account number could divert parents' money. Approving a parent's payment proof needs `fees.collect`. A refund is asked for with `fees.refund` and paid with `fees.cancel_receipt` by a different person (maker-checker, enforced by the API).

**Phase 7a notes.** New permissions: `family.portal` (Parent role only; data limited to children whose guardian record is linked to the signed-in account) and `portal.manage` (owner, school admin, principal, admission officer, receptionist, accountant) to give, reset or remove parent access. Parents never appear in Staff & access.
