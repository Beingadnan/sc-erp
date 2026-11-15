CREATE TABLE "homework" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"given_on" date NOT NULL,
	"due_on" date,
	"title" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"storage_key" text,
	"content_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "homework_status_chk" CHECK ("homework"."status" in ('active', 'removed')),
	CONSTRAINT "homework_due_chk" CHECK ("homework"."due_on" is null or "homework"."due_on" >= "homework"."given_on"),
	CONSTRAINT "homework_title_chk" CHECK (length("homework"."title") between 2 and 200)
);
--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notice_reads_uq" UNIQUE("tenant_id","notice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"grade_level_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"section_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"expires_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "notices_audience_chk" CHECK ("notices"."audience" in ('everyone', 'parents', 'staff')),
	CONSTRAINT "notices_status_chk" CHECK ("notices"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "notices_title_chk" CHECK (length("notices"."title") between 2 and 200)
);
--> statement-breakpoint
CREATE TABLE "period_slots" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"label" text NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"is_break" boolean DEFAULT false NOT NULL,
	CONSTRAINT "period_slots_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "period_slots_seq_uq" UNIQUE("tenant_id","campus_id","seq"),
	CONSTRAINT "period_slots_time_chk" CHECK ("period_slots"."ends_at" > "period_slots"."starts_at"),
	CONSTRAINT "period_slots_seq_chk" CHECK ("period_slots"."seq" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"entry_id" uuid NOT NULL,
	"absent_membership_id" uuid,
	"substitute_membership_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitutions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "substitutions_entry_day_uq" UNIQUE("tenant_id","entry_id","on_date")
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"slot_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"membership_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_entries_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "timetable_entries_cell_uq" UNIQUE("tenant_id","section_id","weekday","slot_id"),
	CONSTRAINT "timetable_entries_weekday_chk" CHECK ("timetable_entries"."weekday" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_section_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."sections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_subject_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subjects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_fk" FOREIGN KEY ("tenant_id","notice_id") REFERENCES "public"."notices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_slots" ADD CONSTRAINT "period_slots_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."timetable_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_substitute_fk" FOREIGN KEY ("tenant_id","substitute_membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."sections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_slot_fk" FOREIGN KEY ("tenant_id","slot_id") REFERENCES "public"."period_slots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."subjects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homework_section_idx" ON "homework" USING btree ("tenant_id","section_id","given_on");--> statement-breakpoint
CREATE INDEX "notices_published_idx" ON "notices" USING btree ("tenant_id","status","published_at");--> statement-breakpoint
CREATE INDEX "substitutions_sub_idx" ON "substitutions" USING btree ("tenant_id","substitute_membership_id","on_date");--> statement-breakpoint
CREATE INDEX "timetable_entries_teacher_idx" ON "timetable_entries" USING btree ("tenant_id","membership_id","weekday","slot_id");