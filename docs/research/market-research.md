# Market Research — School ERP (India-first)

Status: Phase 0 draft · Last updated: 2026-11-11

## 1. Market snapshot

- India has roughly 14.7 lakh schools and ~24.7 crore students (UDISE+ 2025-26). About 10 lakh are government schools; the addressable market for a paid SaaS ERP is mainly the ~4–5 lakh private/aided schools, plus school groups.
- 200+ school ERP products are marketed to Indian schools. The market is crowded at the low end and fragmented; switching is driven by poor fee/accounting workflows, slow support, and weak parent apps.
- Typical buyers: school owner/trustee (decides), principal (influences), accountant and admin office (daily users, real veto power).

## 2. Competitor teardown

| Product           | Positioning                                 | Strengths                                                                                          | Weaknesses / gaps (opportunity)                                                       |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Entab CampusCare  | Long-standing, CBSE/ICSE-heavy, North India | Broad modules (transport, library, hostel), board-format reports, on-premise option                | Dated UI, mobile app is a web wrapper, per-module pricing creeps up                   |
| Teachmint         | Teaching app that grew into ERP             | Strong brand, live classes, parent app reach, free tier                                            | ERP depth (fees/accounting, multi-campus finance) thinner than legacy players         |
| MyClassboard      | Feature-rich ERP + app, South India         | Wide feature coverage incl. fees, transport, payroll                                               | Mixed support reputation, UI complexity                                               |
| Fedena (Foradian) | Global, cloud + open-source origins         | ~20 core modules, plugins, multi-school dashboard, low entry price (~US$1,299/yr per feature tier) | Generic (not India-board specific), plugin sprawl, older UX                           |
| ERPNext Education | Open-source (Frappe)                        | Real accounting backbone, customisable                                                             | Needs implementation partner; education module less polished; heavy for small schools |
| OpenEduCat        | Open-source (Odoo)                          | Global, free edition, Odoo ecosystem                                                               | Odoo complexity, India-specific workflows need customisation                          |

Sources used: vendor pages and review aggregators (Capterra/GetApp/SoftwareAdvice) — treat ratings and prices as indicative and re-verify during sales planning.

## 3. What actually wins in Indian schools

1. **Fee collection that matches the accountant's day**: counter collection in seconds, cheque bounce handling, concessions, installment demands, daily cash closing, receipts that never skip numbers.
2. **A parent app parents actually open**: fee due + pay via UPI, attendance alerts, homework, report cards.
3. **Board-correct report cards** (CBSE/ICSE/state formats) without vendor custom work.
4. **Fast onboarding from Excel** — schools arrive with spreadsheets.
5. **Support responsiveness** in local languages.
6. **Multi-campus group views** for chains (consolidated collections, strength).

## 4. Differentiation for this product

- **Modern, role-specific UX**: teacher sees 3 things, accountant sees money, parent sees one child at a time.
- **Ledger-grade fee module** (double-entry, immutable, reconcilable) — most competitors use invoice status flags.
- **Configuration over customisation**: boards, grading, fee structures, custom fields and roles set by the school, not by vendor engineers.
- **Security as a selling point**: provable tenant isolation, DPDP-ready consent and data export/deletion.
- **Import wizard with row-level validation** to cut onboarding from weeks to days.
- **Transparent per-student pricing** with all core modules included (pricing to be decided — see open questions).

## 5. Out of scope for now

- Live online classes / LMS (integrate later rather than build).
- Full general-ledger accounting package (export to Tally instead — see open questions).
- GPS hardware.
