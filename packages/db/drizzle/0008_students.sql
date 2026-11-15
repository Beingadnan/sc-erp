CREATE TABLE "admission_number_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"pattern" text DEFAULT '{SEQ:4}' NOT NULL,
	"per_campus" boolean DEFAULT false NOT NULL,
	"yearly_reset" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_number_settings_pattern_chk" CHECK ("admission_number_settings"."pattern" ~ '\{SEQ:[1-9]\}')
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" "citext",
	"occupation" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "guardians_phone_chk" CHECK ("guardians"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "number_counters" (
	"tenant_id" uuid NOT NULL,
	"counter_key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_counters_pk" PRIMARY KEY("tenant_id","counter_key"),
	CONSTRAINT "number_counters_value_chk" CHECK ("number_counters"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"student_id" uuid,
	"notice_version" text NOT NULL,
	"channel" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	CONSTRAINT "privacy_acknowledgements_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "privacy_ack_channel_chk" CHECK ("privacy_acknowledgements"."channel" in ('in_person', 'web', 'app', 'phone'))
);
--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"roll_number" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"enrolled_on" date NOT NULL,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_enrollments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_enrollments_student_year_uq" UNIQUE("tenant_id","student_id","academic_year_id"),
	CONSTRAINT "student_enrollments_status_chk" CHECK ("student_enrollments"."status" in ('active', 'promoted', 'completed', 'withdrawn')),
	CONSTRAINT "student_enrollments_roll_chk" CHECK ("student_enrollments"."roll_number" is null or "student_enrollments"."roll_number" between 1 and 999),
	CONSTRAINT "student_enrollments_left_chk" CHECK ("student_enrollments"."left_on" is null or "student_enrollments"."left_on" >= "student_enrollments"."enrolled_on")
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_fee_payer" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_guardians_pk" PRIMARY KEY("tenant_id","student_id","guardian_id"),
	CONSTRAINT "student_guardians_relationship_chk" CHECK ("student_guardians"."relationship" in ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'))
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"admission_number" text NOT NULL,
	"admission_date" date NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"name_local" text,
	"date_of_birth" date NOT NULL,
	"gender" text NOT NULL,
	"blood_group" text,
	"address" text,
	"pen" text,
	"apaar_id" text,
	"aadhaar_sealed" text,
	"aadhaar_last4" text,
	"aadhaar_index" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "students_tenant_admission_no_uq" UNIQUE("tenant_id","admission_number"),
	CONSTRAINT "students_gender_chk" CHECK ("students"."gender" in ('male', 'female', 'other')),
	CONSTRAINT "students_status_chk" CHECK ("students"."status" in ('active', 'withdrawn', 'alumni')),
	CONSTRAINT "students_pen_chk" CHECK ("students"."pen" is null or "students"."pen" ~ '^[0-9]{11}$'),
	CONSTRAINT "students_apaar_chk" CHECK ("students"."apaar_id" is null or "students"."apaar_id" ~ '^[0-9]{12}$'),
	CONSTRAINT "students_aadhaar_chk" CHECK (("students"."aadhaar_sealed" is null and "students"."aadhaar_last4" is null and "students"."aadhaar_index" is null)
          or ("students"."aadhaar_sealed" is not null and "students"."aadhaar_last4" ~ '^[0-9]{4}$' and "students"."aadhaar_index" is not null)),
	CONSTRAINT "students_blood_chk" CHECK ("students"."blood_group" is null or "students"."blood_group" in ('A+','A-','B+','B-','AB+','AB-','O+','O-'))
);
--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_campus_year_id_uq" UNIQUE("tenant_id","campus_id","academic_year_id","id");--> statement-breakpoint
ALTER TABLE "admission_number_settings" ADD CONSTRAINT "admission_number_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_counters" ADD CONSTRAINT "number_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ADD CONSTRAINT "privacy_acknowledgements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ADD CONSTRAINT "privacy_acknowledgements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ADD CONSTRAINT "privacy_ack_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id") REFERENCES "public"."guardians"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_acknowledgements" ADD CONSTRAINT "privacy_ack_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id","section_id") REFERENCES "public"."sections"("tenant_id","campus_id","academic_year_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id") REFERENCES "public"."guardians"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardians_tenant_phone_idx" ON "guardians" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "privacy_acknowledgements_guardian_idx" ON "privacy_acknowledgements" USING btree ("tenant_id","guardian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_enrollments_roll_uq" ON "student_enrollments" USING btree ("tenant_id","section_id","roll_number") WHERE "student_enrollments"."roll_number" is not null and "student_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "student_enrollments_section_idx" ON "student_enrollments" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_one_primary_uq" ON "student_guardians" USING btree ("tenant_id","student_id") WHERE "student_guardians"."is_primary";--> statement-breakpoint
CREATE INDEX "student_guardians_guardian_idx" ON "student_guardians" USING btree ("tenant_id","guardian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_tenant_pen_uq" ON "students" USING btree ("tenant_id","pen") WHERE "students"."pen" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "students_tenant_apaar_uq" ON "students" USING btree ("tenant_id","apaar_id") WHERE "students"."apaar_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "students_tenant_aadhaar_uq" ON "students" USING btree ("tenant_id","aadhaar_index") WHERE "students"."aadhaar_index" is not null;--> statement-breakpoint
CREATE INDEX "students_tenant_name_idx" ON "students" USING btree ("tenant_id","first_name","last_name");
