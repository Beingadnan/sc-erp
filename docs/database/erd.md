# Entity Relationship Diagram (initial)

Status: Phase 1 design. Tables are created phase by phase; Phase 2 builds the platform group.
Every tenant table also has `tenant_id`, `created_at`, `updated_at` and `unique (tenant_id, id)`;
they are omitted below for readability. All FKs between tenant tables are composite
`(tenant_id, x_id)`.

## Platform and tenancy (Phase 2)

```mermaid
erDiagram
  users ||--o{ tenant_memberships : "belongs to"
  tenants ||--o{ tenant_memberships : has
  tenants ||--o{ tenant_domains : "served at"
  tenants ||--o{ campuses : has
  tenants ||--o{ roles : defines
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : "granted by"
  tenant_memberships ||--o{ membership_roles : holds
  roles ||--o{ membership_roles : "assigned as"
  campuses ||--o{ membership_roles : "scoped to (nullable = all)"
  users ||--o{ sessions : has
  tenants ||--o{ audit_logs : records
  tenants ||--o{ outbox_events : emits

  users {
    uuid id PK
    citext email UK
    text password_hash
    bool mfa_enabled
    text status
  }
  tenants {
    uuid id PK
    text slug UK
    text name
    text status
    text plan
  }
  campuses {
    uuid id PK
    uuid tenant_id FK
    text code
    text name
    text board
    text timezone
  }
  tenant_memberships {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    text status
  }
  roles {
    uuid id PK
    uuid tenant_id FK
    text key
    bool is_system
  }
  permissions {
    text key PK
    text module
    text description
  }
  membership_roles {
    uuid id PK
    uuid tenant_id FK
    uuid membership_id FK
    uuid role_id FK
    uuid campus_id FK
  }
  audit_logs {
    uuid id PK
    uuid tenant_id FK
    uuid actor_user_id
    text action
    text entity
    uuid entity_id
    jsonb diff
  }
```

## School structure (Phase 3)

```mermaid
erDiagram
  campuses ||--o{ academic_years : runs
  academic_years ||--o{ academic_terms : "split into"
  campuses ||--o{ grade_levels : offers
  grade_levels ||--o{ sections : "divided into"
  academic_years ||--o{ sections : "for year"
  subjects ||--o{ class_subjects : "taught in"
  grade_levels ||--o{ class_subjects : includes
  campuses ||--o{ holidays : observes
  grading_scales ||--o{ grading_bands : has

  academic_years {
    uuid id PK
    uuid campus_id FK
    text name
    date starts_on
    date ends_on
    bool is_current
    text status
  }
  grade_levels {
    uuid id PK
    uuid campus_id FK
    text name
    int sort_order
  }
  sections {
    uuid id PK
    uuid grade_level_id FK
    uuid academic_year_id FK
    text name
    int capacity
  }
```

## Students and admissions (Phase 4)

```mermaid
erDiagram
  students ||--o{ student_enrollments : "enrolled each year"
  sections ||--o{ student_enrollments : contains
  academic_years ||--o{ student_enrollments : "in year"
  students ||--o{ student_guardians : has
  guardians ||--o{ student_guardians : "cares for"
  students ||--o{ student_documents : has
  admission_applications ||--o| students : "becomes"
  admission_leads ||--o{ admission_applications : converts
  students ||--o{ student_status_history : tracks

  students {
    uuid id PK
    text admission_number UK
    text first_name
    text last_name
    date date_of_birth
    text gender
    text pen
    text apaar_id
    text status
  }
  guardians {
    uuid id PK
    uuid user_id FK "nullable, portal login"
    text full_name
    text phone
    citext email
  }
  student_guardians {
    uuid student_id FK
    uuid guardian_id FK
    text relationship
    bool is_primary
    bool is_fee_payer
  }
  student_enrollments {
    uuid id PK
    uuid student_id FK
    uuid academic_year_id FK
    uuid section_id FK
    text roll_number
    text status
  }
```

## Attendance (Phase 5)

```mermaid
erDiagram
  sections ||--o{ attendance_sessions : "marked for"
  attendance_sessions ||--o{ student_attendance : records
  student_enrollments ||--o{ student_attendance : "of"
  student_attendance ||--o{ attendance_corrections : "corrected by"

  attendance_sessions {
    uuid id PK
    uuid section_id FK
    date on_date
    int period "null = daily"
    uuid marked_by
    timestamptz marked_at
  }
  student_attendance {
    uuid id PK
    uuid session_id FK
    uuid enrollment_id FK
    text status
  }
```

## Fees and ledger (Phase 6)

```mermaid
erDiagram
  fee_heads ||--o{ fee_structure_items : "priced in"
  fee_structures ||--o{ fee_structure_items : contains
  fee_structures ||--o{ student_fee_assignments : "assigned via"
  student_enrollments ||--o{ student_fee_assignments : "billed for"
  student_fee_assignments ||--o{ fee_invoices : generates
  fee_invoices ||--o{ fee_invoice_lines : itemises
  payment_transactions ||--o{ payment_allocations : "allocated to"
  fee_invoice_lines ||--o{ payment_allocations : "paid by"
  payment_transactions ||--o| receipts : "evidenced by"
  payment_transactions ||--o{ refunds : "refunded by"
  ledger_accounts ||--o{ ledger_entries : posts

  fee_invoices {
    uuid id PK
    uuid enrollment_id FK
    text installment_label
    date due_on
    numeric total
    text status
  }
  payment_transactions {
    uuid id PK
    text method
    numeric amount
    text status
    text idempotency_key UK
    text gateway_ref
  }
  receipts {
    uuid id PK
    uuid campus_id FK
    text series
    bigint number
    text status
  }
  ledger_entries {
    uuid id PK
    uuid journal_id
    uuid account_id FK
    numeric debit
    numeric credit
    text source_type
    uuid source_id
  }
```

Ledger rule: every journal's debits equal credits (deferred constraint trigger); entries are
append-only (no UPDATE/DELETE grants); corrections are reversing journals.
