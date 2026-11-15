-- Separate sign-in for staff and parents: for each school a user belongs to, does the user hold
-- the Parent role, a staff role, or both? Reads one school at a time under its own RLS.
CREATE FUNCTION app.user_tenant_kinds(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, is_parent boolean, is_staff boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'only the current user''s schools can be listed' USING ERRCODE = '42501';
  END IF;
  FOR t IN SELECT i.tenant_ref FROM public.user_memberships_index i
            JOIN public.tenants te ON te.id = i.tenant_ref AND te.status = 'active'
           WHERE i.user_id = p_user_id AND i.status = 'active'
  LOOP
    PERFORM set_config('app.tenant_id', t.tenant_ref::text, true);
    RETURN QUERY
      SELECT t.tenant_ref,
             coalesce(bool_or(r.key = 'parent'), false),
             coalesce(bool_or(r.key <> 'parent'), false)
        FROM public.tenant_memberships m
        JOIN public.membership_roles mr ON mr.tenant_id = m.tenant_id AND mr.membership_id = m.id
        JOIN public.roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
       WHERE m.tenant_id = t.tenant_ref AND m.user_id = p_user_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.user_tenant_kinds(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.user_tenant_kinds(uuid) TO erp_app;
