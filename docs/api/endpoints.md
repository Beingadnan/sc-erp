# API Endpoints

Base path `/api/v1`. Interactive docs at `/api/docs` (non-production). Conventions:
`docs/api/conventions.md`. Every state-changing request needs the `X-CSRF-Token` header (the
web app sends it automatically).

## Authentication — `/auth`

| Method | Path                                 | Access              | Notes                                                   |
| ------ | ------------------------------------ | ------------------- | ------------------------------------------------------- |
| POST   | /auth/register-school                | public              | Creates owner account + school + first campus; signs in |
| POST   | /auth/login                          | public              | `{status: 'ok' \| 'mfa_required'}`                      |
| POST   | /auth/mfa/verify                     | MFA-pending session | `{code}` or `{recoveryCode}`; issues a fresh session    |
| POST   | /auth/logout                         | session             |                                                         |
| GET    | /auth/me                             | session             | User, schools, active school, platform role             |
| POST   | /auth/switch-tenant                  | session             | Only schools with an active membership                  |
| POST   | /auth/password/forgot                | public              | Always 202                                              |
| POST   | /auth/password/reset                 | public              | Revokes all sessions                                    |
| POST   | /auth/password/change                | session             | Revokes other sessions                                  |
| POST   | /auth/email/verify                   | public              |                                                         |
| POST   | /auth/email/resend                   | session             |                                                         |
| POST   | /auth/invite/accept                  | public              | Sets first password, activates membership               |
| POST   | /auth/mfa/setup · /enable · /disable | session             | TOTP; 10 recovery codes on enable                       |
| GET    | /auth/sessions                       | session             | Own sessions                                            |
| DELETE | /auth/sessions/:id                   | session             | Own sessions only                                       |

## School — tenant routes (active school + active membership)

| Method | Path                                                                       | Permission                                      |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------- |
| GET    | /tenant                                                                    | any member                                      |
| PATCH  | /tenant                                                                    | settings.manage (school-wide)                   |
| GET    | /campuses                                                                  | any member (campuses in their scope)            |
| POST   | /campuses                                                                  | settings.manage (school-wide)                   |
| PATCH  | /campuses/:id                                                              | settings.manage for that campus                 |
| GET    | /permissions                                                               | roles.manage                                    |
| GET    | /roles                                                                     | members.view                                    |
| POST   | /roles · PATCH /roles/:id · PUT /roles/:id/permissions · DELETE /roles/:id | roles.manage (school-wide; custom roles only)   |
| GET    | /members                                                                   | members.view                                    |
| POST   | /members/invite                                                            | members.manage                                  |
| PUT    | /members/:id/roles                                                         | members.manage                                  |
| PATCH  | /members/:id                                                               | members.manage (school-wide) — suspend/restore  |
| GET    | /audit-logs                                                                | audit.view — `?limit&cursor&entity&actorUserId` |

## Academics — Phase 3a (tenant routes)

All campus-bound reads return 404 for campuses outside the caller's school or scope.

| Method & path                                                   | Permission                     | Notes                                                                |
| --------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `GET /academic-years?campusId=`                                 | academic.view                  | Ordered by start date                                                |
| `POST /academic-years`                                          | academic.manage (campus)       | No overlapping years per campus                                      |
| `PATCH /academic-years/:id`                                     | academic.manage                | Terms must stay inside the year; closed years are read-only          |
| `POST /academic-years/:id/make-current`                         | academic.manage                | One current year per campus; sets status active                      |
| `POST /academic-years/:id/status`                               | academic.manage                | `closed` locks the year; reopening needs school-wide rights          |
| `DELETE /academic-years/:id`                                    | academic.manage                | Only planned years without sections                                  |
| `GET/POST /academic-years/:id/terms`, `PATCH/DELETE /terms/:id` | view / manage                  | Inside the year, no overlap                                          |
| `GET /classes?campusId=`, `POST /classes`, `PATCH /classes/:id` | view / manage                  | Archive via `status`                                                 |
| `GET/PUT /classes/:id/subjects`                                 | view / manage                  | PUT replaces the list (order kept)                                   |
| `GET /sections?academicYearId=&gradeLevelId=`                   | academic.view                  | Includes class teacher name                                          |
| `POST /sections`, `PATCH/DELETE /sections/:id`                  | academic.manage                | Year and class must share a campus (DB-enforced)                     |
| `GET /subjects`, `POST /subjects`, `PATCH /subjects/:id`        | view / manage (all campuses)   |                                                                      |
| `GET/POST /grading-scales`, `PATCH/DELETE /grading-scales/:id`  | view / manage (all campuses)   | Bands may not overlap; scales in use cannot be deleted               |
| `GET /calendar?campusId=&from=&to=`                             | academic.view                  | Includes all-campus entries; max 400 days                            |
| `GET /calendar/working-days?campusId=&from=&to=`                | academic.view                  | Per-day working / weekly_off / saturday_off / holiday / outside_year |
| `POST /calendar`, `PATCH/DELETE /calendar/:id`                  | calendar.manage                | `campusId: null` (all campuses) needs school-wide rights             |
| `POST /academic/setup-template`                                 | academic.manage (all campuses) | Idempotent starter classes, subjects, scales                         |

`GET /tenant` now also returns `permissionScopes` (permission → campus ids, or `null` for all).

## Website and inquiries — Phase 3b

| Method & path                                                                                     | Permission                | Notes                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `GET /website/pages`, `POST /website/pages`                                                       | cms.manage (all campuses) | List shows latest / published version and unpublished changes          |
| `POST /website/pages/starter`                                                                     | cms.manage                | Home, About, Admissions, Contact as drafts; idempotent                 |
| `GET /website/pages/:id`, `PATCH /website/pages/:id`                                              | cms.manage                | Saving title + body adds a version; slug / menu fields change the page |
| `GET /website/pages/:id/versions/:n`, `POST …/versions/:n/restore`                                | cms.manage                | Restore copies an old version into a new one                           |
| `POST /website/pages/:id/publish` (`{version?}`), `POST …/unpublish`, `DELETE /website/pages/:id` | cms.manage                |                                                                        |
| `GET /inquiries?status=&campusId=&limit=&cursor=`                                                 | admissions.view           | Campus-scoped staff see their campuses only                            |
| `POST /inquiries`                                                                                 | admissions.manage         | Walk-in / phone / referral; consent required                           |
| `PATCH /inquiries/:id` (`{status}`)                                                               | admissions.manage         | new → contacted → closed; nothing else is editable                     |

### Public (no sign-in)

| Method & path                             | Notes                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public/schools/:school`             | Name, active campuses, published pages in the menu; 404 for unknown / suspended schools                                                |
| `GET /public/schools/:school/pages/:page` | Published version only                                                                                                                 |
| `POST /public/schools/:school/inquiries`  | Always `202 {received:true}`; consent required; honeypot `website`; 5 per IP per 10 min, 3 per phone per hour, 200 per school per hour |

## Students — Phase 4a

"View" = `students.view` (campus) or `students.view_assigned` (class teacher: own sections only).

| Method & path                                                                                | Permission                                  | Notes                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /students?q=&campusId=&academicYearId=&gradeLevelId=&sectionId=&status=&limit=&cursor=` | view                                        | With `sectionId`: full class list in roll order; `q` matches name, admission no., parent's mobile        |
| `POST /students`                                                                             | students.manage (campus)                    | Admission: student + guardians (new or existing) + enrollment + privacy acknowledgement, one transaction |
| `GET /students/:id`                                                                          | view                                        | Aadhaar masked; includes guardians, enrollments, acknowledgements                                        |
| `PATCH /students/:id`                                                                        | students.manage                             | `aadhaar: null` removes it                                                                               |
| `POST /students/:id/aadhaar/reveal`                                                          | students.sensitive.view                     | Audited (`student.aadhaar_viewed`)                                                                       |
| `POST /students/:id/guardians`, `PATCH/DELETE /students/:id/guardians/:gid`                  | students.manage                             | One main contact; ≥1 guardian; ≤4                                                                        |
| `POST /students/:id/guardians/:gid/privacy-acknowledgements`                                 | students.manage                             | Append-only                                                                                              |
| `GET /guardians?phone=`                                                                      | students.manage                             | Sibling lookup                                                                                           |
| `PATCH /guardians/:id`                                                                       | students.manage (for one of their children) |                                                                                                          |
| `PATCH /enrollments/:id`                                                                     | students.manage                             | Section move (same campus & year, capacity) or roll number                                               |
| `POST /sections/:id/renumber`                                                                | students.manage                             | Roll numbers 1…n by name or admission number                                                             |
| `GET /settings/admission-numbers?sectionId=`                                                 | students.manage                             | Pattern + next number preview                                                                            |
| `PUT /settings/admission-numbers`                                                            | settings.manage (all campuses)              | Pattern rules prevent repeats                                                                            |

## Applications and documents — Phase 4b

| Method & path                                                            | Permission                                            | Notes                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /applications?campusId=&academicYearId=&gradeLevelId=&status=&q=`   | admissions.view                                       | Newest first, cursor paging                                                                         |
| `GET /applications/summary?campusId=&academicYearId=`                    | admissions.view                                       | By status, source and class                                                                         |
| `POST /applications`                                                     | admissions.manage                                     | Number `APP/<year>/<seq>`; from an inquiry with `inquiryId`                                         |
| `GET /applications/:id`                                                  | admissions.view                                       | With history and allowed next statuses                                                              |
| `PATCH /applications/:id`                                                | admissions.manage                                     | Not when withdrawn / admitted                                                                       |
| `POST /applications/:id/status`                                          | admissions.manage                                     | Allowed moves only; reason needed to reject, withdraw or waitlist                                   |
| `POST /applications/:id/admit`                                           | admissions.manage + students.manage                   | Approved only; creates student, enrollment, guardian; documents move to the student; inquiry closed |
| `GET /applications/:id/documents`, `GET /students/:id/documents`         | view                                                  | Restricted types flagged                                                                            |
| `POST /documents` (multipart: file, docType, studentId or applicationId) | manage                                                | ≤ 5 MB; PDF/JPG/PNG/WebP by content                                                                 |
| `POST /documents/:id/link`                                               | view (+ students.sensitive.view for restricted types) | 5-minute link; logged                                                                               |
| `DELETE /documents/:id`                                                  | manage                                                | File deleted, record kept                                                                           |

## Student records lifecycle — Phase 4c

| Method & path                                                        | Permission                     | Notes                                                                              |
| -------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `GET /promotions/preview?fromSectionId=&toAcademicYearId=`           | students.promote               | Students + next year's sections (suggested next class)                             |
| `POST /promotions`                                                   | students.promote               | Per student: promote / retain / complete (alumni) / skip; atomic; capacity checked |
| `POST /students/:id/withdraw`                                        | students.withdraw              | Ends enrollment; optional TC in the same step                                      |
| `POST /students/:id/transfer-certificates`                           | students.withdraw              | For withdrawn or alumni students; one issued TC at a time                          |
| `GET /students/:id/transfer-certificates`                            | students.view                  |                                                                                    |
| `POST /transfer-certificates/:id/cancel`                             | students.withdraw              | Reason required; number never reused                                               |
| `GET /transfer-certificates/:id/pdf`                                 | students.view                  | Printed from the issue-time snapshot; logged                                       |
| `GET /students/export?…filters`                                      | students.export                | CSV (UTF-8 with BOM), Aadhaar masked, formulas neutralised; logged                 |
| `GET /students/import/template`                                      | students.import                | Template with the school's custom fields                                           |
| `POST /imports/students` (multipart: file, campusId, academicYearId) | students.import                | CSV or XLSX ≤ 2 MB / 2,000 rows → preview with row problems                        |
| `GET /imports`, `GET /imports/:id`                                   | students.import                | Progress and per-row report                                                        |
| `POST /imports/:id/confirm` (`{privacyNoticeGiven:true}`)            | students.import                | Runs in the background; resumable                                                  |
| `POST /imports/:id/cancel`                                           | students.import                |                                                                                    |
| `GET /custom-fields`                                                 | any member                     | Definitions for forms                                                              |
| `POST /custom-fields`, `PATCH /custom-fields/:id`                    | settings.manage (all campuses) | Archive instead of delete                                                          |

Student and guardian create/update bodies accept `customFields: { key: value }`.

## Attendance (Phase 5)

"Any attendance right" = `attendance.view`, `attendance.mark` or `attendance.correct`. Teachers
with only `attendance.mark` see and change only sections where they are class teacher; other
sections are 404.

| Method & path                                                         | Permission                                 | Notes                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /attendance/settings?campusId=`                                  | any attendance right                       | Defaults: daily, 12 h cut-off, 75 %, leave not counted                                                                                                                                                                                                    |
| `PUT /attendance/settings?campusId=`                                  | attendance.correct                         | `{mode, periodsPerDay, cutoffHours, lowThreshold, leaveCountsAs}`                                                                                                                                                                                         |
| `GET /attendance/today?campusId=&date=`                               | any attendance right                       | Sections with register status and counts; totals; day type                                                                                                                                                                                                |
| `GET /attendance/sections/:id/register?date=&period=`                 | any attendance right                       | Roster with saved or default status (approved leave → leave), `canEdit`, `locked`, `needsReason`                                                                                                                                                          |
| `PUT /attendance/sections/:id/register?date=&period=`                 | attendance.mark (own) / attendance.correct | `{records:[{enrollmentId,status,remark}], reason?}` — every enrolled student; refused on holidays, offs, future dates; after the cut-off only `attendance.correct`, with a reason for status changes (recorded as corrections); emits `attendance.absent` |
| `GET /attendance/sections/:id/history?date=&period=`                  | any attendance right                       | Corrections of one register                                                                                                                                                                                                                               |
| `GET /attendance/sections/:id/month?month=YYYY-MM&period=`            | any attendance right                       | Day grid per student, month percentages                                                                                                                                                                                                                   |
| `GET /attendance/students/:id?academicYearId=`                        | any attendance right                       | Totals, percentage, months, recent absences, leave                                                                                                                                                                                                        |
| `GET /attendance/low?campusId=&academicYearId=&threshold=&sectionId=` | any attendance right                       | Students below the threshold (campus setting by default)                                                                                                                                                                                                  |
| `GET /attendance/leave?campusId=&status=&sectionId=`                  | any attendance right                       | With `canDecide` per row                                                                                                                                                                                                                                  |
| `POST /attendance/leave`                                              | attendance.mark (own) / attendance.correct | `{studentId, fromDate, toDate, reason, requestedVia}`; ≤ 61 days; no overlaps                                                                                                                                                                             |
| `POST /attendance/leave/:id/decision`                                 | attendance.mark (own) / attendance.correct | `{status: approved\|rejected\|cancelled, note}`; approval turns marked absences into leave, cancelling turns them back to absent (both recorded as corrections)                                                                                           |

Statuses: present, absent, late (counts present). Only these three are accepted. A student on
approved leave is marked absent with the note "On leave" (migration 0034 converted old half_day to
present and old leave to absent). Period 0 = daily register; in period mode periods 1…n.

## Fees — setup, concessions, demands (Phase 6a)

Money is whole **paise** (integers) in every request and response. "Any fee right" =
`fees.view`, `fees.configure`, `fees.collect` or `fees.concession.approve`, narrowed to campuses;
other schools' and out-of-scope campuses are 404.

| Method & path                                                                    | Permission                                | Notes                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /fees/heads`                                                                | any fee right                             | Includes the built-in late fee head                                                                                                                |
| `POST /fees/heads`, `PATCH /fees/heads/:id`                                      | fees.configure (all campuses)             | Each head gets its own income account (deposits: a liability); no delete, switch off                                                               |
| `GET /fees/structures?campusId=&academicYearId=`                                 | any fee right                             | With totals, classes, assigned students, demands raised                                                                                            |
| `POST /fees/structures`                                                          | fees.configure                            | `{campusId, academicYearId, name, kind: class\|optional, gradeLevelIds, lateFee}`                                                                  |
| `GET /fees/structures/:id`                                                       | any fee right                             | Installments with amounts per head                                                                                                                 |
| `PATCH /fees/structures/:id`                                                     | fees.configure                            | Name, classes, late fee rule                                                                                                                       |
| `PUT /fees/structures/:id/plan`                                                  | fees.configure                            | Whole installment plan; drafts only                                                                                                                |
| `POST /fees/structures/:id/status`                                               | fees.configure                            | draft / published / archived; back to draft only without demands                                                                                   |
| `DELETE /fees/structures/:id`                                                    | fees.configure                            | Unused drafts only                                                                                                                                 |
| `GET/POST /fees/structures/:id/students`, `DELETE …/students/:assignmentId`      | any / fees.configure                      | Optional fees only                                                                                                                                 |
| `GET /fees/concession-types`; `POST`, `PATCH /fees/concession-types/:id`         | any / fees.configure (all campuses)       | percent or fixed per installment; limited to fee heads                                                                                             |
| `POST /fees/demands/generate`                                                    | fees.configure                            | `{structureId, installmentIds?, studentIds?}`; idempotent; applies approved concessions; skips students who joined after the due date unless named |
| `POST /fees/demands/late-fees`                                                   | fees.configure                            | `{campusId, asOf?}`; adds what is owed by the rule; safe to repeat                                                                                 |
| `GET /fees/demands?campusId=&…&status=due\|overdue\|settled\|cancelled&q=&page=` | any fee right                             | 50 per page with totals                                                                                                                            |
| `GET /fees/structures/:id/demands`                                               | any fee right                             | Per installment: raised / eligible, billed, reduced, outstanding                                                                                   |
| `POST /fees/demands/:id/cancel`                                                  | fees.configure                            | Reason required; reverses everything it posted                                                                                                     |
| `POST /fees/demands/:id/waivers`                                                 | configure, collect or approve             | `{lineId, amount, reason}`; pending unless the requester can approve                                                                               |
| `POST /fees/waivers/:id/decision`                                                | fees.concession.approve                   | approved / rejected (note required)                                                                                                                |
| `GET /fees/concessions?campusId=&status=`                                        | any fee right                             | With `canDecide`                                                                                                                                   |
| `POST /fees/concessions`                                                         | fees.configure or fees.concession.approve | `{studentId, academicYearId, concessionTypeId, value?, reason}`; approvers' requests are approved at once                                          |
| `POST /fees/concessions/:id/decision`                                            | fees.concession.approve                   | Approval reduces demands already raised                                                                                                            |
| `POST /fees/concessions/:id/revoke`                                              | fees.concession.approve                   | Puts back what it took off, by reversal                                                                                                            |
| `GET /fees/students/:studentId?academicYearId=`                                  | any fee right                             | Demands with lines and adjustments, concessions, optional fees, statement                                                                          |
| `GET /fees/accounts?campusId=`                                                   | any fee right                             | Trial balance                                                                                                                                      |

## Fees — collection, receipts, day closing, reports (Phase 6b)

| Method & path                                                              | Permission          | Notes                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /fees/payments`                                                      | fees.collect        | `{studentId, mode: cash\|cheque\|dd\|upi\|card\|bank_transfer, amount, receivedOn?, reference, bankName, instrumentDate, payerName, note, allocations?, idempotencyKey}`. Oldest dues first unless `allocations` given; surplus kept as advance; cheques/DDs are `pending`; up to 30 days back; refused on a closed day. Same `idempotencyKey` returns the first receipt (`repeated: true`) |
| `GET /fees/payments?campusId=&from=&to=&mode=&status=&cashierId=&q=&page=` | any fee right       | Defaults to today; totals by mode for live receipts                                                                                                                                                                                                                                                                                                                                         |
| `GET /fees/payments/:id`                                                   | any fee right       | Lines settled, advance, what the caller can do                                                                                                                                                                                                                                                                                                                                              |
| `GET /fees/payments/:id/receipt.pdf`                                       | any fee right       | Watermarked when cancelled or bounced                                                                                                                                                                                                                                                                                                                                                       |
| `POST /fees/payments/:id/clear`                                            | fees.collect        | `{clearedOn?}`; cheque/DD moves to the bank                                                                                                                                                                                                                                                                                                                                                 |
| `POST /fees/payments/:id/bounce`                                           | fees.collect        | `{reason, bouncedOn?}`; reverses the receipt, dues reopen, emits `fees.cheque_bounced`                                                                                                                                                                                                                                                                                                      |
| `POST /fees/payments/:id/cancel`                                           | fees.cancel_receipt | `{reason}`; number stays used; ledger reversed                                                                                                                                                                                                                                                                                                                                              |
| `POST /fees/students/:studentId/apply-advance`                             | fees.collect        | Uses advance for dues raised since                                                                                                                                                                                                                                                                                                                                                          |
| `GET /fees/day-close?campusId=&date=`                                      | fees.collect        | The caller's own day: totals by mode, cash expected, closing                                                                                                                                                                                                                                                                                                                                |
| `POST /fees/day-close`                                                     | fees.collect        | `{campusId, date, cashCounted, note}`; note required when cash differs                                                                                                                                                                                                                                                                                                                      |
| `GET /fees/day-closings?campusId=&from=&to=`                               | any fee right       | All cashiers, last 30 days by default                                                                                                                                                                                                                                                                                                                                                       |
| `GET /fees/reports/collection?campusId=&from=&to=&format=json\|csv\|xlsx`  | any fee right       | Receipts; by mode, cashier, fee head                                                                                                                                                                                                                                                                                                                                                        |
| `GET /fees/reports/outstanding?campusId=&academicYearId=&format=`          | any fee right       | By class and section: billed, concessions, paid, outstanding, overdue, students overdue                                                                                                                                                                                                                                                                                                     |
| `GET /fees/reports/concessions?campusId=&from=&to=&format=`                | any fee right       | Concessions and waivers decided in the period                                                                                                                                                                                                                                                                                                                                               |

`GET /fees/students/:studentId` now also returns `payments`, per-line `paid`, `totals.paid` and `totals.advance`.
Receipt numbers: `{CAMPUS CODE}/{financial year}/{5-digit sequence}`, gap-free per campus and year.

## Fees — pay to school account, proofs, refunds (Phase 6c)

| Method        | Path                                          | Permission                                        | Notes                                                                                                          |
| ------------- | --------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET           | /fees/payment-settings?campusId               | any fees permission or settings.manage            | School bank / UPI details and QR (signed link, 10 min)                                                         |
| PUT           | /fees/payment-settings                        | settings.manage (privileged, MFA)                 | Audited; account number masked in the audit diff                                                               |
| POST / DELETE | /fees/payment-settings/qr?campusId            | settings.manage                                   | Image only (PNG, JPG, WebP, ≤5 MB)                                                                             |
| POST          | /fees/payment-links                           | fees.collect                                      | Amount defaults to what is due today; returns the URL once (only its SHA-256 is stored) and a WhatsApp message |
| GET           | /fees/payment-links?campusId&studentId&status | any fees permission                               | `expired` is derived                                                                                           |
| POST          | /fees/payment-links/:id/cancel                | fees.collect                                      |                                                                                                                |
| GET           | /fees/payment-proofs?campusId&status&page     | any fees permission                               | Queue of parent uploads                                                                                        |
| GET           | /fees/payment-proofs/:id                      | any fees permission                               | Signed 5-minute link to the screenshot; viewing is audited                                                     |
| POST          | /fees/payment-proofs/:id/approve              | fees.collect                                      | Issues the receipt (mode upi/bank_transfer, reference = UTR); optional corrected amount                        |
| POST          | /fees/payment-proofs/:id/reject               | fees.collect                                      | Note is shown to the parent                                                                                    |
| GET           | /fees/students/:id/refundable                 | fees.refund                                       | Unused advance and paid refundable deposits                                                                    |
| POST          | /fees/refunds                                 | fees.refund                                       | Reserves the amount (FIFO across receipts or deposit lines)                                                    |
| GET           | /fees/refunds?campusId&status&studentId       | any fees permission or fees.refund                |                                                                                                                |
| POST          | /fees/refunds/:id/pay                         | fees.cancel_receipt, not the requester            | Numbers `RF/{campus}/{FY}/{00001}`, posts the ledger journal                                                   |
| POST          | /fees/refunds/:id/reject                      | fees.cancel_receipt                               |                                                                                                                |
| GET           | /public/pay/:token                            | public, rate-limited                              | Parent page data: student first name and class, amount, school account, UPI link, uploads                      |
| POST          | /public/pay/:token/proof                      | public, rate-limited (20/h per IP, 10/h per link) | multipart: file, amount, mode, reference (UTR), paidOn, payerName, payerPhone; duplicate UTR → 409             |
| GET           | /public/pay/:token/receipts/:proofId          | public                                            | Receipt PDF after approval                                                                                     |

## Parent portal — access and family view (Phase 7a)

| Method | Path                             | Permission                     | Notes                                                                                                                                                     |
| ------ | -------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /auth/login                      | public                         | Body has `email` **or** `phone` (10-digit Indian numbers are normalised to +91) plus `password`                                                           |
| GET    | /students/:id/portal-access      | portal.manage or students.view | Guardians with status none / invited / active                                                                                                             |
| POST   | /portal/invites                  | portal.manage                  | `{ guardianId, purpose: activate \| reset }`; returns the link once and a WhatsApp message. Reset only for parent-only accounts used by this school alone |
| POST   | /portal/guardians/:id/revoke     | portal.manage                  | Unlinks the guardian; drops the Parent role (and membership) when nothing else is left                                                                    |
| POST   | /portal/activate/peek            | public, rate-limited           | `{ token }` → school, guardian first name, masked mobile, whether the number already has an account                                                       |
| POST   | /portal/activate                 | public, rate-limited           | `{ token, password }`: new password (≥ 8 chars), or the existing account's password to add this school; signs in                                          |
| GET    | /family                          | family.portal                  | Linked children with class, today's attendance, fees due now and outstanding                                                                              |
| GET    | /family/children/:id/attendance  | family.portal                  | Year totals, months, day-by-day records, leave                                                                                                            |
| GET    | /family/children/:id/fees        | family.portal                  | Demands, receipts, uploaded payment proofs, whether online payment is on                                                                                  |
| POST   | /family/children/:id/pay         | family.portal                  | Creates a 3-day payment link for the parent (pay-to-school flow from Phase 6c)                                                                            |
| GET    | /family/receipts/:id/receipt.pdf | family.portal                  | Only receipts of linked children                                                                                                                          |

## Staff and teaching (Phase 8)

| Method | Path                                   | Permission                                                       | Notes                                                                                                                                                        |
| ------ | -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | /members/invite                        | members.manage                                                   | `email` **or** `phone`, `fullName`, `designation`, `assignments`; a mobile invite returns `link` for WhatsApp; a parent of the school gets staff roles added |
| PUT    | /members/:id/profile                   | members.manage                                                   | designation, employeeCode (unique), phone, joinedOn                                                                                                          |
| GET    | /teaching/grid?campusId&academicYearId | academic.view                                                    | Classes → sections, subjects, class teachers, assignments, teacher load                                                                                      |
| PUT    | /teaching/cell                         | academic.manage                                                  | `{ sectionId, subjectId, membershipIds }` replaces that cell; subject must be taught in the class                                                            |
| GET    | /teaching/mine                         | any staff                                                        | Class-teacher and subject sections this year, with today's attendance status                                                                                 |
| GET    | /teaching/sections/:id/students        | class teacher, subject teacher of that section, or students.view | Subject teachers: roll, name, admission no.; class teacher/office also parent phone                                                                          |

## Setup workbook and sign-in pages (Phase 9a)

| Method | Path                                   | Permission                                           | Notes                                                                                                 |
| ------ | -------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| POST   | /auth/login                            | public                                               | Optional `as: staff \| parent` (staff page / parent page); refuses the wrong kind of account with 403 |
| GET    | /setup-imports/template                | academic.manage                                      | The .xlsx template                                                                                    |
| POST   | /setup-imports?campusId&academicYearId | academic.manage (+ members.manage for a Staff sheet) | multipart `file`; returns summary, problems by sheet/row, plan                                        |
| GET    | /setup-imports?campusId                | academic.manage                                      | Last 20 imports                                                                                       |
| POST   | /setup-imports/:id/apply               | academic.manage                                      | One transaction; returns counts and staff WhatsApp links (shown once)                                 |
| POST   | /setup-imports/:id/undo                | academic.manage                                      | Removes what the import added; refused once students are in its sections                              |
| POST   | /setup-imports/:id/cancel              | academic.manage                                      | Drop a preview                                                                                        |

## Old fee balances (Phase 9b)

| Method | Path                         | Permission     | Notes                                                                                                                     |
| ------ | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | /opening-balances/template   | fees.configure | CSV: Admission no, Name, Previous dues, Advance                                                                           |
| POST   | /opening-balances?campusId   | fees.configure | multipart `file` (.csv/.xlsx); matches students by admission no. in the current year; returns rows and problems           |
| GET    | /opening-balances?campusId   | fees.configure | Past imports                                                                                                              |
| POST   | /opening-balances/:id/apply  | fees.configure | Dues → "Previous year dues" demand; advance → payment (mode `opening`, receipt `OB/…`), not counted as today's collection |
| POST   | /opening-balances/:id/undo   | fees.configure | Refused once any of those dues were paid or an advance was used                                                           |
| POST   | /opening-balances/:id/cancel | fees.configure | Drop a preview                                                                                                            |

## Timetable, homework, notices (Phase 10)

| Method | Path                                                | Permission                                        | Notes                                                                                                                                   |
| ------ | --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /timetable/slots?campusId                           | any member                                        | The bell                                                                                                                                |
| PUT    | /timetable/slots                                    | timetable.manage                                  | Whole bell; send ids back to keep periods; up to 16, in time order                                                                      |
| GET    | /timetable/sections/:id                             | any member who can see the section                | Week grid, class subjects with default teacher                                                                                          |
| PUT    | /timetable/sections/:id/cell                        | timetable.manage                                  | `{weekday 1-6, slotId, subjectId \| null, membershipId?}`; teacher defaults from Who-teaches-what; 409 if the teacher is busy elsewhere |
| GET    | /timetable/mine?date                                | any member                                        | My periods that day, incl. covers                                                                                                       |
| GET    | /timetable/teachers/:membershipId/day?campusId&date | timetable.manage                                  | Their periods with free teachers per period                                                                                             |
| PUT    | /timetable/substitutions                            | timetable.manage                                  | `{onDate, entryId, substituteMembershipId \| null}`; 409 if the substitute is busy                                                      |
| POST   | /homework                                           | subject teacher, class teacher or academic.manage | multipart: sectionId, subjectId, title, details, dueOn, optional `file` (photo/PDF ≤ 5 MB)                                              |
| GET    | /homework?sectionId                                 | can see the section                               | Recent homework                                                                                                                         |
| DELETE | /homework/:id                                       | the teacher who gave it or academic.manage        | Soft remove                                                                                                                             |
| GET    | /notices                                            | notices.manage                                    | With read counts                                                                                                                        |
| GET    | /notices/feed                                       | any member                                        | Published notices for staff                                                                                                             |
| POST   | /notices; PUT /notices/:id                          | notices.manage                                    | audience everyone/parents/staff; optional classes/sections; drafts only editable                                                        |
| POST   | /notices/:id/publish, /archive                      | notices.manage                                    | Publish emits `notice.published`                                                                                                        |
| POST   | /notices/:id/read                                   | any member                                        | Marks read                                                                                                                              |
| GET    | /family/children/:id/homework                       | family.portal                                     |                                                                                                                                         |
| GET    | /family/notices                                     | family.portal                                     | Only notices for this parent's children's classes                                                                                       |
| POST   | /family/children/:id/leave                          | family.portal                                     | `{fromDate, toDate, reason}`; up to 30 days, from at most 7 days back; class teacher decides in Attendance → Leave                      |
| POST   | /family/leave/:id/cancel                            | family.portal                                     | Pending requests only                                                                                                                   |

## Exams (Phase 11)

| Method               | Path                                                 | Who                                       | Notes                                                           |
| -------------------- | ---------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| GET                  | /exams?campusId                                      | any member                                | Current year's exams with handed-in progress                    |
| POST                 | /exams                                               | exams.manage                              | `{campusId, name, termId?, startsOn?, endsOn?}`                 |
| GET / PATCH / DELETE | /exams/:id                                           | view: academic.view; change: exams.manage | Delete only drafts                                              |
| POST                 | /exams/:id/status                                    | exams.manage                              | `draft → open → published`; published → open takes results back |
| PUT                  | /exams/:id/papers                                    | exams.manage                              | One class's date sheet `{gradeLevelId, papers[]}`               |
| GET                  | /exams/marks/mine                                    | any member                                | Papers this teacher has to enter in open exams                  |
| GET / PUT            | /exams/papers/:paperId/sections/:sectionId           | subject teacher or exams.manage           | Marks register; PUT `{marks:[{enrollmentId, status, marks}]}`   |
| POST                 | …/submit, …/reopen                                   | teacher / exams.manage                    | Hand in (locks) / reopen                                        |
| GET                  | /exams/:id/sections/:sectionId/results               | class teacher or office                   | Totals, grades, rank                                            |
| PUT                  | /exams/:id/sections/:sectionId/remarks               | class teacher or exams.manage             |                                                                 |
| GET                  | /exams/:id/students/:studentId/report-card.pdf       | class teacher or office                   |                                                                 |
| GET                  | /family/children/:id/results                         | family.portal                             | Published exams only                                            |
| GET                  | /family/children/:id/results/:examId/report-card.pdf | family.portal                             |                                                                 |

## Platform — hidden (404) from non-staff

| Method | Path                         | Platform role                                |
| ------ | ---------------------------- | -------------------------------------------- |
| GET    | /platform/tenants            | super_admin, support, operations             |
| POST   | /platform/tenants/:id/status | super_admin, operations — `{status, reason}` |

## Health

`GET /health` (liveness), `GET /health/ready` (database).
