# Design system: calm, plain, Fluent-style

Decided Nov 2026. Based on Microsoft Fluent 2 (the design behind Teams, Outlook and Windows 11),
adapted to how Indian schools work on cheap Windows PCs, office laptops and parents' Android phones.

## Principles

1. **Built for focus.** The page shows what this person must do now. Chrome (borders, colours,
   shadows) stays quiet so the content leads. One primary (blue) button per screen area.
2. **Familiar.** Office staff already use Windows, Office and WhatsApp. Use the Windows font
   (Segoe UI), Microsoft blue, plain words, and patterns they know: left navigation, tabs, tables,
   dialogs that ask before deleting.
3. **Plain language.** "Fee counter", "Take attendance", "Who teaches what" — not "Billing module".
   Labels are short; only the first word is capitalised. Hindi names must render (Devanagari font).
4. **One click to the daily job.** Each role's Today page leads with that role's daily task;
   everything else is in the navigation.
5. **Works for everyone.** Text contrast AA, 32 px controls (44 px on phones), keyboard and
   screen reader friendly, no colour-only meaning (status badges also have words).

## Tokens (apps/web/src/app/globals.css)

| Token | Value | Use |
| --- | --- | --- |
| Brand | `#0F6CBD` (hover `#115EA3`, pressed `#0F548C`, tint `#EBF3FC`) | primary buttons, links, selected nav, focus |
| Page background | `#F5F5F5` | behind cards |
| Surface | `#FFFFFF` with 1 px `#E0E0E0` stroke | cards, tables, dialogs |
| Text | primary `#242424`, secondary `#616161`, disabled `#BDBDBD` | |
| Status | success `#107C10`, warning `#BC4B09` / `#FDF6F3`, danger `#C50F1F` / `#FDF3F4`, info brand | badges, alerts |
| Font | Segoe UI Variable → Segoe UI → system UI, then Noto Sans Devanagari | Windows default, Hindi |
| Type ramp | 12/16 caption · 14/20 body · 16/22 subtitle · 20/28 section · 24/32 page title (semibold) | |
| Radius | 4 px controls, 8 px cards, 12 px dialogs | |
| Spacing | 4 px grid; cards 16–20 px padding; 24 px between sections | |
| Elevation | cards flat with stroke; menus/dialogs shadow 8/28 | |

Tailwind's `slate-*` and `brand-*` classes map to these values, so existing pages pick them up.

## Shell

- **Navigation (left, 240 px; 48 px rail when collapsed; drawer on phones).** Grouped like Fluent
  Nav categories: *Daily* (Today, Attendance, My classes), *Students* (Students, Admissions),
  *Money* (Fees), *Teaching* (Academics, Exams), *School* (Notices, Website, Settings). Each item
  has an icon; the selected item has a blue indicator bar and a tinted background.
- **Header.** School name (switcher when several), **Find a student** search for office roles,
  and the account menu.
- **Page.** Title + one-line description + actions on the right (command bar). Sub-pages of a
  section appear as tabs under the header; set-up pages live under "Setup".

## Components

Buttons (primary / secondary / subtle / danger; 32 px, icons from lucide), text fields with label
above and help/error below, selects, switches, checkboxes, cards, tables (44 px rows, hover
highlight, sticky header), badges with dot, alerts, empty states with an icon and next step,
dialogs and "Are you sure?" confirmations, toasts, action menus (⋯).

## Home page per role

| Role | First thing on Today |
| --- | --- |
| Owner / principal | Today's attendance %, fees collected today, dues, staff absent; "Needs attention" list; shortcuts |
| Office admin | Teacher absent? (substitutions), admissions, notices, students |
| Accountant | Fee counter button, today's collection, pending payment proofs, day closing |
| Receptionist | New inquiry, send notice, find student |
| Teacher | My periods today, take attendance for my class, marks to enter, homework |
| Parent (phone) | Each child as a card with today's attendance, dues and new homework; notices |
