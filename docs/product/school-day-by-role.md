# How a school day really runs — and what the app must do for each role

Indian K-12 schools run on paper and habit: the attendance register, the teacher's diary, the
fee counter's receipt book, the gate register, WhatsApp groups. We win only if each daily job is
**faster on the app than on paper**. Rules that follow from that:

1. **One tap to today's job.** Every role lands on "Today" with its 2–4 daily actions as big
   buttons. Setup screens stay out of the way (under "Setup").
2. **A teacher sees only their own classes.** Class teacher → their section; subject teacher →
   the sections and subject they teach. Nothing else in menus, lists or search.
3. **Phone first for teachers, parents, drivers.** Desktop for the office and the fee counter.
4. **Data entry once.** Old data comes in from Excel in one go; after that the app fills things
   in (rolls from enrolment, dues from fee plans, messages from events).
5. **Works on bad networks.** Small pages, saves retried, and (later) attendance that works offline
   and syncs.

---

## The day, hour by hour

| Time         | What happens offline                                                                                                              | What the app should do                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6:30–7:30    | Buses run routes; attendant ticks names on a paper list; parents call "is the bus late?"                                          | Transport: driver/attendant marks _boarded_ per stop on a phone; parents get "boarded" / "bus late" messages. (Transport phase)                                                                                            |
| 7:30–7:50    | Gate: late-comers written in the late register; visitors in the visitor book                                                      | Gate: mark _late arrival_ in 2 taps by name/admission no.; visitor log with phone and purpose; late count flows into attendance.                                                                                           |
| 7:50–8:10    | Assembly / prayer; announcements; birthday wishes; discipline notes                                                               | Notices for the day; today's birthdays on the Today screen; principal's announcement goes to staff and parents.                                                                                                            |
| 8:10–8:20    | **Class teacher takes the roll** in the register; absentees' parents may be called                                                | Class teacher: open "My class" → everyone present by default → tap the absent ones → save. Parents of absentees get a message automatically. Office sees which sections have not marked yet.                               |
| 8:20–13:30   | Periods run by the **timetable**; subject teachers move class to class; a teacher on leave needs a **substitute**                 | Teacher: "My timetable today" with the next period on top; period attendance where the school uses it; substitution: office sees free teachers for a period and assigns one; the substitute sees it on their Today screen. |
| In class     | Teacher writes **homework** on the board; students copy to diary; class tests and assignments; marks noted in the teacher's diary | Teacher: add homework for the section + subject in 20 seconds (text, photo of board, due date) → parents see it; create class test → enter marks in a grid → students/parents see them later.                              |
| Recess       | Canteen; sick room; discipline incidents                                                                                          | (Later) incident note on the student, seen by class teacher and principal.                                                                                                                                                 |
| All day      | Office: admissions inquiries, TCs, bonafide certificates, fee counter, parent calls                                               | Front office: find any student by name/phone in one search; print certificates; fee counter with receipts; inquiry log.                                                                                                    |
| 13:30–14:00  | Dispersal; buses; parents picking up small children                                                                               | Transport: _dropped_ per stop; pickup authorisation for small children (later).                                                                                                                                            |
| After school | Teachers check notebooks, plan lessons; office closes the cash; principal reviews                                                 | Accountant: day closing (cash counted vs expected). Principal: one screen with attendance %, absentees, fee collection, pending approvals.                                                                                 |
| Evening      | Parents check diary/homework, WhatsApp groups buzz                                                                                | Parent app: today's attendance, homework, notices, fees due — one screen.                                                                                                                                                  |

---

## Role by role

### Principal / Head

- **Offline:** walks rounds, checks registers are filled, signs leave and TCs, reviews fee defaulters,
  handles parent complaints, approves concessions.
- **Pain:** finds out at noon that a register was not taken; no single view of the day.
- **App:** Today = attendance taken / not taken by section, absentees, staff on leave, today's
  collection, approvals waiting (concessions, refunds, leave). Read-everything, change-little.

### School admin / office

- **Offline:** admissions, student records, certificates, staff records, timetable on a chart
  paper, substitutions, notices, calendar.
- **App:** setup once (classes, subjects, teachers, timetable, fee plans), Excel import, students,
  certificates, notices, substitution board.

### Class teacher (the most important user)

- **Offline:** morning roll, parents' notes in the diary, leave applications, collects forms and
  fee reminders, report cards, PTM.
- **App (phone):** Today → "Take attendance — Class 5 A" big button; absentees list; leave
  requests from parents to approve; students of _their_ section with parent phone (tap to call /
  WhatsApp); homework and notices for the class; remarks on report cards.
- **Sees:** only their section (plus their subject classes, below).

### Subject teacher (e.g. Hindi in Class 1, 3, 4, 5)

- **Offline:** carries a timetable card; teaches the same subject in several sections; checks
  homework; class tests; marks in a diary.
- **App (phone):** Today → "My periods" (Class 3 B · Hindi · Period 2 …); for each: period
  attendance if used, homework, test marks — **only for that subject in those sections**.
  Student list of those sections, without fee or personal details beyond what teaching needs.

### Accountant / fee counter

- **Offline:** receipt book, cash, cheques, bank deposit slips, defaulter list in a register.
- **App (desktop):** Counter (search → amount → receipt in under 30 seconds), payments to check
  (parent UPI screenshots), cheque clearing, day closing, defaulter list with WhatsApp reminders.
  (Built in Phases 6a–6c; reminders to add.)

### Receptionist / front office

- **Offline:** visitor book, phone calls, inquiry register, gate passes, late register.
- **App:** quick search, inquiry entry, visitor log, early-leave gate pass (parent notified),
  late arrivals.

### Admission officer

- Inquiry → follow-up → application → documents → admission. (Built in Phase 4b; add follow-up
  reminders and WhatsApp templates.)

### Transport manager, driver, attendant

- **Offline:** route sheets, fuel log, attendant's list, phone calls from parents.
- **App:** routes/stops/students; attendant marks boarded/dropped on phone; parents notified;
  fee for transport flows into fees.

### HR / staff

- **Offline:** staff attendance register (signature), leave register, salary sheet.
- **App:** staff attendance (self check-in on phone or office marks), staff leave with approval
  and automatic substitution prompt, payroll later.

### Parent

- **Offline:** child's diary, WhatsApp groups, calls to the office, queue at fee counter.
- **App:** one home screen per child: today's attendance, homework, notices, fees due → pay,
  receipts, leave request, contact class teacher. (Attendance/fees/pay built in 7a.)

### Student (older classes)

- Homework, timetable, marks, notices — read-only, later.

---

## What this changes in our plan

| Order | Phase                                                                                                                                                              | Why first                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1     | **Teachers & teaching assignments**: staff directory, invite by WhatsApp, class teacher + subject-teacher grid, strict "my classes" scope, teacher Today screen    | Without it teachers see too much or nothing; blocks homework, marks, timetable |
| 2     | **Bring your old data**: one Excel workbook (classes/sections, subjects, staff, assignments, students+parents, opening fee balances) with preview, errors and undo | Schools will not retype; this is the sales demo                                |
| 3     | **Daily classroom**: timetable, substitutions, homework, notices, parent leave, absent-alert to parents                                                            | The teacher's day and the parent's evening                                     |
| 4     | **Tests & report cards** (CBSE/RBSE formats)                                                                                                                       | Term-end pressure; paper-heavy today                                           |
| 5     | **Gate & front office**: late arrivals, visitors, gate passes, certificates                                                                                        | Daily friction at the gate                                                     |
| 6     | **Transport**                                                                                                                                                      | Bus is the parent's biggest daily worry                                        |
| 7     | **Staff attendance, leave, payroll**                                                                                                                               | Monthly                                                                        |
| Later | Offline mode for attendance, SMS OTP, Hindi UI, library, hostel, inventory                                                                                         |                                                                                |

## UI rules we now follow

- Sidebar = modules only (Today, Attendance, Students, Fees, Admissions, Academics, Website,
  Settings), collapsible to icons. Each module's pages are tabs at the top; rarely used setup
  pages sit under **Setup ▾**.
- People see only modules their role allows; teachers' sidebars are 3–4 items.
- Today screen per role: big action buttons, then "needs attention" numbers that link to the work.
- Forms default to the common case (everyone present; amount = due today; today's date).
