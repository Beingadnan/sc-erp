-- Phase 2 follow-up: resolve a session AND the caller's permissions in one round trip.
--
-- The access guard used to run BEGIN, set context, session_resolve, set context,
-- permission query, COMMIT: six round trips before the handler did any work. This
-- function does the same reads in one statement.
--
-- Safety:
--  * Everything is derived from the session token; the caller cannot choose a user or
--    a tenant.
--  * Tenant tables keep FORCE RLS, so the function sets app.tenant_id to the session's
--    active tenant while it reads them and restores the previous value afterwards.
--  * Membership must be active; tenant status is returned so the guard can block
--    suspended schools exactly as before.
CREATE FUNCTION app.session_authorize(
  p_token_hash bytea, p_idle interval, p_with_access boolean, p_with_platform boolean)
RETURNS TABLE (
  session_id uuid, user_id uuid, active_tenant_id uuid, csrf_hash bytea, mfa_pending boolean,
  expires_at timestamptz, mfa_enabled boolean, platform_role text, access jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  s record;
  v_prev text;
  v_mfa boolean;
  v_platform text;
  v_access jsonb := '[]'::jsonb;
BEGIN
  SELECT r.* INTO s FROM app.session_resolve(p_token_hash, p_idle) r;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT u.mfa_enabled_at IS NOT NULL INTO v_mfa FROM public.users u WHERE u.id = s.user_id;

  IF p_with_platform AND NOT s.mfa_pending THEN
    SELECT pa.role INTO v_platform FROM public.platform_admins pa WHERE pa.user_id = s.user_id;
  END IF;

  IF p_with_access AND s.active_tenant_id IS NOT NULL AND NOT s.mfa_pending THEN
    v_prev := current_setting('app.tenant_id', true);
    PERFORM set_config('app.tenant_id', s.active_tenant_id::text, true);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'membership_id', m.id, 'tenant_status', t.status, 'campus_id', mr.campus_id,
             'role_id', mr.role_id, 'permission_key', rp.permission_key)), '[]'::jsonb)
      INTO v_access
      FROM public.tenant_memberships m
      JOIN public.tenants t ON t.id = m.tenant_id
      LEFT JOIN public.membership_roles mr
             ON mr.tenant_id = m.tenant_id AND mr.membership_id = m.id
      LEFT JOIN public.role_permissions rp
             ON rp.tenant_id = mr.tenant_id AND rp.role_id = mr.role_id
     WHERE m.user_id = s.user_id
       AND m.tenant_id = s.active_tenant_id
       AND m.status = 'active';
    PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  END IF;

  RETURN QUERY SELECT s.session_id, s.user_id, s.active_tenant_id, s.csrf_hash, s.mfa_pending,
                      s.expires_at, coalesce(v_mfa, false), v_platform, v_access;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.session_authorize(bytea, interval, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.session_authorize(bytea, interval, boolean, boolean) TO erp_app;
