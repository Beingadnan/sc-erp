CREATE TABLE "admission_applications" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"application_number" text NOT NULL,
	"inquiry_id" uuid,
	"source" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" text NOT NULL,
	"previous_school" text,
	"guardian_name" text NOT NULL,
	"guardian_phone" text NOT NULL,
	"guardian_email" "citext",
	"guardian_relationship" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"assessment_at" timestamp with time zone,
	"student_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_applications_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "admission_applications_number_uq" UNIQUE("tenant_id","application_number"),
	CONSTRAINT "admission_applications_student_uq" UNIQUE("tenant_id","student_id"),
	CONSTRAINT "admission_applications_status_chk" CHECK ("admission_applications"."status" in ('submitted','under_review','assessment','approved','waitlisted','rejected','withdrawn','admitted')),
	CONSTRAINT "admission_applications_admitted_chk" CHECK (("admission_applications"."status" = 'admitted') = ("admission_applications"."student_id" is not null)),
	CONSTRAINT "admission_applications_source_chk" CHECK ("admission_applications"."source" in ('website', 'walk_in', 'phone', 'referral', 'other')),
	CONSTRAINT "admission_applications_gender_chk" CHECK ("admission_applications"."gender" in ('male', 'female', 'other')),
	CONSTRAINT "admission_applications_phone_chk" CHECK ("admission_applications"."guardian_phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_events_tenant_id_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid,
	"application_id" uuid,
	"doc_type" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "documents_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "documents_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "documents_owner_chk" CHECK ("documents"."student_id" is not null or "documents"."application_id" is not null),
	CONSTRAINT "documents_type_chk" CHECK ("documents"."doc_type" in ('birth_certificate','transfer_certificate','report_card','photo','address_proof','aadhaar_card','caste_certificate','medical','other')),
	CONSTRAINT "documents_content_type_chk" CHECK ("documents"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "documents_size_chk" CHECK ("documents"."size_bytes" between 1 and 10485760),
	CONSTRAINT "documents_sha_chk" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_year_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_class_fk" FOREIGN KEY ("tenant_id","campus_id","grade_level_id") REFERENCES "public"."grade_levels"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_inquiry_fk" FOREIGN KEY ("tenant_id","inquiry_id") REFERENCES "public"."admission_inquiries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "public"."admission_applications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "public"."admission_applications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_applications_year_status_idx" ON "admission_applications" USING btree ("tenant_id","academic_year_id","status");--> statement-breakpoint
CREATE INDEX "application_events_application_idx" ON "application_events" USING btree ("tenant_id","application_id");--> statement-breakpoint
CREATE INDEX "documents_student_idx" ON "documents" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "documents_application_idx" ON "documents" USING btree ("tenant_id","application_id");