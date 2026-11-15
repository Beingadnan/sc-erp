CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"designation" text DEFAULT '' NOT NULL,
	"employee_code" text,
	"phone" text,
	"joined_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_profiles_membership_uq" UNIQUE("tenant_id","membership_id"),
	CONSTRAINT "staff_profiles_phone_chk" CHECK ("staff_profiles"."phone" is null or "staff_profiles"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "teaching_assignments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_assignments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "teaching_assignments_uq" UNIQUE("tenant_id","section_id","subject_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_section_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."sections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_subject_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subjects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_code_uq" ON "staff_profiles" USING btree ("tenant_id","employee_code") WHERE "staff_profiles"."employee_code" is not null;--> statement-breakpoint
CREATE INDEX "teaching_assignments_teacher_idx" ON "teaching_assignments" USING btree ("tenant_id","membership_id");