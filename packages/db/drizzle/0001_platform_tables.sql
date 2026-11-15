CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"campus_id" uuid,
	"diff" jsonb,
	"request_id" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_chk" CHECK ("audit_logs"."actor_type" in ('user', 'system', 'platform'))
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_ref" uuid,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_purpose_chk" CHECK ("auth_tokens"."purpose" in ('verify_email', 'reset_password', 'invite'))
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"board" text NOT NULL,
	"udise_code" text,
	"address" text,
	"phone" text,
	"email" "citext",
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campuses_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "campuses_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "campuses_status_chk" CHECK ("campuses"."status" in ('active', 'archived')),
	CONSTRAINT "campuses_board_chk" CHECK ("campuses"."board" in ('CBSE', 'RBSE', 'CISCE', 'STATE_OTHER', 'IB', 'CAMBRIDGE', 'OTHER')),
	CONSTRAINT "campuses_udise_chk" CHECK ("campuses"."udise_code" is null or "campuses"."udise_code" ~ '^[0-9]{11}$'),
	CONSTRAINT "campuses_code_chk" CHECK ("campuses"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$')
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"campus_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "membership_roles_assignment_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","membership_id","role_id","campus_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_pending_tenants" (
	"tenant_ref" uuid PRIMARY KEY NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_role_chk" CHECK ("platform_admins"."role" in ('super_admin', 'support', 'operations'))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_tenant_id_role_id_permission_key_pk" PRIMARY KEY("tenant_id","role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "roles_tenant_key_uq" UNIQUE("tenant_id","key"),
	CONSTRAINT "roles_key_chk" CHECK ("roles"."key" ~ '^[a-z][a-z0-9_]{1,49}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_hash" "bytea" NOT NULL,
	"active_tenant_id" uuid,
	"mfa_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "system_role_template_permissions" (
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "system_role_template_permissions_role_key_permission_key_pk" PRIMARY KEY("role_key","permission_key")
);
--> statement-breakpoint
CREATE TABLE "system_role_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_memberships_tenant_user_uq" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "tenant_memberships_status_chk" CHECK ("tenant_memberships"."status" in ('invited', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"slug" "citext" NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"default_timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"default_currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_status_chk" CHECK ("tenants"."status" in ('active', 'suspended', 'closed')),
	CONSTRAINT "tenants_slug_chk" CHECK ("tenants"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$')
);
--> statement-breakpoint
CREATE TABLE "user_memberships_index" (
	"user_id" uuid NOT NULL,
	"tenant_ref" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "user_memberships_index_user_id_tenant_ref_pk" PRIMARY KEY("user_id","tenant_ref")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"email" "citext" NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"mfa_secret_enc" text,
	"mfa_enabled_at" timestamp with time zone,
	"mfa_last_step" bigint,
	"mfa_recovery_hashes" text[],
	"status" text DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_status_chk" CHECK ("users"."status" in ('active', 'disabled')),
	CONSTRAINT "users_phone_chk" CHECK ("users"."phone" is null or "users"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_tenant_ref_tenants_id_fk" FOREIGN KEY ("tenant_ref") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_membership_id_tenant_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_role_id_roles_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_campus_id_campuses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_pending_tenants" ADD CONSTRAINT "outbox_pending_tenants_tenant_ref_tenants_id_fk" FOREIGN KEY ("tenant_ref") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_roles_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_role_template_permissions" ADD CONSTRAINT "system_role_template_permissions_role_key_system_role_templates_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."system_role_templates"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_role_template_permissions" ADD CONSTRAINT "system_role_template_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships_index" ADD CONSTRAINT "user_memberships_index_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships_index" ADD CONSTRAINT "user_memberships_index_tenant_ref_tenants_id_fk" FOREIGN KEY ("tenant_ref") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs" USING btree ("tenant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "membership_roles_membership_idx" ON "membership_roles" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("tenant_id","created_at") WHERE "outbox_events"."dispatched_at" is null;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");