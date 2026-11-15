CREATE TABLE "fee_payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"mode" text NOT NULL,
	"reference" text NOT NULL,
	"paid_on" date NOT NULL,
	"payer_name" text DEFAULT '' NOT NULL,
	"payer_phone" text DEFAULT '' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payment_proofs_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_payment_proofs_mode_chk" CHECK ("fee_payment_proofs"."mode" in ('upi', 'bank_transfer')),
	CONSTRAINT "fee_payment_proofs_status_chk" CHECK ("fee_payment_proofs"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "fee_payment_proofs_amount_chk" CHECK ("fee_payment_proofs"."amount" > 0 and "fee_payment_proofs"."amount" <= 10000000000)
);
--> statement-breakpoint
CREATE TABLE "fee_payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "fee_payment_requests_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_payment_requests_status_chk" CHECK ("fee_payment_requests"."status" in ('open', 'paid', 'cancelled')),
	CONSTRAINT "fee_payment_requests_amount_chk" CHECK ("fee_payment_requests"."amount" >= 100 and "fee_payment_requests"."amount" <= 10000000000)
);
--> statement-breakpoint
CREATE TABLE "fee_payment_settings" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"payee_name" text NOT NULL,
	"upi_id" text DEFAULT '' NOT NULL,
	"bank_account_name" text DEFAULT '' NOT NULL,
	"bank_account_number" text DEFAULT '' NOT NULL,
	"ifsc" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"qr_storage_key" text,
	"qr_content_type" text,
	"instructions" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payment_settings_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_payment_settings_campus_uq" UNIQUE("tenant_id","campus_id")
);
--> statement-breakpoint
CREATE TABLE "fee_refund_parts" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"payment_id" uuid,
	"invoice_id" uuid,
	"line_id" uuid,
	"amount" bigint NOT NULL,
	CONSTRAINT "fee_refund_parts_one_source_chk" CHECK (("fee_refund_parts"."payment_id" is not null and "fee_refund_parts"."line_id" is null) or ("fee_refund_parts"."payment_id" is null and "fee_refund_parts"."line_id" is not null)),
	CONSTRAINT "fee_refund_parts_amount_chk" CHECK ("fee_refund_parts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_refunds" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"refund_number" text,
	"amount" bigint NOT NULL,
	"source" text NOT NULL,
	"mode" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"paid_on" date,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_refunds_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_refunds_number_uq" UNIQUE("tenant_id","refund_number"),
	CONSTRAINT "fee_refunds_source_chk" CHECK ("fee_refunds"."source" in ('advance', 'deposit')),
	CONSTRAINT "fee_refunds_mode_chk" CHECK ("fee_refunds"."mode" in ('cash', 'cheque', 'bank_transfer', 'upi')),
	CONSTRAINT "fee_refunds_status_chk" CHECK ("fee_refunds"."status" in ('requested', 'rejected', 'paid')),
	CONSTRAINT "fee_refunds_amount_chk" CHECK ("fee_refunds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD COLUMN "release_journal_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD COLUMN "proof_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_payment_proofs" ADD CONSTRAINT "fee_payment_proofs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_proofs" ADD CONSTRAINT "fee_payment_proofs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_proofs" ADD CONSTRAINT "fee_payment_proofs_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."fee_payment_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_proofs" ADD CONSTRAINT "fee_payment_proofs_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_proofs" ADD CONSTRAINT "fee_payment_proofs_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."fee_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_requests" ADD CONSTRAINT "fee_payment_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_requests" ADD CONSTRAINT "fee_payment_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_requests" ADD CONSTRAINT "fee_payment_requests_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_requests" ADD CONSTRAINT "fee_payment_requests_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_settings" ADD CONSTRAINT "fee_payment_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_settings" ADD CONSTRAINT "fee_payment_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_settings" ADD CONSTRAINT "fee_payment_settings_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refund_parts" ADD CONSTRAINT "fee_refund_parts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refund_parts" ADD CONSTRAINT "fee_refund_parts_refund_fk" FOREIGN KEY ("tenant_id","refund_id") REFERENCES "public"."fee_refunds"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refund_parts" ADD CONSTRAINT "fee_refund_parts_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."fee_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refund_parts" ADD CONSTRAINT "fee_refund_parts_line_fk" FOREIGN KEY ("tenant_id","invoice_id","line_id") REFERENCES "public"."fee_invoice_lines"("tenant_id","invoice_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_journal_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."ledger_journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payment_proofs_reference_uq" ON "fee_payment_proofs" USING btree ("tenant_id","reference") WHERE "fee_payment_proofs"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "fee_payment_proofs_status_idx" ON "fee_payment_proofs" USING btree ("tenant_id","campus_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payment_requests_token_uq" ON "fee_payment_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "fee_payment_requests_student_idx" ON "fee_payment_requests" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_refund_parts_refund_idx" ON "fee_refund_parts" USING btree ("tenant_id","refund_id");--> statement-breakpoint
CREATE INDEX "fee_refund_parts_payment_idx" ON "fee_refund_parts" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE INDEX "fee_refund_parts_line_idx" ON "fee_refund_parts" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE INDEX "fee_refunds_student_idx" ON "fee_refunds" USING btree ("tenant_id","student_id");--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_proof_uq" UNIQUE("tenant_id","proof_id");