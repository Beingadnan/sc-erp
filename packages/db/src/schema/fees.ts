import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { academicYears, gradeLevels } from './academic.js';
import { campuses, tenants, users } from './platform.js';
import { studentEnrollments, students } from './students.js';
import { idColumn, timestamps } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 6a — fees: setup, concessions, demands and the double-entry ledger.
 *
 * Money is whole paise in bigint columns. Nothing that records money is updated in place:
 * a demand line is fixed once created, reductions are adjustments, and every financial
 * event posts a balanced journal. Balances are always derived from these rows.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
const paise = (name: string) => bigint(name, { mode: 'number' });
const byUser = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

export const FEE_HEAD_CATEGORIES = [
  'tuition',
  'admission',
  'annual',
  'exam',
  'transport',
  'activity',
  'deposit',
  'other',
  'late_fee',
] as const;

/* --------------------------------------- ledger --------------------------------------- */

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: idColumn(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** asset | liability | income | expense */
    type: text('type').notNull(),
    /** Accounts the system posts to (receivable, concessions, cash…); null for fee-head income. */
    systemKey: text('system_key'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('ledger_accounts_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('ledger_accounts_code_uq').on(t.tenantId, t.code),
    unique('ledger_accounts_system_key_uq').on(t.tenantId, t.systemKey),
    check(
      'ledger_accounts_type_chk',
      sql`${t.type} in ('asset', 'liability', 'income', 'expense')`,
    ),
  ],
);

/** One financial event. Its entries balance (checked at commit). Never changed; reversed. */
export const ledgerJournals = pgTable(
  'ledger_journals',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    postedOn: date('posted_on').notNull(),
    /** invoice | adjustment | late_fee | invoice_cancel | payment | refund … */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    memo: text('memo').notNull().default(''),
    reversesId: uuid('reverses_id'),
    createdBy: byUser('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ledger_journals_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('ledger_journals_reverses_uq').on(t.tenantId, t.reversesId),
    index('ledger_journals_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    index('ledger_journals_posted_idx').on(t.tenantId, t.campusId, t.postedOn),
    foreignKey({
      name: 'ledger_journals_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    foreignKey({
      name: 'ledger_journals_reverses_fk',
      columns: [t.tenantId, t.reversesId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: idColumn(),
    tenantId: tenantId(),
    journalId: uuid('journal_id').notNull(),
    accountId: uuid('account_id').notNull(),
    /** Sub-ledger: set on receivable (and later advance/refund) entries. */
    studentId: uuid('student_id'),
    debit: paise('debit').notNull().default(0),
    credit: paise('credit').notNull().default(0),
  },
  (t) => [
    unique('ledger_entries_tenant_id_id_uq').on(t.tenantId, t.id),
    index('ledger_entries_journal_idx').on(t.tenantId, t.journalId),
    index('ledger_entries_account_idx').on(t.tenantId, t.accountId),
    index('ledger_entries_student_idx').on(t.tenantId, t.studentId),
    foreignKey({
      name: 'ledger_entries_journal_fk',
      columns: [t.tenantId, t.journalId],
      foreignColumns: [ledgerJournals.tenantId, ledgerJournals.id],
    }),
    foreignKey({
      name: 'ledger_entries_account_fk',
      columns: [t.tenantId, t.accountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
    }),
    foreignKey({
      name: 'ledger_entries_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    check(
      'ledger_entries_one_side_chk',
      sql`(${t.debit} > 0 and ${t.credit} = 0) or (${t.credit} > 0 and ${t.debit} = 0)`,
    ),
  ],
);

/* ------------------------------------- fee setup ------------------------------------- */

export const feeHeads = pgTable(
  'fee_heads',
  {
    id: idColumn(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('other'),
    /** GST rate in percent; school education fees are exempt (0). Amounts are inclusive. */
    gstRate: smallint('gst_rate').notNull().default(0),
    refundable: boolean('refundable').notNull().default(false),
    incomeAccountId: uuid('income_account_id').notNull(),
    /** The built-in late fee head. */
    system: boolean('system').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('fee_heads_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_heads_code_uq').on(t.tenantId, t.code),
    unique('fee_heads_name_uq').on(t.tenantId, t.name),
    foreignKey({
      name: 'fee_heads_income_account_fk',
      columns: [t.tenantId, t.incomeAccountId],
      foreignColumns: [ledgerAccounts.tenantId, ledgerAccounts.id],
    }),
    check('fee_heads_gst_chk', sql`${t.gstRate} in (0, 5, 12, 18, 28)`),
    check(
      'fee_heads_category_chk',
      sql`${t.category} in ('tuition', 'admission', 'annual', 'exam', 'transport', 'activity', 'deposit', 'other', 'late_fee')`,
    ),
  ],
);

/**
 * A fee plan for one campus and year. `class` structures bill every student of their
 * classes; `optional` ones (transport, hostel…) bill only students assigned to them.
 */
export const feeStructures = pgTable(
  'fee_structures',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('class'),
    /** draft | published | archived. Demands only from published structures. */
    status: text('status').notNull().default('draft'),
    /** none | fixed | per_day */
    lateFeeKind: text('late_fee_kind').notNull().default('none'),
    lateFeeAmount: paise('late_fee_amount').notNull().default(0),
    lateFeeGraceDays: smallint('late_fee_grace_days').notNull().default(0),
    /** 0 = no cap (per_day only). */
    lateFeeCap: paise('late_fee_cap').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('fee_structures_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_structures_tenant_campus_id_uq').on(t.tenantId, t.campusId, t.id),
    unique('fee_structures_name_uq').on(t.tenantId, t.campusId, t.academicYearId, t.name),
    foreignKey({
      name: 'fee_structures_year_fk',
      columns: [t.tenantId, t.campusId, t.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.campusId, academicYears.id],
    }),
    check('fee_structures_kind_chk', sql`${t.kind} in ('class', 'optional')`),
    check('fee_structures_status_chk', sql`${t.status} in ('draft', 'published', 'archived')`),
    check(
      'fee_structures_late_chk',
      sql`${t.lateFeeKind} in ('none', 'fixed', 'per_day') and ${t.lateFeeAmount} >= 0 and ${t.lateFeeCap} >= 0 and ${t.lateFeeGraceDays} between 0 and 365`,
    ),
  ],
);

export const feeStructureClasses = pgTable(
  'fee_structure_classes',
  {
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    structureId: uuid('structure_id').notNull(),
    gradeLevelId: uuid('grade_level_id').notNull(),
  },
  (t) => [
    unique('fee_structure_classes_uq').on(t.tenantId, t.structureId, t.gradeLevelId),
    foreignKey({
      name: 'fee_structure_classes_structure_fk',
      columns: [t.tenantId, t.campusId, t.structureId],
      foreignColumns: [feeStructures.tenantId, feeStructures.campusId, feeStructures.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fee_structure_classes_grade_fk',
      columns: [t.tenantId, t.campusId, t.gradeLevelId],
      foreignColumns: [gradeLevels.tenantId, gradeLevels.campusId, gradeLevels.id],
    }),
  ],
);

export const feeInstallments = pgTable(
  'fee_installments',
  {
    id: idColumn(),
    tenantId: tenantId(),
    structureId: uuid('structure_id').notNull(),
    seq: smallint('seq').notNull(),
    label: text('label').notNull(),
    dueOn: date('due_on').notNull(),
  },
  (t) => [
    unique('fee_installments_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_installments_structure_id_uq').on(t.tenantId, t.structureId, t.id),
    unique('fee_installments_seq_uq').on(t.tenantId, t.structureId, t.seq),
    foreignKey({
      name: 'fee_installments_structure_fk',
      columns: [t.tenantId, t.structureId],
      foreignColumns: [feeStructures.tenantId, feeStructures.id],
    }).onDelete('cascade'),
    check('fee_installments_seq_chk', sql`${t.seq} between 1 and 24`),
  ],
);

/** Amount of one fee head in one installment of a structure. */
export const feeStructureItems = pgTable(
  'fee_structure_items',
  {
    id: idColumn(),
    tenantId: tenantId(),
    structureId: uuid('structure_id').notNull(),
    installmentId: uuid('installment_id').notNull(),
    feeHeadId: uuid('fee_head_id').notNull(),
    amount: paise('amount').notNull(),
  },
  (t) => [
    unique('fee_structure_items_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_structure_items_uq').on(t.tenantId, t.structureId, t.installmentId, t.feeHeadId),
    foreignKey({
      name: 'fee_structure_items_installment_fk',
      columns: [t.tenantId, t.structureId, t.installmentId],
      foreignColumns: [feeInstallments.tenantId, feeInstallments.structureId, feeInstallments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fee_structure_items_head_fk',
      columns: [t.tenantId, t.feeHeadId],
      foreignColumns: [feeHeads.tenantId, feeHeads.id],
    }),
    check('fee_structure_items_amount_chk', sql`${t.amount} > 0 and ${t.amount} <= 10000000000`),
  ],
);

/** Students assigned to optional structures. Removed, never deleted. */
export const feeAssignments = pgTable(
  'fee_assignments',
  {
    id: idColumn(),
    tenantId: tenantId(),
    structureId: uuid('structure_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    studentId: uuid('student_id').notNull(),
    assignedBy: byUser('assigned_by'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    removedBy: byUser('removed_by'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    unique('fee_assignments_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('fee_assignments_active_uq')
      .on(t.tenantId, t.structureId, t.enrollmentId)
      .where(sql`${t.removedAt} is null`),
    foreignKey({
      name: 'fee_assignments_structure_fk',
      columns: [t.tenantId, t.structureId],
      foreignColumns: [feeStructures.tenantId, feeStructures.id],
    }),
    foreignKey({
      name: 'fee_assignments_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
  ],
);

/* ------------------------------------- concessions ------------------------------------- */

export const concessionTypes = pgTable(
  'concession_types',
  {
    id: idColumn(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** sibling | staff_ward | scholarship | rte | merit | other */
    kind: text('kind').notNull(),
    /** percent (value = whole percent) | fixed (value = paise per installment) */
    mode: text('mode').notNull(),
    value: paise('value').notNull(),
    /** Fee heads it reduces; empty = every head except late fees. */
    feeHeadIds: uuid('fee_head_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('concession_types_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('concession_types_name_uq').on(t.tenantId, t.name),
    check(
      'concession_types_kind_chk',
      sql`${t.kind} in ('sibling', 'staff_ward', 'scholarship', 'rte', 'merit', 'other')`,
    ),
    check(
      'concession_types_value_chk',
      sql`(${t.mode} = 'percent' and ${t.value} between 1 and 100) or (${t.mode} = 'fixed' and ${t.value} > 0)`,
    ),
  ],
);

/** A concession given to one student for one year; needs approval. */
export const studentConcessions = pgTable(
  'student_concessions',
  {
    id: idColumn(),
    tenantId: tenantId(),
    enrollmentId: uuid('enrollment_id').notNull(),
    studentId: uuid('student_id').notNull(),
    concessionTypeId: uuid('concession_type_id').notNull(),
    /** Copied from the type at request time; may be set per student (e.g. scholarship amount). */
    mode: text('mode').notNull(),
    value: paise('value').notNull(),
    reason: text('reason').notNull(),
    /** pending | approved | rejected | revoked */
    status: text('status').notNull().default('pending'),
    requestedBy: byUser('requested_by'),
    decidedBy: byUser('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('student_concessions_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('student_concessions_live_uq')
      .on(t.tenantId, t.enrollmentId, t.concessionTypeId)
      .where(sql`${t.status} in ('pending', 'approved')`),
    index('student_concessions_student_idx').on(t.tenantId, t.studentId),
    foreignKey({
      name: 'student_concessions_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
    foreignKey({
      name: 'student_concessions_type_fk',
      columns: [t.tenantId, t.concessionTypeId],
      foreignColumns: [concessionTypes.tenantId, concessionTypes.id],
    }),
    check(
      'student_concessions_status_chk',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'revoked')`,
    ),
    check(
      'student_concessions_value_chk',
      sql`(${t.mode} = 'percent' and ${t.value} between 1 and 100) or (${t.mode} = 'fixed' and ${t.value} > 0)`,
    ),
  ],
);

/* --------------------------------------- demands --------------------------------------- */

/** One installment billed to one student ("demand"). */
export const feeInvoices = pgTable(
  'fee_invoices',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    studentId: uuid('student_id').notNull(),
    structureId: uuid('structure_id').notNull(),
    installmentId: uuid('installment_id').notNull(),
    dueOn: date('due_on').notNull(),
    /** active | cancelled. Paid/partly paid is derived from allocations. */
    status: text('status').notNull().default('active'),
    cancelReason: text('cancel_reason'),
    cancelledBy: byUser('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: byUser('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_invoices_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('fee_invoices_live_uq')
      .on(t.tenantId, t.enrollmentId, t.installmentId)
      .where(sql`${t.status} = 'active'`),
    index('fee_invoices_student_idx').on(t.tenantId, t.studentId),
    index('fee_invoices_structure_idx').on(t.tenantId, t.structureId, t.installmentId),
    index('fee_invoices_due_idx').on(t.tenantId, t.campusId, t.dueOn),
    foreignKey({
      name: 'fee_invoices_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
    foreignKey({
      name: 'fee_invoices_installment_fk',
      columns: [t.tenantId, t.structureId, t.installmentId],
      foreignColumns: [feeInstallments.tenantId, feeInstallments.structureId, feeInstallments.id],
    }),
    foreignKey({
      name: 'fee_invoices_structure_fk',
      columns: [t.tenantId, t.campusId, t.structureId],
      foreignColumns: [feeStructures.tenantId, feeStructures.campusId, feeStructures.id],
    }),
    check('fee_invoices_status_chk', sql`${t.status} in ('active', 'cancelled')`),
  ],
);

export const feeInvoiceLines = pgTable(
  'fee_invoice_lines',
  {
    id: idColumn(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id').notNull(),
    feeHeadId: uuid('fee_head_id').notNull(),
    /** fee | late_fee */
    kind: text('kind').notNull().default('fee'),
    amount: paise('amount').notNull(),
    gstRate: smallint('gst_rate').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_invoice_lines_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_invoice_lines_invoice_id_uq').on(t.tenantId, t.invoiceId, t.id),
    index('fee_invoice_lines_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'fee_invoice_lines_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [feeInvoices.tenantId, feeInvoices.id],
    }),
    foreignKey({
      name: 'fee_invoice_lines_head_fk',
      columns: [t.tenantId, t.feeHeadId],
      foreignColumns: [feeHeads.tenantId, feeHeads.id],
    }),
    check('fee_invoice_lines_kind_chk', sql`${t.kind} in ('fee', 'late_fee')`),
    check('fee_invoice_lines_amount_chk', sql`${t.amount} > 0`),
  ],
);

/** A reduction of one demand line: a concession or a waiver. Approved ones are posted. */
export const feeAdjustments = pgTable(
  'fee_adjustments',
  {
    id: idColumn(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id').notNull(),
    lineId: uuid('line_id').notNull(),
    /** concession | waiver */
    kind: text('kind').notNull(),
    amount: paise('amount').notNull(),
    studentConcessionId: uuid('student_concession_id'),
    reason: text('reason').notNull(),
    /** pending | approved | rejected | reversed */
    status: text('status').notNull().default('pending'),
    requestedBy: byUser('requested_by'),
    decidedBy: byUser('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    journalId: uuid('journal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_adjustments_tenant_id_id_uq').on(t.tenantId, t.id),
    index('fee_adjustments_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'fee_adjustments_line_fk',
      columns: [t.tenantId, t.invoiceId, t.lineId],
      foreignColumns: [feeInvoiceLines.tenantId, feeInvoiceLines.invoiceId, feeInvoiceLines.id],
    }),
    foreignKey({
      name: 'fee_adjustments_concession_fk',
      columns: [t.tenantId, t.studentConcessionId],
      foreignColumns: [studentConcessions.tenantId, studentConcessions.id],
    }),
    foreignKey({
      name: 'fee_adjustments_journal_fk',
      columns: [t.tenantId, t.journalId],
      foreignColumns: [ledgerJournals.tenantId, ledgerJournals.id],
    }),
    check('fee_adjustments_kind_chk', sql`${t.kind} in ('concession', 'waiver')`),
    check(
      'fee_adjustments_status_chk',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'reversed')`,
    ),
    check('fee_adjustments_amount_chk', sql`${t.amount} > 0`),
  ],
);

/* ------------------------------------- payments (6b) ------------------------------------- */

export const PAYMENT_MODES = ['cash', 'cheque', 'dd', 'upi', 'card', 'bank_transfer'] as const;

/**
 * A payment received, with its receipt number (gap-free per campus and financial year).
 * Cheques and DDs stay `pending` until cleared or bounced; a cancelled receipt keeps its
 * number and is reversed in the ledger.
 */
export const feePayments = pgTable(
  'fee_payments',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    studentId: uuid('student_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    receiptNumber: text('receipt_number').notNull(),
    receivedOn: date('received_on').notNull(),
    mode: text('mode').notNull(),
    amount: paise('amount').notNull(),
    /** Cheque/DD number, UPI or bank reference, card slip number. */
    reference: text('reference').notNull().default(''),
    bankName: text('bank_name').notNull().default(''),
    instrumentDate: date('instrument_date'),
    payerName: text('payer_name').notNull().default(''),
    note: text('note').notNull().default(''),
    /** cleared | pending | bounced | cancelled */
    status: text('status').notNull(),
    clearedOn: date('cleared_on'),
    bouncedOn: date('bounced_on'),
    bounceReason: text('bounce_reason'),
    cancelReason: text('cancel_reason'),
    cancelledBy: byUser('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    collectedBy: byUser('collected_by'),
    closingId: uuid('closing_id'),
    /** Sent by the counter screen so a double click never takes money twice. */
    idempotencyKey: text('idempotency_key'),
    /** Set when the receipt comes from an approved payment proof (UPI / bank transfer). */
    proofId: uuid('proof_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_payments_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_payments_receipt_uq').on(t.tenantId, t.receiptNumber),
    unique('fee_payments_idempotency_uq').on(t.tenantId, t.idempotencyKey),
    unique('fee_payments_proof_uq').on(t.tenantId, t.proofId),
    index('fee_payments_student_idx').on(t.tenantId, t.studentId),
    index('fee_payments_day_idx').on(t.tenantId, t.campusId, t.receivedOn),
    foreignKey({
      name: 'fee_payments_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
    foreignKey({
      name: 'fee_payments_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    check(
      'fee_payments_mode_chk',
      sql`${t.mode} in ('cash', 'cheque', 'dd', 'upi', 'card', 'bank_transfer', 'online', 'opening')`,
    ),
    check(
      'fee_payments_status_chk',
      sql`${t.status} in ('cleared', 'pending', 'bounced', 'cancelled')`,
    ),
    check('fee_payments_amount_chk', sql`${t.amount} > 0 and ${t.amount} <= 10000000000`),
  ],
);

/** How much of a payment settles which demand line. Counted only while the payment is live. */
export const feeAllocations = pgTable(
  'fee_allocations',
  {
    id: idColumn(),
    tenantId: tenantId(),
    paymentId: uuid('payment_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    lineId: uuid('line_id').notNull(),
    amount: paise('amount').notNull(),
    /** payment = at the counter; advance = applied later from money held in advance */
    source: text('source').notNull().default('payment'),
    journalId: uuid('journal_id').notNull(),
    /** Set when the demand is cancelled: the money goes back to the student's advance. */
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releaseJournalId: uuid('release_journal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_allocations_tenant_id_id_uq').on(t.tenantId, t.id),
    index('fee_allocations_payment_idx').on(t.tenantId, t.paymentId),
    index('fee_allocations_line_idx').on(t.tenantId, t.lineId),
    index('fee_allocations_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'fee_allocations_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [feePayments.tenantId, feePayments.id],
    }),
    foreignKey({
      name: 'fee_allocations_line_fk',
      columns: [t.tenantId, t.invoiceId, t.lineId],
      foreignColumns: [feeInvoiceLines.tenantId, feeInvoiceLines.invoiceId, feeInvoiceLines.id],
    }),
    foreignKey({
      name: 'fee_allocations_journal_fk',
      columns: [t.tenantId, t.journalId],
      foreignColumns: [ledgerJournals.tenantId, ledgerJournals.id],
    }),
    check('fee_allocations_amount_chk', sql`${t.amount} > 0`),
    check('fee_allocations_source_chk', sql`${t.source} in ('payment', 'advance')`),
  ],
);

/** A cashier's day, closed with a cash count. Receipts of that day are tied to it. */
export const feeDayClosings = pgTable(
  'fee_day_closings',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    cashierId: uuid('cashier_id')
      .notNull()
      .references(() => users.id),
    closedFor: date('closed_for').notNull(),
    receipts: smallint('receipts').notNull(),
    /** Amounts per mode for the day, in paise. */
    totals: jsonb('totals').$type<Record<string, number>>().notNull(),
    cashExpected: paise('cash_expected').notNull(),
    cashCounted: paise('cash_counted').notNull(),
    note: text('note').notNull().default(''),
    closedBy: byUser('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_day_closings_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_day_closings_day_uq').on(t.tenantId, t.campusId, t.cashierId, t.closedFor),
    foreignKey({
      name: 'fee_day_closings_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    check('fee_day_closings_cash_chk', sql`${t.cashExpected} >= 0 and ${t.cashCounted} >= 0`),
  ],
);

/* ------------------------- pay to the school's account, refunds (6c) ------------------------- */

/**
 * Where parents pay a campus directly: bank account and UPI. Shown on payment links.
 * A gateway (Razorpay) can be added later alongside this.
 */
export const feePaymentSettings = pgTable(
  'fee_payment_settings',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    payeeName: text('payee_name').notNull(),
    upiId: text('upi_id').notNull().default(''),
    bankAccountName: text('bank_account_name').notNull().default(''),
    bankAccountNumber: text('bank_account_number').notNull().default(''),
    ifsc: text('ifsc').notNull().default(''),
    bankName: text('bank_name').notNull().default(''),
    branch: text('branch').notNull().default(''),
    /** The school's own QR image (optional); otherwise a UPI QR is generated with the amount. */
    qrStorageKey: text('qr_storage_key'),
    qrContentType: text('qr_content_type'),
    instructions: text('instructions').notNull().default(''),
    updatedBy: byUser('updated_by'),
    ...timestamps,
  },
  (t) => [
    unique('fee_payment_settings_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_payment_settings_campus_uq').on(t.tenantId, t.campusId),
    foreignKey({
      name: 'fee_payment_settings_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
  ],
);

/** A link sent to a parent to pay a student's dues. Only the token's hash is kept. */
export const feePaymentRequests = pgTable(
  'fee_payment_requests',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    studentId: uuid('student_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    amount: paise('amount').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** open | paid | cancelled */
    status: text('status').notNull().default('open'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    note: text('note').notNull().default(''),
    createdBy: byUser('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledBy: byUser('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    unique('fee_payment_requests_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('fee_payment_requests_token_uq').on(t.tokenHash),
    index('fee_payment_requests_student_idx').on(t.tenantId, t.studentId),
    foreignKey({
      name: 'fee_payment_requests_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
    check('fee_payment_requests_status_chk', sql`${t.status} in ('open', 'paid', 'cancelled')`),
    check(
      'fee_payment_requests_amount_chk',
      sql`${t.amount} >= 100 and ${t.amount} <= 10000000000`,
    ),
  ],
);

/**
 * A screenshot of a UPI / bank payment sent by a parent, with its UTR. Staff check it and
 * approve (a receipt is issued) or reject it. The same reference cannot be used twice.
 */
export const feePaymentProofs = pgTable(
  'fee_payment_proofs',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    requestId: uuid('request_id').notNull(),
    studentId: uuid('student_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    amount: paise('amount').notNull(),
    /** upi | bank_transfer */
    mode: text('mode').notNull(),
    /** UTR / UPI transaction id, upper-cased without spaces. */
    reference: text('reference').notNull(),
    paidOn: date('paid_on').notNull(),
    payerName: text('payer_name').notNull().default(''),
    payerPhone: text('payer_phone').notNull().default(''),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    decidedBy: byUser('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    paymentId: uuid('payment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_payment_proofs_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('fee_payment_proofs_reference_uq')
      .on(t.tenantId, t.reference)
      .where(sql`${t.status} in ('pending', 'approved')`),
    index('fee_payment_proofs_status_idx').on(t.tenantId, t.campusId, t.status),
    foreignKey({
      name: 'fee_payment_proofs_request_fk',
      columns: [t.tenantId, t.requestId],
      foreignColumns: [feePaymentRequests.tenantId, feePaymentRequests.id],
    }),
    foreignKey({
      name: 'fee_payment_proofs_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
    foreignKey({
      name: 'fee_payment_proofs_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [feePayments.tenantId, feePayments.id],
    }),
    check('fee_payment_proofs_mode_chk', sql`${t.mode} in ('upi', 'bank_transfer')`),
    check('fee_payment_proofs_status_chk', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check('fee_payment_proofs_amount_chk', sql`${t.amount} > 0 and ${t.amount} <= 10000000000`),
  ],
);

/**
 * Money paid back to a family: from what they hold in advance, or a refundable deposit.
 * Requested by one person and approved by another; numbered when approved.
 */
export const feeRefunds = pgTable(
  'fee_refunds',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id').notNull(),
    studentId: uuid('student_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    refundNumber: text('refund_number'),
    amount: paise('amount').notNull(),
    /** advance | deposit */
    source: text('source').notNull(),
    /** cash | cheque | bank_transfer | upi */
    mode: text('mode').notNull(),
    reference: text('reference').notNull().default(''),
    reason: text('reason').notNull(),
    /** requested | rejected | paid */
    status: text('status').notNull().default('requested'),
    requestedBy: byUser('requested_by'),
    decidedBy: byUser('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    paidOn: date('paid_on'),
    journalId: uuid('journal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_refunds_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('fee_refunds_number_uq').on(t.tenantId, t.refundNumber),
    index('fee_refunds_student_idx').on(t.tenantId, t.studentId),
    foreignKey({
      name: 'fee_refunds_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId, t.studentId],
      foreignColumns: [
        studentEnrollments.tenantId,
        studentEnrollments.id,
        studentEnrollments.studentId,
      ],
    }),
    foreignKey({
      name: 'fee_refunds_journal_fk',
      columns: [t.tenantId, t.journalId],
      foreignColumns: [ledgerJournals.tenantId, ledgerJournals.id],
    }),
    check('fee_refunds_source_chk', sql`${t.source} in ('advance', 'deposit')`),
    check('fee_refunds_mode_chk', sql`${t.mode} in ('cash', 'cheque', 'bank_transfer', 'upi')`),
    check('fee_refunds_status_chk', sql`${t.status} in ('requested', 'rejected', 'paid')`),
    check('fee_refunds_amount_chk', sql`${t.amount} > 0`),
  ],
);
/** What a refund draws on: part of a receipt's advance, or part of a paid deposit line. */
export const feeRefundParts = pgTable(
  'fee_refund_parts',
  {
    id: idColumn(),
    tenantId: tenantId(),
    refundId: uuid('refund_id').notNull(),
    paymentId: uuid('payment_id'),
    invoiceId: uuid('invoice_id'),
    lineId: uuid('line_id'),
    amount: paise('amount').notNull(),
  },
  (t) => [
    index('fee_refund_parts_refund_idx').on(t.tenantId, t.refundId),
    index('fee_refund_parts_payment_idx').on(t.tenantId, t.paymentId),
    index('fee_refund_parts_line_idx').on(t.tenantId, t.lineId),
    foreignKey({
      name: 'fee_refund_parts_refund_fk',
      columns: [t.tenantId, t.refundId],
      foreignColumns: [feeRefunds.tenantId, feeRefunds.id],
    }),
    foreignKey({
      name: 'fee_refund_parts_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [feePayments.tenantId, feePayments.id],
    }),
    foreignKey({
      name: 'fee_refund_parts_line_fk',
      columns: [t.tenantId, t.invoiceId, t.lineId],
      foreignColumns: [feeInvoiceLines.tenantId, feeInvoiceLines.invoiceId, feeInvoiceLines.id],
    }),
    check(
      'fee_refund_parts_one_source_chk',
      sql`(${t.paymentId} is not null and ${t.lineId} is null) or (${t.paymentId} is null and ${t.lineId} is not null)`,
    ),
    check('fee_refund_parts_amount_chk', sql`${t.amount} > 0`),
  ],
);
