-- Phase 7a: parent portal accounts. Parents sign in with a mobile number; the school gives
-- access with a one-time link. Every step that touches global users runs in a definer function.

SELECT app.enable_tenant_rls('portal_invites');
--> statement-breakpoint
REVOKE ALL ON portal_invites FROM erp_app;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, guardian_id, purpose, phone, expires_at, consumed_at, revoked_at,
              user_id, created_by, created_at) ON portal_invites TO erp_app;
--> statement-breakpoint
GRANT INSERT ON portal_invites TO erp_app;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON portal_invites TO erp_app;
--> statement-breakpoint
GRANT SELECT (login_phone) ON users TO erp_app;
--> statement-breakpoint

CREATE FUNCTION app.portal_lookup_hash() RETURNS bytea
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN coalesce(current_setting('app.portal_invite_hash', true), '') = '' THEN NULL
              ELSE decode(current_setting('app.portal_invite_hash', true), 'hex') END
$$;
--> statement-breakpoint

-- A link is found from its token hash alone (the parent is not signed in). Inside the
-- definer below, the owner may see an invite only through this policy, for the one hash.
CREATE POLICY portal_invite_lookup ON portal_invites FOR SELECT TO CURRENT_USER
  USING (token_hash = app.portal_lookup_hash());
--> statement-breakpoint

CREATE FUNCTION app.auth_user_for_login_phone(p_phone text)
RETURNS TABLE (user_id uuid, password_hash text, status text, locked_until timestamptz, mfa_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT id, password_hash, status, locked_until, mfa_enabled_at IS NOT NULL
    FROM public.users WHERE login_phone = p_phone
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_user_for_login_phone(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_user_for_login_phone(text) TO erp_app;
--> statement-breakpoint

-- What the activation page shows. status: open | expired | used.
CREATE FUNCTION app.portal_invite_peek(p_token_hash bytea)
RETURNS TABLE (tenant_id uuid, invite_id uuid, purpose text, status text, school_name text,
               guardian_name text, phone text, has_account boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev_hash text := current_setting('app.portal_invite_hash', true);
  v_prev_tenant text := current_setting('app.tenant_id', true);
  r record;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 32 THEN RETURN; END IF;
  PERFORM set_config('app.portal_invite_hash', encode(p_token_hash, 'hex'), true);
  SELECT i.* INTO r FROM public.portal_invites i
    JOIN public.tenants t ON t.id = i.tenant_id AND t.status = 'active'
   WHERE i.token_hash = p_token_hash;
  PERFORM set_config('app.portal_invite_hash', coalesce(v_prev_hash, ''), true);
  IF r.id IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', r.tenant_id::text, true);
  RETURN QUERY
    SELECT r.tenant_id, r.id, r.purpose,
           CASE WHEN r.consumed_at IS NOT NULL OR r.revoked_at IS NOT NULL THEN 'used'
                WHEN r.expires_at <= now() THEN 'expired' ELSE 'open' END,
           t.name, g.full_name, r.phone,
           EXISTS (SELECT 1 FROM public.users u WHERE u.login_phone = r.phone)
      FROM public.tenants t, public.guardians g
     WHERE t.id = r.tenant_id AND g.id = r.guardian_id;
  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.portal_invite_peek(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.portal_invite_peek(bytea) TO erp_app;
--> statement-breakpoint

-- A school may hand out a password-reset link only for a parent-only account that belongs to
-- this school alone (no email, no platform role, no membership elsewhere).
CREATE FUNCTION app.portal_reset_allowed(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.current_tenant_id() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user AND u.email IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = p_user)
     AND NOT EXISTS (SELECT 1 FROM public.user_memberships_index i
                      WHERE i.user_id = p_user AND i.tenant_ref <> app.current_tenant_id())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.portal_reset_allowed(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.portal_reset_allowed(uuid) TO erp_app;
--> statement-breakpoint

-- Uses a link. activate: creates the parent's account (or, when the mobile number already has
-- one, uses it — the API has checked that account's password and passes p_existing_user), joins
-- the school with the Parent role and links the guardian. reset: sets a new password.
CREATE FUNCTION app.portal_accept_invite(p_token_hash bytea, p_password_hash text, p_existing_user uuid)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev_hash text := current_setting('app.portal_invite_hash', true);
  v_prev_tenant text := current_setting('app.tenant_id', true);
  v_tenant uuid;
  r record;
  g record;
  v_user uuid;
  v_membership uuid;
  v_status text;
  v_role uuid;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 32 THEN RETURN; END IF;
  PERFORM set_config('app.portal_invite_hash', encode(p_token_hash, 'hex'), true);
  SELECT i.tenant_id INTO v_tenant FROM public.portal_invites i
    JOIN public.tenants t ON t.id = i.tenant_id AND t.status = 'active'
   WHERE i.token_hash = p_token_hash;
  PERFORM set_config('app.portal_invite_hash', coalesce(v_prev_hash, ''), true);
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  SELECT * INTO r FROM public.portal_invites i
   WHERE i.token_hash = p_token_hash AND i.consumed_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at > now()
   FOR UPDATE;
  IF r.id IS NULL THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
    RETURN;
  END IF;
  SELECT * INTO g FROM public.guardians WHERE id = r.guardian_id;

  IF r.purpose = 'reset' THEN
    v_user := g.user_id;
    IF v_user IS NULL OR p_password_hash IS NULL OR NOT app.portal_reset_allowed(v_user) THEN
      RAISE EXCEPTION 'reset not allowed' USING ERRCODE = '42501';
    END IF;
    UPDATE public.users SET password_hash = p_password_hash, failed_login_count = 0, locked_until = NULL
     WHERE id = v_user;
    UPDATE public.sessions SET revoked_at = now() WHERE sessions.user_id = v_user AND revoked_at IS NULL;
  ELSE
    SELECT id INTO v_user FROM public.users WHERE login_phone = r.phone;
    IF v_user IS NOT NULL THEN
      IF p_existing_user IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'account exists' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF p_password_hash IS NULL THEN
        RAISE EXCEPTION 'password required' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.users (full_name, login_phone, password_hash)
      VALUES (g.full_name, r.phone, p_password_hash) RETURNING id INTO v_user;
    END IF;

    SELECT m.id, m.status INTO v_membership, v_status FROM public.tenant_memberships m
     WHERE m.tenant_id = v_tenant AND m.user_id = v_user;
    IF v_membership IS NULL THEN
      v_membership := app.uuid_v7();
      INSERT INTO public.tenant_memberships (id, tenant_id, user_id, status)
      VALUES (v_membership, v_tenant, v_user, 'active');
    ELSIF v_status = 'suspended' THEN
      RAISE EXCEPTION 'membership suspended' USING ERRCODE = '42501';
    ELSIF v_status = 'invited' THEN
      UPDATE public.tenant_memberships SET status = 'active' WHERE id = v_membership;
    END IF;
    SELECT id INTO v_role FROM public.roles WHERE roles.tenant_id = v_tenant AND key = 'parent';
    INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, campus_id)
    VALUES (v_tenant, v_membership, v_role, NULL)
    ON CONFLICT ON CONSTRAINT membership_roles_assignment_uq DO NOTHING;
    UPDATE public.guardians SET user_id = v_user WHERE id = r.guardian_id;
  END IF;

  UPDATE public.portal_invites SET consumed_at = now(), user_id = v_user WHERE id = r.id;
  UPDATE public.portal_invites SET revoked_at = now()
   WHERE guardian_id = r.guardian_id AND id <> r.id AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.audit_logs (tenant_id, actor_user_id, actor_type, action, entity, entity_id, request_id)
  VALUES (v_tenant, v_user, 'user',
          CASE WHEN r.purpose = 'reset' THEN 'portal.password_reset' ELSE 'portal.activated' END,
          'guardian', r.guardian_id, current_setting('app.request_id', true));

  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  user_id := v_user; tenant_id := v_tenant;
  RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.portal_accept_invite(bytea, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.portal_accept_invite(bytea, text, uuid) TO erp_app;
--> statement-breakpoint

-- Takes portal access away from a guardian (current school). When the account no longer
-- speaks for any guardian here, its Parent role in this school goes too.
CREATE FUNCTION app.portal_unlink_guardian(p_guardian uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_tenant uuid := app.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant' USING ERRCODE = '42501'; END IF;
  SELECT user_id INTO v_user FROM public.guardians WHERE id = p_guardian AND tenant_id = v_tenant;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE public.guardians SET user_id = NULL WHERE id = p_guardian AND tenant_id = v_tenant;
  UPDATE public.portal_invites SET revoked_at = now()
   WHERE guardian_id = p_guardian AND tenant_id = v_tenant AND consumed_at IS NULL AND revoked_at IS NULL;
  IF NOT EXISTS (SELECT 1 FROM public.guardians WHERE tenant_id = v_tenant AND user_id = v_user) THEN
    DELETE FROM public.membership_roles mr
     USING public.tenant_memberships m, public.roles ro
     WHERE mr.tenant_id = v_tenant AND m.id = mr.membership_id AND m.tenant_id = v_tenant
       AND m.user_id = v_user AND ro.id = mr.role_id AND ro.tenant_id = v_tenant AND ro.key = 'parent';
    -- A parent-only membership has nothing left: remove it so the account leaves the school.
    DELETE FROM public.tenant_memberships m
     WHERE m.tenant_id = v_tenant AND m.user_id = v_user
       AND NOT EXISTS (SELECT 1 FROM public.membership_roles mr
                        WHERE mr.tenant_id = v_tenant AND mr.membership_id = m.id);
  END IF;
  RETURN v_user;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.portal_unlink_guardian(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.portal_unlink_guardian(uuid) TO erp_app;
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('family.portal',  'portal',   'Parent portal: see own linked children only', 130),
  ('portal.manage',  'students', 'Give parents portal access and reset their passwords', 77);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('parent', 'family.portal'),
  ('owner', 'portal.manage'), ('school_admin', 'portal.manage'), ('principal', 'portal.manage'),
  ('admission_officer', 'portal.manage'), ('receptionist', 'portal.manage'),
  ('accountant', 'portal.manage');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
