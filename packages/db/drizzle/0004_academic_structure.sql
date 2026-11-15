CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "academic_terms_year_name_uq" UNIQUE("tenant_id","academic_year_id","name"),
	CONSTRAINT "academic_terms_dates_chk" CHECK ("academic_terms"."ends_on" >= "academic_terms"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"weekly_off_days" smallint[] DEFAULT '{0}'::smallint[] NOT NULL,
	"saturday_off_weeks" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_years_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "academic_years_tenant_campus_id_uq" UNIQUE("tenant_id","campus_id","id"),
	CONSTRAINT "academic_years_tenant_campus_name_uq" UNIQUE("tenant_id","campus_id","name"),
	CONSTRAINT "academic_years_dates_chk" CHECK ("academic_years"."ends_on" > "academic_years"."starts_on"),
	CONSTRAINT "academic_years_length_chk" CHECK ("academic_years"."ends_on" <= "academic_years"."starts_on" + interval '18 months'),
	CONSTRAINT "academic_years_status_chk" CHECK ("academic_years"."status" in ('planned', 'active', 'closed')),
	CONSTRAINT "academic_years_current_chk" CHECK (not ("academic_years"."is_current" and "academic_years"."status" = 'closed')),
	CONSTRAINT "academic_years_offdays_chk" CHECK ("academic_years"."weekly_off_days" <@ '{0,1,2,3,4,5,6}'::smallint[] and "academic_years"."saturday_off_weeks" <@ '{1,2,3,4,5}'::smallint[])
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "calendar_events_kind_chk" CHECK ("calendar_events"."kind" in ('holiday', 'vacation', 'event', 'exam')),
	CONSTRAINT "calendar_events_dates_chk" CHECK ("calendar_events"."ends_on" >= "calendar_events"."starts_on"),
	CONSTRAINT "calendar_events_length_chk" CHECK ("calendar_events"."ends_on" - "calendar_events"."starts_on" <= 120)
);
--> statement-breakpoint
CREATE TABLE "class_subjects" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "class_subjects_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "class_subjects_class_subject_uq" UNIQUE("tenant_id","grade_level_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "grade_levels" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stage" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"grading_scale_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_levels_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "grade_levels_tenant_campus_id_uq" UNIQUE("tenant_id","campus_id","id"),
	CONSTRAINT "grade_levels_campus_code_uq" UNIQUE("tenant_id","campus_id","code"),
	CONSTRAINT "grade_levels_campus_name_uq" UNIQUE("tenant_id","campus_id","name"),
	CONSTRAINT "grade_levels_code_chk" CHECK ("grade_levels"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,9}$'),
	CONSTRAINT "grade_levels_stage_chk" CHECK ("grade_levels"."stage" in ('pre_primary', 'primary', 'middle', 'secondary', 'senior_secondary')),
	CONSTRAINT "grade_levels_status_chk" CHECK ("grade_levels"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "grading_bands" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scale_id" uuid NOT NULL,
	"label" text NOT NULL,
	"min_percent" numeric(5, 2) NOT NULL,
	"max_percent" numeric(5, 2) NOT NULL,
	"grade_point" numeric(4, 2),
	"remark" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "grading_bands_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "grading_bands_scale_label_uq" UNIQUE("tenant_id","scale_id","label"),
	CONSTRAINT "grading_bands_range_chk" CHECK ("grading_bands"."min_percent" >= 0 and "grading_bands"."max_percent" <= 100 and "grading_bands"."min_percent" <= "grading_bands"."max_percent")
);
--> statement-breakpoint
CREATE TABLE "grading_scales" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_scales_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "grading_scales_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"grade_level_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"room" text,
	"class_teacher_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sections_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "sections_year_class_name_uq" UNIQUE("tenant_id","academic_year_id","grade_level_id","name"),
	CONSTRAINT "sections_capacity_chk" CHECK ("sections"."capacity" is null or "sections"."capacity" between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'scholastic' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "subjects_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "subjects_code_chk" CHECK ("subjects"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,14}$'),
	CONSTRAINT "subjects_kind_chk" CHECK ("subjects"."kind" in ('scholastic', 'co_scholastic')),
	CONSTRAINT "subjects_status_chk" CHECK ("subjects"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_year_fk" FOREIGN KEY ("tenant_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_fk" FOREIGN KEY ("tenant_id","grade_level_id") REFERENCES "public"."grade_levels"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subjects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_levels" ADD CONSTRAINT "grade_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_levels" ADD CONSTRAINT "grade_levels_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_levels" ADD CONSTRAINT "grade_levels_scale_fk" FOREIGN KEY ("tenant_id","grading_scale_id") REFERENCES "public"."grading_scales"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_scale_fk" FOREIGN KEY ("tenant_id","scale_id") REFERENCES "public"."grading_scales"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_year_fk" FOREIGN KEY ("tenant_id","campus_id","academic_year_id") REFERENCES "public"."academic_years"("tenant_id","campus_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_fk" FOREIGN KEY ("tenant_id","campus_id","grade_level_id") REFERENCES "public"."grade_levels"("tenant_id","campus_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_teacher_fk" FOREIGN KEY ("tenant_id","class_teacher_membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_one_current_uq" ON "academic_years" USING btree ("tenant_id","campus_id") WHERE "academic_years"."is_current";--> statement-breakpoint
CREATE INDEX "calendar_events_range_idx" ON "calendar_events" USING btree ("tenant_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "sections_year_idx" ON "sections" USING btree ("tenant_id","academic_year_id");