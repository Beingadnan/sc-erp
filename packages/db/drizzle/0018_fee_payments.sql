CREATE TABLE "fee_allocations" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"source" text DEFAULT 'payment' NOT NULL,
	"journal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_allocations_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_allocations_amount_chk" CHECK ("fee_allocations"."amount" > 0),
	CONSTRAINT "fee_allocations_source_chk" CHECK ("fee_allocations"."source" in ('payment', 'advance'))
);
--> statement-breakpoint
CREATE TABLE "fee_day_closings" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"closed_for" date NOT NULL,
	"receipts" smallint NOT NULL,
	"totals" jsonb NOT NULL,
	"cash_expected" bigint NOT NULL,
	"cash_counted" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_day_closings_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_day_closings_day_uq" UNIQUE("tenant_id","campus_id","cashier_id","closed_for"),
	CONSTRAINT "fee_day_closings_cash_chk" CHECK ("fee_day_closings"."cash_expected" >= 0 and "fee_day_closings"."cash_counted" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"received_on" date NOT NULL,
	"mode" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"instrument_date" date,
	"payer_name" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"cleared_on" date,
	"bounced_on" date,
	"bounce_reason" text,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"collected_by" uuid,
	"closing_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_payments_receipt_uq" UNIQUE("tenant_id","receipt_number"),
	CONSTRAINT "fee_payments_idempotency_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "fee_payments_mode_chk" CHECK ("fee_payments"."mode" in ('cash', 'cheque', 'dd', 'upi', 'card', 'bank_transfer', 'online')),
	CONSTRAINT "fee_payments_status_chk" CHECK ("fee_payments"."status" in ('cleared', 'pending', 'bounced', 'cancelled')),
	CONSTRAINT "fee_payments_amount_chk" CHECK ("fee_payments"."amount" > 0 and "fee_payments"."amount" <= 10000000000)
);
--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."fee_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_line_fk" FOREIGN KEY ("tenant_id","invoice_id","line_id") REFERENCES "public"."fee_invoice_lines"("tenant_id","invoice_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_journal_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."ledger_journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_day_closings" ADD CONSTRAINT "fee_day_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_day_closings" ADD CONSTRAINT "fee_day_closings_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_day_closings" ADD CONSTRAINT "fee_day_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_day_closings" ADD CONSTRAINT "fee_day_closings_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id","student_id") REFERENCES "public"."student_enrollments"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_allocations_payment_idx" ON "fee_allocations" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_line_idx" ON "fee_allocations" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_invoice_idx" ON "fee_allocations" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "fee_payments_student_idx" ON "fee_payments" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_payments_day_idx" ON "fee_payments" USING btree ("tenant_id","campus_id","received_on");