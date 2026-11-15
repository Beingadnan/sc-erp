CREATE TABLE "setup_imports" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"file_name" text NOT NULL,
	"plan" jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	CONSTRAINT "setup_imports_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "setup_imports_status_chk" CHECK ("setup_imports"."status" in ('previewed', 'applied', 'undone', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "setup_imports" ADD CONSTRAINT "setup_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_imports" ADD CONSTRAINT "setup_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_imports" ADD CONSTRAINT "setup_imports_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_imports" ADD CONSTRAINT "setup_imports_year_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_imports_tenant_created_idx" ON "setup_imports" USING btree ("tenant_id","created_at");