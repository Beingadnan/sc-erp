CREATE TABLE "portal_invites" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"purpose" text DEFAULT 'activate' NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"phone" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "portal_invites_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "portal_invites_purpose_chk" CHECK ("portal_invites"."purpose" in ('activate', 'reset')),
	CONSTRAINT "portal_invites_phone_chk" CHECK ("portal_invites"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_phone" text;--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id") REFERENCES "public"."guardians"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_invites_guardian_idx" ON "portal_invites" USING btree ("tenant_id","guardian_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_phone_unique" UNIQUE("login_phone");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_phone_chk" CHECK ("users"."login_phone" is null or "users"."login_phone" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_identity_chk" CHECK ("users"."email" is not null or "users"."login_phone" is not null);