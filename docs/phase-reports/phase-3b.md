# Phase 3b Report — School Website and Inquiries

Date: 2026-11-11 · Status: built and tested in the workspace; awaiting live check on Neon

## What was implemented

- **Website pages** for each school, at `/s/<school-address>` (e.g. `/s/shanti-vidya`):
  starter Home / About / Admissions / Contact drafts, new pages, menu order and visibility.
- **Drafts, publishing and history**: every save is a new version; visitors see only the
  published version; any old version can be viewed, restored (as a new version) or published.
  Unpublish and delete are available.
- **Editor** with live preview and formatting help. Content uses a small, safe Markdown subset:
  headings, paragraphs, lists, bold, italic and links (to other pages, the inquiry form,
  websites, phone and email).
- **Public school site**: rendered on the server (readable by search engines), with the menu,
  the school's campuses and contact details in the footer, and a placeholder home page until the
  school publishes one.
- **Admission inquiry form** on the public site: parent's name, mobile, optional email, child,
  class and campus, message, and an explicit consent checkbox (recorded with the time).
- **Inquiries inbox** for staff: filter by status, change status (new → contacted → closed),
  record walk-in / phone / referral inquiries. Phase 4 will turn inquiries into applications.
- New permissions `cms.manage`, `admissions.view`, `admissions.manage` on the built-in roles.

## Security

- No HTML is ever rendered from page content: the parser produces plain data and React escapes
  all text. Only `https/http/mailto/tel` and same-site page links become links; `javascript:`,
  `data:` and similar stay plain text. Verified on the rendered page in the workspace.
- Visitors never touch tenant tables: three definer functions return only published pages of
  active schools, and accept inquiries only for an active school and one of its active campuses.
- The inquiry endpoint answers the same way for unknown schools, other schools' campuses and
  bots (honeypot), so it cannot be used to probe; it is rate-limited per IP, per phone number
  and per school.
- Page history is append-only and inquiries keep what the parent submitted (the app can change
  only the status, and cannot delete) — enforced by database grants and tested.
- School B cannot read, edit, publish, restore or delete School A's pages or inquiries (tested).

## Tests

163 automated tests pass (validation 20, shared 11, database 43, worker 8, API 81), plus lint,
type checks, production build and the RLS checker. The public site was also run end to end in
the workspace (register → starter pages → publish → render → inquiry → inbox).

## Database changes

Migrations `0006_cms` and `0007_cms_security`. Apply with `pnpm db:setup`.

## Known limits / next

- Images and file uploads on pages come with document storage (Phase 4).
- Custom domains (e.g. `www.school.in`) need hosting work — deployment phase.
- SMS / WhatsApp alerts to the office for new inquiries — notifications phase.
- Erasure requests for inquiries (DPDP) — compliance phase.
