# Phase 4b Report — Admissions and Documents

Date: 2026-11-11 · Status: built and tested in the workspace; awaiting live check on Neon

## What was implemented

- **Applications** created by staff, from scratch or from an inquiry (details pre-filled; the
  inquiry moves to "contacted"). Numbered `APP/2026/0001` (gap-free, per year).
- **Workflow**: submitted → under review → assessment (date and time) → approved / waitlisted
  / rejected, or withdrawn. Only allowed moves are offered and accepted; rejecting,
  withdrawing or waitlisting needs a reason; every step is kept in the history with who and
  when; two people cannot move the same application at once.
- **Admission from an application**: pick a section, record the privacy acknowledgement
  (and optionally Aadhaar), link to an existing parent if the mobile number is known — the
  student, enrollment, guardian and admission number are created in one transaction, the
  documents move to the student and the inquiry is closed.
- **Summary**: counts by status (clickable filters), by class and by source.
- **Documents** on applications and students: birth certificate, TC, report card, photo,
  address proof, Aadhaar card, caste certificate, medical, other.
  - Stored in **Vercel Blob (private)**; development falls back to local disk.
  - Real file type checked from the content; 5 MB limit; safe file names.
  - Opening a document gives a 5-minute link and is logged; Aadhaar cards, caste and medical
    documents need the sensitive permission; class teachers cannot open documents.
  - Removing deletes the file and keeps the record.
- Screens: Admissions → Applications (list, summary, new, detail with actions, history,
  documents and admit), "Start application" on each inquiry, Documents on the student record.

## Security

- 10 cross-school checks (read, list, edit, move, documents, links, upload, summary) all 404.
- Applications, history and document records cannot be deleted by the app; history is
  insert-only; an admitted application must point to its student (database check).
- Uploads: permission is checked before the file is sent anywhere; if saving the record
  fails, the uploaded file is removed again.
- Tampered or expired file links fail; served files are sandboxed (`Content-Security-Policy:
sandbox`, `nosniff`).
- The API refuses to start in production without a Blob token (no silent local storage).

## Tests

205 automated tests pass (validation 25, shared 11, database 47, worker 8, API 114),
including Vercel Blob calls (private, no overwrite, GET-only 5-minute links) checked against
a stand-in, plus a 4 MB upload through the web proxy.

## Setup needed

- `pnpm install` (new package `@vercel/blob`), then `pnpm db:setup` (migrations 0010, 0011).
- For real storage: create the private Blob store in Mumbai and add `BLOB_READ_WRITE_TOKEN`
  — see `docs/deployment/vercel-blob.md`. Until then files stay in `.storage/` on your Mac.

## Not in this part

- Online application form for parents (with uploads) — needs parent accounts (parent portal).
- Promotion, withdrawal, transfer certificates, import/export, custom fields — Phase 4c.
