CREATE TABLE "concession_types" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"value" bigint NOT NULL,
	"fee_head_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concession_types_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "concession_types_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "concession_types_kind_chk" CHECK ("concession_types"."kind" in ('sibling', 'staff_ward', 'scholarship', 'rte', 'merit', 'other')),
	CONSTRAINT "concession_types_value_chk" CHECK (("concession_types"."mode" = 'percent' and "concession_types"."value" between 1 and 100) or ("concession_types"."mode" = 'fixed' and "concession_types"."value" > 0))
);
--> statement-breakpoint
CREATE TABLE "fee_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"student_concession_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_adjustments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_adjustments_kind_chk" CHECK ("fee_adjustments"."kind" in ('concession', 'waiver')),
	CONSTRAINT "fee_adjustments_status_chk" CHECK ("fee_adjustments"."status" in ('pending', 'approved', 'rejected', 'reversed')),
	CONSTRAINT "fee_adjustments_amount_chk" CHECK ("fee_adjustments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_assignments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	CONSTRAINT "fee_assignments_tenant_id_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fee_heads" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"gst_rate" smallint DEFAULT 0 NOT NULL,
	"refundable" boolean DEFAULT false NOT NULL,
	"income_account_id" uuid NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_heads_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_heads_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "fee_heads_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "fee_heads_gst_chk" CHECK ("fee_heads"."gst_rate" in (0, 5, 12, 18, 28)),
	CONSTRAINT "fee_heads_category_chk" CHECK ("fee_heads"."category" in ('tuition', 'admission', 'annual', 'exam', 'transport', 'activity', 'deposit', 'other', 'late_fee'))
);
--> statement-breakpoint
CREATE TABLE "fee_installments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"label" text NOT NULL,
	"due_on" date NOT NULL,
	CONSTRAINT "fee_installments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_installments_structure_id_uq" UNIQUE("tenant_id","structure_id","id"),
	CONSTRAINT "fee_installments_seq_uq" UNIQUE("tenant_id","structure_id","seq"),
	CONSTRAINT "fee_installments_seq_chk" CHECK ("fee_installments"."seq" between 1 and 24)
);
--> statement-breakpoint
CREATE TABLE "fee_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"fee_head_id" uuid NOT NULL,
	"kind" text DEFAULT 'fee' NOT NULL,
	"amount" bigint NOT NULL,
	"gst_rate" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoice_lines_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_invoice_lines_invoice_id_uq" UNIQUE("tenant_id","invoice_id","id"),
	CONSTRAINT "fee_invoice_lines_kind_chk" CHECK ("fee_invoice_lines"."kind" in ('fee', 'late_fee')),
	CONSTRAINT "fee_invoice_lines_amount_chk" CHECK ("fee_invoice_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_invoices" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoices_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_invoices_status_chk" CHECK ("fee_invoices"."status" in ('active', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fee_structure_classes" (
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	CONSTRAINT "fee_structure_classes_uq" UNIQUE("tenant_id","structure_id","grade_level_id")
);
--> statement-breakpoint
CREATE TABLE "fee_structure_items" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"fee_head_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "fee_structure_items_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_structure_items_uq" UNIQUE("tenant_id","structure_id","installment_id","fee_head_id"),
	CONSTRAINT "fee_structure_items_amount_chk" CHECK ("fee_structure_items"."amount" > 0 and "fee_structure_items"."amount" <= 10000000000)
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'class' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"late_fee_kind" text DEFAULT 'none' NOT NULL,
	"late_fee_amount" bigint DEFAULT 0 NOT NULL,
	"late_fee_grace_days" smallint DEFAULT 0 NOT NULL,
	"late_fee_cap" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structures_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_structures_tenant_campus_id_uq" UNIQUE("tenant_id","campus_id","id"),
	CONSTRAINT "fee_structures_name_uq" UNIQUE("tenant_id","campus_id","academic_year_id","name"),
	CONSTRAINT "fee_structures_kind_chk" CHECK ("fee_structures"."kind" in ('class', 'optional')),
	CONSTRAINT "fee_structures_status_chk" CHECK ("fee_structures"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "fee_structures_late_chk" CHECK ("fee_structures"."late_fee_kind" in ('none', 'fixed', 'per_day') and "fee_structures"."late_fee_amount" >= 0 and "fee_structures"."late_fee_cap" >= 0 and "fee_structures"."late_fee_grace_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_accounts_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "ledger_accounts_system_key_uq" UNIQUE("tenant_id","system_key"),
	CONSTRAINT "ledger_accounts_type_chk" CHECK ("ledger_accounts"."type" in ('asset', 'liability', 'income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"student_id" uuid,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_entries_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_entries_one_side_chk" CHECK (("ledger_entries"."debit" > 0 and "ledger_entries"."credit" = 0) or ("ledger_entries"."credit" > 0 and "ledger_entries"."debit" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_journals" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"posted_on" date NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_journals_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_journals_reverses_uq" UNIQUE("tenant_id","reverses_id")
);
--> statement-breakpoint
CREATE TABLE "student_concessions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"concession_type_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"value" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_concessions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_concessions_status_chk" CHECK ("student_concessions"."status" in ('pending', 'approved', 'rejected', 'revoked')),
	CONSTRAINT "student_concessions_value_chk" CHECK (("student_concessions"."mode" = 'percent' and "student_concessions"."value" between 1 and 100) or ("student_concessions"."mode" = 'fixed' and "student_concessions"."value" > 0))
);
--> statement-breakpoint
ALTER TABLE "concession_types" ADD CONSTRAINT "concession_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_line_fk" FOREIGN KEY ("tenant_id","invoice_id","line_id") REFERENCES "public"."fee_invoice_lines"("tenant_id","invoice_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_concession_fk" FOREIGN KEY ("tenant_id","student_concession_id") REFERENCES "public"."student_concessions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_journal_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."ledger_journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_structure_fk" FOREIGN KEY ("tenant_id","structure_id") REFERENCES "public"."fee_structures"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_income_account_fk" FOREIGN KEY ("tenant_id","income_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_structure_fk" FOREIGN KEY ("tenant_id","structure_id") REFERENCES "public"."fee_structures"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."fee_invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_head_fk" FOREIGN KEY ("tenant_id","fee_head_id") REFERENCES "public"."fee_heads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_installment_fk" FOREIGN KEY ("tenant_id","structure_id","installment_id") REFERENCES "public"."fee_installments"("tenant_id","structure_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_structure_fk" FOREIGN KEY ("tenant_id","campus_id","structure_id") REFERENCES "public"."fee_structures"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_classes" ADD CONSTRAINT "fee_structure_classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_classes" ADD CONSTRAINT "fee_structure_classes_structure_fk" FOREIGN KEY ("tenant_id","campus_id","structure_id") REFERENCES "public"."fee_structures"("tenant_id","campus_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_classes" ADD CONSTRAINT "fee_structure_classes_grade_fk" FOREIGN KEY ("tenant_id","campus_id","grade_level_id") REFERENCES "public"."grade_levels"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_installment_fk" FOREIGN KEY ("tenant_id","structure_id","installment_id") REFERENCES "public"."fee_installments"("tenant_id","structure_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_head_fk" FOREIGN KEY ("tenant_id","fee_head_id") REFERENCES "public"."fee_heads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_year_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."ledger_journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_reverses_fk" FOREIGN KEY ("tenant_id","reverses_id") REFERENCES "public"."ledger_journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_type_fk" FOREIGN KEY ("tenant_id","concession_type_id") REFERENCES "public"."concession_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_adjustments_invoice_idx" ON "fee_adjustments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_assignments_active_uq" ON "fee_assignments" USING btree ("tenant_id","structure_id","enrollment_id") WHERE "fee_assignments"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "fee_invoice_lines_invoice_idx" ON "fee_invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_live_uq" ON "fee_invoices" USING btree ("tenant_id","enrollment_id","installment_id") WHERE "fee_invoices"."status" = 'active';--> statement-breakpoint
CREATE INDEX "fee_invoices_student_idx" ON "fee_invoices" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_invoices_structure_idx" ON "fee_invoices" USING btree ("tenant_id","structure_id","installment_id");--> statement-breakpoint
CREATE INDEX "fee_invoices_due_idx" ON "fee_invoices" USING btree ("tenant_id","campus_id","due_on");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "ledger_entries" USING btree ("tenant_id","journal_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_student_idx" ON "ledger_entries" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "ledger_journals_source_idx" ON "ledger_journals" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "ledger_journals_posted_idx" ON "ledger_journals" USING btree ("tenant_id","campus_id","posted_on");--> statement-breakpoint
CREATE UNIQUE INDEX "student_concessions_live_uq" ON "student_concessions" USING btree ("tenant_id","enrollment_id","concession_type_id") WHERE "student_concessions"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "student_concessions_student_idx" ON "student_concessions" USING btree ("tenant_id","student_id");