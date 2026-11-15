CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "custom_field_definitions_key_uq" UNIQUE("tenant_id","entity","key"),
	CONSTRAINT "custom_field_definitions_entity_chk" CHECK ("custom_field_definitions"."entity" in ('student', 'guardian')),
	CONSTRAINT "custom_field_definitions_key_chk" CHECK ("custom_field_definitions"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "custom_field_definitions_type_chk" CHECK ("custom_field_definitions"."field_type" in ('text', 'number', 'date', 'select')),
	CONSTRAINT "custom_field_definitions_options_chk" CHECK (("custom_field_definitions"."field_type" = 'select') = (cardinality("custom_field_definitions"."options") > 0))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"kind" text DEFAULT 'students' NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"file_name" text NOT NULL,
	"total_rows" integer NOT NULL,
	"valid_rows" integer NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_jobs_kind_chk" CHECK ("import_jobs"."kind" in ('students')),
	CONSTRAINT "import_jobs_status_chk" CHECK ("import_jobs"."status" in ('previewed', 'processing', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "transfer_certificates" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"tc_number" text NOT NULL,
	"issued_on" date NOT NULL,
	"details" jsonb NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"cancelled_reason" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "transfer_certificates_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "transfer_certificates_number_uq" UNIQUE("tenant_id","tc_number"),
	CONSTRAINT "transfer_certificates_status_chk" CHECK ("transfer_certificates"."status" in ('issued', 'cancelled')),
	CONSTRAINT "transfer_certificates_cancel_chk" CHECK (("transfer_certificates"."status" = 'cancelled') = ("transfer_certificates"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD COLUMN "exit_reason" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_year_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created_idx" ON "import_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_certificates_one_issued_uq" ON "transfer_certificates" USING btree ("tenant_id","student_id") WHERE "transfer_certificates"."status" = 'issued';