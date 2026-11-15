CREATE TABLE "admission_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campus_id" uuid,
	"parent_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"student_name" text,
	"class_sought" text,
	"message" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_inquiries_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "admission_inquiries_source_chk" CHECK ("admission_inquiries"."source" in ('website', 'walk_in', 'phone', 'referral', 'other')),
	CONSTRAINT "admission_inquiries_status_chk" CHECK ("admission_inquiries"."status" in ('new', 'contacted', 'closed')),
	CONSTRAINT "admission_inquiries_phone_chk" CHECK ("admission_inquiries"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "admission_inquiries_message_len_chk" CHECK (length("admission_inquiries"."message") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "cms_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_page_versions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cms_page_versions_page_version_uq" UNIQUE("tenant_id","page_id","version"),
	CONSTRAINT "cms_page_versions_body_len_chk" CHECK (length("cms_page_versions"."body") <= 50000)
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"published_version_id" uuid,
	"show_in_nav" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_pages_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cms_pages_tenant_slug_uq" UNIQUE("tenant_id","slug"),
	CONSTRAINT "cms_pages_slug_chk" CHECK ("cms_pages"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$')
);
--> statement-breakpoint
ALTER TABLE "admission_inquiries" ADD CONSTRAINT "admission_inquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_inquiries" ADD CONSTRAINT "admission_inquiries_campus_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_versions" ADD CONSTRAINT "cms_page_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_versions" ADD CONSTRAINT "cms_page_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_versions" ADD CONSTRAINT "cms_page_versions_page_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."cms_pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_inquiries_tenant_created_idx" ON "admission_inquiries" USING btree ("tenant_id","created_at" DESC NULLS LAST);