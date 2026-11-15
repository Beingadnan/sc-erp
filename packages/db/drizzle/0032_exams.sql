CREATE TABLE "exam_mark_submissions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_mark_submissions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "exam_mark_submissions_uq" UNIQUE("tenant_id","paper_id","section_id")
);
--> statement-breakpoint
CREATE TABLE "exam_marks" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"marks" numeric(6, 1),
	"status" text DEFAULT 'present' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_marks_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "exam_marks_student_uq" UNIQUE("tenant_id","paper_id","enrollment_id"),
	CONSTRAINT "exam_marks_status_chk" CHECK ("exam_marks"."status" in ('present', 'absent', 'medical', 'exempt')),
	CONSTRAINT "exam_marks_value_chk" CHECK (("exam_marks"."status" = 'present' and "exam_marks"."marks" is not null and "exam_marks"."marks" >= 0) or ("exam_marks"."status" <> 'present' and "exam_marks"."marks" is null))
);
--> statement-breakpoint
CREATE TABLE "exam_papers" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"exam_date" date,
	"starts_at" time,
	"max_marks" integer NOT NULL,
	"pass_marks" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exam_papers_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "exam_papers_subject_uq" UNIQUE("tenant_id","exam_id","grade_level_id","subject_id"),
	CONSTRAINT "exam_papers_marks_chk" CHECK ("exam_papers"."max_marks" between 1 and 1000 and "exam_papers"."pass_marks" between 0 and "exam_papers"."max_marks")
);
--> statement-breakpoint
CREATE TABLE "exam_remarks" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"remark" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_remarks_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "exam_remarks_uq" UNIQUE("tenant_id","exam_id","enrollment_id"),
	CONSTRAINT "exam_remarks_len_chk" CHECK (char_length("exam_remarks"."remark") between 1 and 400)
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"term_id" uuid,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "exams_name_uq" UNIQUE("tenant_id","campus_id","academic_year_id","name"),
	CONSTRAINT "exams_status_chk" CHECK ("exams"."status" in ('draft', 'open', 'published')),
	CONSTRAINT "exams_dates_chk" CHECK ("exams"."starts_on" is null or "exams"."ends_on" is null or "exams"."ends_on" >= "exams"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "exam_mark_submissions" ADD CONSTRAINT "exam_mark_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_mark_submissions" ADD CONSTRAINT "exam_mark_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_mark_submissions" ADD CONSTRAINT "exam_mark_submissions_paper_fk" FOREIGN KEY ("tenant_id","paper_id") REFERENCES "public"."exam_papers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_mark_submissions" ADD CONSTRAINT "exam_mark_submissions_section_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."sections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_paper_fk" FOREIGN KEY ("tenant_id","paper_id") REFERENCES "public"."exam_papers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."student_enrollments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_exam_fk" FOREIGN KEY ("tenant_id","exam_id") REFERENCES "public"."exams"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_class_fk" FOREIGN KEY ("tenant_id","grade_level_id") REFERENCES "public"."grade_levels"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_subject_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subjects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_remarks" ADD CONSTRAINT "exam_remarks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_remarks" ADD CONSTRAINT "exam_remarks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_remarks" ADD CONSTRAINT "exam_remarks_exam_fk" FOREIGN KEY ("tenant_id","exam_id") REFERENCES "public"."exams"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_remarks" ADD CONSTRAINT "exam_remarks_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."student_enrollments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_year_fk" FOREIGN KEY ("tenant_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_term_fk" FOREIGN KEY ("tenant_id","term_id") REFERENCES "public"."academic_terms"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_marks_enrollment_idx" ON "exam_marks" USING btree ("tenant_id","enrollment_id");