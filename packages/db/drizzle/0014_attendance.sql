CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_tenant_id_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"period" smallint DEFAULT 0 NOT NULL,
	"marked_by" uuid,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sessions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_sessions_slot_uq" UNIQUE("tenant_id","section_id","on_date","period"),
	CONSTRAINT "attendance_sessions_period_chk" CHECK ("attendance_sessions"."period" between 0 and 12)
);
--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"mode" text DEFAULT 'daily' NOT NULL,
	"periods_per_day" smallint DEFAULT 8 NOT NULL,
	"cutoff_hours" smallint DEFAULT 12 NOT NULL,
	"low_threshold" smallint DEFAULT 75 NOT NULL,
	"leave_counts_as" text DEFAULT 'excluded' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_settings_campus_uq" UNIQUE("tenant_id","campus_id"),
	CONSTRAINT "attendance_settings_mode_chk" CHECK ("attendance_settings"."mode" in ('daily', 'period')),
	CONSTRAINT "attendance_settings_periods_chk" CHECK ("attendance_settings"."periods_per_day" between 1 and 12),
	CONSTRAINT "attendance_settings_cutoff_chk" CHECK ("attendance_settings"."cutoff_hours" between 0 and 168),
	CONSTRAINT "attendance_settings_threshold_chk" CHECK ("attendance_settings"."low_threshold" between 1 and 100),
	CONSTRAINT "attendance_settings_leave_chk" CHECK ("attendance_settings"."leave_counts_as" in ('absent', 'excluded'))
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"requested_via" text DEFAULT 'office' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recorded_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"days" integer GENERATED ALWAYS AS (to_date - from_date + 1) STORED,
	CONSTRAINT "leave_requests_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_requests_dates_chk" CHECK ("leave_requests"."to_date" >= "leave_requests"."from_date" and "leave_requests"."to_date" - "leave_requests"."from_date" <= 60),
	CONSTRAINT "leave_requests_status_chk" CHECK ("leave_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_via_chk" CHECK ("leave_requests"."requested_via" in ('office', 'phone', 'parent_app'))
);
--> statement-breakpoint
CREATE TABLE "student_attendance" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"status" text NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	CONSTRAINT "student_attendance_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_attendance_session_enrollment_uq" UNIQUE("tenant_id","session_id","enrollment_id"),
	CONSTRAINT "student_attendance_status_chk" CHECK ("student_attendance"."status" in ('present', 'absent', 'late', 'half_day', 'leave')),
	CONSTRAINT "student_attendance_remark_chk" CHECK (length("student_attendance"."remark") <= 200)
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_record_fk" FOREIGN KEY ("tenant_id","record_id") REFERENCES "public"."student_attendance"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id","section_id") REFERENCES "public"."sections"("tenant_id","campus_id","academic_year_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_year_fk" FOREIGN KEY ("tenant_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_session_fk" FOREIGN KEY ("tenant_id","session_id") REFERENCES "public"."attendance_sessions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."student_enrollments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_record_idx" ON "attendance_corrections" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_campus_date_idx" ON "attendance_sessions" USING btree ("tenant_id","campus_id","on_date");--> statement-breakpoint
CREATE INDEX "leave_requests_student_idx" ON "leave_requests" USING btree ("tenant_id","student_id","from_date");--> statement-breakpoint
CREATE INDEX "student_attendance_enrollment_date_idx" ON "student_attendance" USING btree ("tenant_id","enrollment_id","on_date");--> statement-breakpoint
CREATE INDEX "student_attendance_student_date_idx" ON "student_attendance" USING btree ("tenant_id","student_id","on_date");