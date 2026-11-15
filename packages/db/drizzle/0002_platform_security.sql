-- 0002_platform_security: privileges, Row-Level Security, triggers, SECURITY DEFINER
-- functions and seed data for the platform tables created in 0001.
--
-- Principles
--  * erp_app gets the least privilege needed; default privileges from 0000 are narrowed here.
--  * Tenant tables: app.enable_tenant_rls() (ENABLE + FORCE + tenant policy).
--  * Global tables: RLS ENABLED (not forced). erp_app sees only rows allowed by explicit
--    policies; cross-tenant work (login, sign-up, provisioning, outbox relay, platform admin)
--    goes through the SECURITY DEFINER functions below, each doing exactly one job.
--  * Definer functions run as the owner. The owner bypasses RLS on global tables (not
--    forced) but is still bound by FORCE RLS on tenant tables, so functions that write
--    tenant rows set the tenant context explicitly and restore it.

-- ============================== tenant tables ==============================
SELECT app.enable_tenant_rls('campuses');
--> statement-breakpoint
SELECT app.enable_tenant_rls('tenant_memberships');
--> statement-breakpoint
SELECT app.enable_tenant_rls('roles');
--> statement-breakpoint
SELECT app.enable_tenant_rls('role_permissions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('membership_roles');
--> statement-breakpoint
SELECT app.enable_tenant_rls('audit_logs');
--> statement-breakpoint
SELECT app.enable_tenant_rls('outbox_events');
--> statement-breakpoint

-- Membership identity never changes; only status does.
REVOKE UPDATE ON tenant_memberships FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, updated_at) ON tenant_memberships TO erp_app;
--> statement-breakpoint
-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM erp_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON outbox_events FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE ON outbox_events FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (dispatched_at, attempts) ON outbox_events TO erp_app;
--> statement-breakpoint

-- ============================== global tables ==============================
-- users: own row + users who are members of the current tenant. Secrets are column-restricted.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON users FROM erp_app;
--> statement-breakpoint
GRANT SELECT (id, email, full_name, phone, email_verified_at, mfa_enabled_at, status,
              last_login_at, created_at, updated_at) ON users TO erp_app;
--> statement-breakpoint
GRANT UPDATE (full_name, phone, password_hash, mfa_secret_enc, mfa_enabled_at, mfa_last_step,
              mfa_recovery_hashes, updated_at) ON users TO erp_app;
--> statement-breakpoint
CREATE POLICY users_self_select ON users FOR SELECT USING (id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY users_same_tenant_select ON users FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = users.id));
--> statement-breakpoint
CREATE POLICY users_self_update ON users FOR UPDATE
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
--> statement-breakpoint

-- tenants: only the current tenant is visible; a few columns are editable by the app.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON tenants FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON tenants TO erp_app;
--> statement-breakpoint
GRANT UPDATE (name, default_timezone, updated_at) ON tenants TO erp_app;
--> statement-breakpoint
CREATE POLICY tenants_current_select ON tenants FOR SELECT USING (id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenants_current_update ON tenants FOR UPDATE
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());
--> statement-breakpoint

-- sessions: a user may list and revoke their own sessions; creation/lookup via functions.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON sessions FROM erp_app;
--> statement-breakpoint
GRANT SELECT (id, user_id, active_tenant_id, mfa_pending, created_at, last_seen_at, expires_at,
              revoked_at, ip, user_agent) ON sessions TO erp_app;
--> statement-breakpoint
GRANT UPDATE (active_tenant_id, mfa_pending, revoked_at) ON sessions TO erp_app;
--> statement-breakpoint
CREATE POLICY sessions_own_select ON sessions FOR SELECT USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY sessions_own_update ON sessions FOR UPDATE
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint

-- Function-only tables: no direct access at all.
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_memberships_index ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_pending_tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON platform_admins, auth_tokens, user_memberships_index, outbox_pending_tenants FROM erp_app;
--> statement-breakpoint

-- Read-only catalogues.
REVOKE ALL ON permissions, system_role_templates, system_role_template_permissions FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON permissions, system_role_templates, system_role_template_permissions TO erp_app;
--> statement-breakpoint

-- ============================== triggers ==============================
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER campuses_updated_at BEFORE UPDATE ON campuses FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenant_memberships_updated_at BEFORE UPDATE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

CREATE FUNCTION app.trg_membership_index() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.user_memberships_index WHERE user_id = OLD.user_id AND tenant_ref = OLD.tenant_id;
    RETURN OLD;
  END IF;
  INSERT INTO public.user_memberships_index (user_id, tenant_ref, membership_id, status)
  VALUES (NEW.user_id, NEW.tenant_id, NEW.id, NEW.status)
  ON CONFLICT (user_id, tenant_ref)
  DO UPDATE SET membership_id = EXCLUDED.membership_id, status = EXCLUDED.status;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenant_memberships_index AFTER INSERT OR UPDATE OR DELETE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION app.trg_membership_index();
--> statement-breakpoint

CREATE FUNCTION app.trg_outbox_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.outbox_pending_tenants (tenant_ref, pending_count) VALUES (NEW.tenant_id, 1)
  ON CONFLICT (tenant_ref) DO UPDATE SET pending_count = outbox_pending_tenants.pending_count + 1;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_pending AFTER INSERT ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION app.trg_outbox_pending();
--> statement-breakpoint

-- ============================== auth functions ==============================
CREATE FUNCTION app.auth_create_user(p_email text, p_full_name text, p_password_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.users (email, full_name, password_hash)
  VALUES (p_email, p_full_name, p_password_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.auth_find_user(p_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT id FROM public.users WHERE email = p_email::citext
$$;
--> statement-breakpoint

CREATE FUNCTION app.auth_user_for_login(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, status text, locked_until timestamptz, mfa_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT id, password_hash, status, locked_until, mfa_enabled_at IS NOT NULL
    FROM public.users WHERE email = p_email::citext
$$;
--> statement-breakpoint

-- Counts failures; locks the account for p_lock after p_max consecutive failures.
CREATE FUNCTION app.auth_record_login(p_user_id uuid, p_success boolean, p_max integer, p_lock interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_max < 3 OR p_max > 20 OR p_lock < interval '1 minute' OR p_lock > interval '1 day' THEN
    RAISE EXCEPTION 'invalid lockout parameters';
  END IF;
  IF p_success THEN
    UPDATE public.users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
     WHERE id = p_user_id;
  ELSE
    UPDATE public.users
       SET failed_login_count = CASE WHEN failed_login_count + 1 >= p_max THEN 0 ELSE failed_login_count + 1 END,
           locked_until = CASE WHEN failed_login_count + 1 >= p_max THEN now() + p_lock ELSE locked_until END
     WHERE id = p_user_id;
  END IF;
END
$$;
--> statement-breakpoint

-- Secrets for the CURRENT user only (password change, MFA).
CREATE FUNCTION app.auth_user_secrets(p_user_id uuid)
RETURNS TABLE (password_hash text, mfa_secret_enc text, mfa_enabled boolean, mfa_last_step bigint, mfa_recovery_hashes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'secrets are only available for the current user' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT u.password_hash, u.mfa_secret_enc, u.mfa_enabled_at IS NOT NULL, u.mfa_last_step, u.mfa_recovery_hashes
                 FROM public.users u WHERE u.id = p_user_id;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.session_create(
  p_user_id uuid, p_token_hash bytea, p_csrf_hash bytea, p_ttl interval, p_ip inet, p_user_agent text,
  p_active_tenant uuid, p_mfa_pending boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_ttl > interval '30 days' THEN RAISE EXCEPTION 'session ttl too long'; END IF;
  IF p_active_tenant IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_memberships_index
        WHERE user_id = p_user_id AND tenant_ref = p_active_tenant AND status = 'active') THEN
    p_active_tenant := NULL;
  END IF;
  INSERT INTO public.sessions (user_id, token_hash, csrf_hash, active_tenant_id, mfa_pending, expires_at, ip, user_agent)
  VALUES (p_user_id, p_token_hash, p_csrf_hash, p_active_tenant, p_mfa_pending, now() + p_ttl, p_ip, left(p_user_agent, 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Resolves a presented session token. Expired, revoked, idle or disabled-user sessions resolve to nothing.
CREATE FUNCTION app.session_resolve(p_token_hash bytea, p_idle interval)
RETURNS TABLE (session_id uuid, user_id uuid, active_tenant_id uuid, csrf_hash bytea, mfa_pending boolean, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.sessions s
     SET last_seen_at = CASE WHEN s.last_seen_at < now() - interval '1 minute' THEN now() ELSE s.last_seen_at END
    FROM public.users u
   WHERE s.token_hash = p_token_hash
     AND u.id = s.user_id AND u.status = 'active'
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.last_seen_at > now() - p_idle
  RETURNING s.id, s.user_id, s.active_tenant_id, s.csrf_hash, s.mfa_pending, s.expires_at;
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.auth_token_create(p_user_id uuid, p_purpose text, p_token_hash bytea, p_ttl interval, p_tenant_ref uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_ttl > interval '14 days' THEN RAISE EXCEPTION 'token ttl too long'; END IF;
  UPDATE public.auth_tokens SET consumed_at = now()
   WHERE user_id = p_user_id AND purpose = p_purpose AND consumed_at IS NULL
     AND tenant_ref IS NOT DISTINCT FROM p_tenant_ref;
  INSERT INTO public.auth_tokens (user_id, tenant_ref, purpose, token_hash, expires_at)
  VALUES (p_user_id, p_tenant_ref, p_purpose, p_token_hash, now() + p_ttl);
END
$$;
--> statement-breakpoint

-- Internal: atomically consumes a valid token and returns (user, tenant).
CREATE FUNCTION app._consume_token(p_purpose text, p_token_hash bytea, OUT o_user uuid, OUT o_tenant uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.auth_tokens SET consumed_at = now()
   WHERE token_hash = p_token_hash AND purpose = p_purpose AND consumed_at IS NULL AND expires_at > now()
  RETURNING user_id, tenant_ref INTO o_user, o_tenant;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app._consume_token(text, bytea) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION app.auth_verify_email(p_token_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_tenant uuid;
BEGIN
  SELECT o_user, o_tenant INTO v_user, v_tenant FROM app._consume_token('verify_email', p_token_hash);
  IF v_user IS NOT NULL THEN
    UPDATE public.users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = v_user;
  END IF;
  RETURN v_user;
END
$$;
--> statement-breakpoint

-- Consumes a reset token, sets the password, clears lockout, and revokes every session.
CREATE FUNCTION app.auth_reset_password(p_token_hash bytea, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_tenant uuid;
BEGIN
  SELECT o_user, o_tenant INTO v_user, v_tenant FROM app._consume_token('reset_password', p_token_hash);
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE public.users
     SET password_hash = p_password_hash, failed_login_count = 0, locked_until = NULL,
         email_verified_at = coalesce(email_verified_at, now())
   WHERE id = v_user;
  UPDATE public.sessions SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;
  RETURN v_user;
END
$$;
--> statement-breakpoint

-- Revokes all sessions of the current user except one (after a password change).
CREATE FUNCTION app.session_revoke_others(p_keep_session uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count integer;
BEGIN
  IF app.current_user_id() IS NULL THEN RAISE EXCEPTION 'no current user' USING ERRCODE = '42501'; END IF;
  UPDATE public.sessions SET revoked_at = now()
   WHERE user_id = app.current_user_id() AND revoked_at IS NULL AND id IS DISTINCT FROM p_keep_session;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint

-- Accepts an invitation: sets the first password of a password-less user, verifies the
-- email and activates the invited membership in the inviting tenant.
CREATE FUNCTION app.auth_accept_invite(p_token_hash bytea, p_password_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_tenant uuid; v_prev text := current_setting('app.tenant_id', true);
BEGIN
  SELECT o_user, o_tenant INTO v_user, v_tenant FROM app._consume_token('invite', p_token_hash);
  IF v_user IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  UPDATE public.users
     SET password_hash = coalesce(password_hash, p_password_hash),
         email_verified_at = coalesce(email_verified_at, now())
   WHERE id = v_user;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  UPDATE public.tenant_memberships SET status = 'active'
   WHERE tenant_memberships.tenant_id = v_tenant AND tenant_memberships.user_id = v_user AND status = 'invited';
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  user_id := v_user; tenant_id := v_tenant;
  RETURN NEXT;
END
$$;
--> statement-breakpoint

-- Tenants the CURRENT user belongs to (tenant switcher).
CREATE FUNCTION app.user_tenants(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, slug text, name text, tenant_status text, membership_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'only the current user''s tenants can be listed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, t.slug::text, t.name, t.status, i.status
      FROM public.user_memberships_index i JOIN public.tenants t ON t.id = i.tenant_ref
     WHERE i.user_id = p_user_id
     ORDER BY t.name;
END
$$;
--> statement-breakpoint

-- ============================== provisioning ==============================
CREATE FUNCTION app.tenant_provision(
  p_owner_user_id uuid, p_slug text, p_name text, p_campus_code text, p_campus_name text,
  p_board text, p_timezone text, p_request_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant uuid := app.uuid_v7();
  v_membership uuid := app.uuid_v7();
  v_owner_role uuid;
  v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF p_owner_user_id IS NULL OR p_owner_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'the owner must be the current user' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.tenants (id, slug, name, default_timezone)
  VALUES (v_tenant, lower(p_slug), p_name, p_timezone);

  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  INSERT INTO public.campuses (tenant_id, code, name, board, timezone)
  VALUES (v_tenant, upper(p_campus_code), p_campus_name, p_board, p_timezone);
  INSERT INTO public.roles (tenant_id, key, name, description, is_system)
    SELECT v_tenant, t.key, t.name, t.description, true FROM public.system_role_templates t;
  INSERT INTO public.role_permissions (tenant_id, role_id, permission_key)
    SELECT v_tenant, r.id, tp.permission_key
      FROM public.roles r JOIN public.system_role_template_permissions tp ON tp.role_key = r.key
     WHERE r.tenant_id = v_tenant;
  INSERT INTO public.tenant_memberships (id, tenant_id, user_id, status)
  VALUES (v_membership, v_tenant, p_owner_user_id, 'active');
  SELECT id INTO v_owner_role FROM public.roles WHERE roles.tenant_id = v_tenant AND key = 'owner';
  INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, campus_id)
  VALUES (v_tenant, v_membership, v_owner_role, NULL);
  INSERT INTO public.audit_logs (tenant_id, actor_user_id, actor_type, action, entity, entity_id, request_id)
  VALUES (v_tenant, p_owner_user_id, 'user', 'tenant.provisioned', 'tenant', v_tenant, p_request_id);
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v_tenant;
END
$$;
--> statement-breakpoint

-- Brings every tenant's system roles in line with the templates (run by migrations that
-- change templates). Owner-only: not granted to erp_app.
CREATE FUNCTION app.sync_system_role_permissions() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid; v_prev text := current_setting('app.tenant_id', true);
BEGIN
  FOR v_tenant IN SELECT id FROM public.tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    INSERT INTO public.roles (tenant_id, key, name, description, is_system)
      SELECT v_tenant, t.key, t.name, t.description, true FROM public.system_role_templates t
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DELETE FROM public.role_permissions rp USING public.roles r
     WHERE rp.tenant_id = v_tenant AND r.tenant_id = v_tenant AND r.id = rp.role_id AND r.is_system
       AND NOT EXISTS (SELECT 1 FROM public.system_role_template_permissions tp
                        WHERE tp.role_key = r.key AND tp.permission_key = rp.permission_key);
    INSERT INTO public.role_permissions (tenant_id, role_id, permission_key)
      SELECT v_tenant, r.id, tp.permission_key
        FROM public.roles r JOIN public.system_role_template_permissions tp ON tp.role_key = r.key
       WHERE r.tenant_id = v_tenant AND r.is_system
      ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.sync_system_role_permissions() FROM PUBLIC;
--> statement-breakpoint

-- ============================== outbox relay ==============================
CREATE FUNCTION app.outbox_pending(p_limit integer) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT tenant_ref FROM public.outbox_pending_tenants
   WHERE pending_count > 0 ORDER BY since LIMIT least(greatest(p_limit, 1), 1000)
$$;
--> statement-breakpoint

-- Called by the relay after dispatching p_count events of the CURRENT tenant.
CREATE FUNCTION app.outbox_ack(p_count integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := app.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant context required' USING ERRCODE = '42501'; END IF;
  UPDATE public.outbox_pending_tenants SET pending_count = pending_count - p_count, since = now()
   WHERE tenant_ref = v_tenant;
  DELETE FROM public.outbox_pending_tenants WHERE tenant_ref = v_tenant AND pending_count <= 0;
END
$$;
--> statement-breakpoint

-- ============================== platform administration ==============================
CREATE FUNCTION app.platform_role(p_user_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app.current_user_id() THEN RETURN NULL; END IF;
  RETURN (SELECT role FROM public.platform_admins WHERE user_id = p_user_id);
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.platform_list_tenants(p_search text, p_limit integer)
RETURNS TABLE (id uuid, slug text, name text, status text, plan text, created_at timestamptz, member_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app.platform_role(app.current_user_id()) IS NULL THEN
    RAISE EXCEPTION 'platform access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, t.slug::text, t.name, t.status, t.plan, t.created_at,
           (SELECT count(*) FROM public.user_memberships_index i WHERE i.tenant_ref = t.id AND i.status = 'active')
      FROM public.tenants t
     WHERE p_search IS NULL OR t.name ILIKE '%' || p_search || '%' OR t.slug::text ILIKE '%' || p_search || '%'
     ORDER BY t.created_at DESC
     LIMIT least(greatest(p_limit, 1), 200);
END
$$;
--> statement-breakpoint

CREATE FUNCTION app.platform_set_tenant_status(p_tenant uuid, p_status text, p_reason text, p_request_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role text := app.platform_role(app.current_user_id()); v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'operations') THEN
    RAISE EXCEPTION 'platform operations access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF length(coalesce(p_reason, '')) < 5 THEN RAISE EXCEPTION 'a reason is required'; END IF;
  UPDATE public.tenants SET status = p_status WHERE id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  INSERT INTO public.audit_logs (tenant_id, actor_user_id, actor_type, action, entity, entity_id, diff, request_id)
  VALUES (p_tenant, app.current_user_id(), 'platform', 'tenant.status_changed', 'tenant', p_tenant,
          jsonb_build_object('status', p_status, 'reason', p_reason), p_request_id);
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- ============================== function privileges ==============================
REVOKE ALL ON FUNCTION
  app.auth_create_user(text, text, text), app.auth_find_user(text), app.auth_user_for_login(text),
  app.auth_record_login(uuid, boolean, integer, interval), app.auth_user_secrets(uuid),
  app.session_create(uuid, bytea, bytea, interval, inet, text, uuid, boolean),
  app.session_resolve(bytea, interval), app.session_revoke_others(uuid),
  app.auth_token_create(uuid, text, bytea, interval, uuid), app.auth_verify_email(bytea),
  app.auth_reset_password(bytea, text), app.auth_accept_invite(bytea, text), app.user_tenants(uuid),
  app.tenant_provision(uuid, text, text, text, text, text, text, text),
  app.outbox_pending(integer), app.outbox_ack(integer),
  app.platform_role(uuid), app.platform_list_tenants(text, integer),
  app.platform_set_tenant_status(uuid, text, text, text),
  app.trg_membership_index(), app.trg_outbox_pending()
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.auth_create_user(text, text, text), app.auth_find_user(text), app.auth_user_for_login(text),
  app.auth_record_login(uuid, boolean, integer, interval), app.auth_user_secrets(uuid),
  app.session_create(uuid, bytea, bytea, interval, inet, text, uuid, boolean),
  app.session_resolve(bytea, interval), app.session_revoke_others(uuid),
  app.auth_token_create(uuid, text, bytea, interval, uuid), app.auth_verify_email(bytea),
  app.auth_reset_password(bytea, text), app.auth_accept_invite(bytea, text), app.user_tenants(uuid),
  app.tenant_provision(uuid, text, text, text, text, text, text, text),
  app.outbox_pending(integer), app.outbox_ack(integer),
  app.platform_role(uuid), app.platform_list_tenants(text, integer),
  app.platform_set_tenant_status(uuid, text, text, text)
TO erp_app;
--> statement-breakpoint

-- ============================== seed: permissions & system roles ==============================
INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('settings.manage', 'settings', 'Edit the school profile and campuses', 10),
  ('members.view',    'people',   'View user accounts and their roles', 20),
  ('members.manage',  'people',   'Invite users, assign roles and suspend access', 21),
  ('roles.manage',    'people',   'Create roles and choose their permissions', 22),
  ('audit.view',      'settings', 'View the audit log', 30);
--> statement-breakpoint
INSERT INTO system_role_templates (key, name, description, sort_order) VALUES
  ('owner',                'School Owner',         'Full control of the school account', 1),
  ('school_admin',         'School Administrator', 'Runs the school office and settings', 2),
  ('principal',            'Principal',            'Academic head of a campus', 3),
  ('vice_principal',       'Vice Principal',       'Supports the principal', 4),
  ('academic_coordinator', 'Academic Coordinator', 'Plans classes, subjects and exams', 5),
  ('accountant',           'Accountant',           'Fees, receipts and refunds', 6),
  ('admission_officer',    'Admission Officer',    'Inquiries, applications and admissions', 7),
  ('hr_manager',           'HR Manager',           'Staff records, leave and payroll', 8),
  ('teacher',              'Teacher',              'Attendance, homework and marks for assigned classes', 9),
  ('librarian',            'Librarian',            'Library catalogue and issues', 10),
  ('transport_manager',    'Transport Manager',    'Routes, vehicles and transport assignments', 11),
  ('receptionist',         'Receptionist',         'Front desk and inquiries', 12),
  ('parent',               'Parent',               'Linked children only', 13),
  ('student',              'Student',              'Own information only', 14),
  ('staff',                'Other Staff',          'Basic access', 15);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'settings.manage'), ('owner', 'members.view'), ('owner', 'members.manage'),
  ('owner', 'roles.manage'), ('owner', 'audit.view'),
  ('school_admin', 'settings.manage'), ('school_admin', 'members.view'), ('school_admin', 'members.manage'),
  ('school_admin', 'roles.manage'), ('school_admin', 'audit.view'),
  ('principal', 'members.view'), ('principal', 'audit.view'),
  ('vice_principal', 'members.view');
