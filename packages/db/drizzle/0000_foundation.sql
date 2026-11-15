-- 0000_foundation: extensions, helper schema, tenant-context functions, application role.
-- Runs as the OWNER role (Neon: neondb_owner) over the DIRECT connection.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- Time-ordered UUIDv7 for server-side defaults (the app also generates v7 ids).
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  ts bytea := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  b  bytea := ts || public.gen_random_bytes(10);
BEGIN
  b := set_byte(b, 6, (b'0111' || get_byte(b, 6)::bit(4))::bit(8)::int);
  b := set_byte(b, 8, (b'10'   || get_byte(b, 8)::bit(6))::bit(8)::int);
  RETURN encode(b, 'hex')::uuid;
END
$$;
--> statement-breakpoint

-- Tenant context. Set ONLY via set_config(..., true) inside a transaction (withTenant).
-- Missing or empty -> NULL -> RLS policies match nothing (default deny).
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Applies the standard tenant-isolation policy to a table. Used by every migration
-- that creates a tenant-owned table:  SELECT app.enable_tenant_rls('students');
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING (tenant_id = app.current_tenant_id())
       WITH CHECK (tenant_id = app.current_tenant_id())',
    tbl);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.enable_tenant_rls(regclass) FROM PUBLIC;
--> statement-breakpoint

-- Application role: no login until `pnpm db:setup-app-role` sets a password.
-- NOBYPASSRLS, not superuser, owns nothing, cannot run DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO erp_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO erp_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.current_tenant_id(), app.current_user_id() TO erp_app;
--> statement-breakpoint

-- Every table/sequence the owner creates from now on is usable (DML only) by erp_app.
-- RLS still decides which rows.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
