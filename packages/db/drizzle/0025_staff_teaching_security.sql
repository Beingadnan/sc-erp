-- Phase 8: staff profiles, teaching assignments, staff invited by mobile number.

SELECT app.enable_tenant_rls('staff_profiles');
--> statement-breakpoint
SELECT app.enable_tenant_rls('teaching_assignments');
--> statement-breakpoint
REVOKE ALL ON staff_profiles, teaching_assignments FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON staff_profiles TO erp_app;
--> statement-breakpoint
GRANT UPDATE (designation, employee_code, phone, joined_on, updated_at) ON staff_profiles TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON teaching_assignments TO erp_app;
--> statement-breakpoint

-- A staff member who has only a mobile number (no email). Password set later from the invite link.
CREATE FUNCTION app.auth_create_phone_user(p_phone text, p_full_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.users (login_phone, full_name) VALUES (p_phone, p_full_name)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_create_phone_user(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_create_phone_user(text, text) TO erp_app;
--> statement-breakpoint

-- Parent links: a number invited as staff but never activated counts as "no account yet".
CREATE OR REPLACE FUNCTION app.portal_invite_peek(p_token_hash bytea)
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
           EXISTS (SELECT 1 FROM public.users u WHERE u.login_phone = r.phone AND u.password_hash IS NOT NULL)
      FROM public.tenants t, public.guardians g
     WHERE t.id = r.tenant_id AND g.id = r.guardian_id;
  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.portal_accept_invite(p_token_hash bytea, p_password_hash text, p_existing_user uuid)
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
    IF v_user IS NOT NULL AND (SELECT password_hash FROM public.users WHERE id = v_user) IS NULL THEN
      -- Invited (e.g. as staff) but never set a password: this link sets it.
      IF p_password_hash IS NULL THEN
        RAISE EXCEPTION 'password required' USING ERRCODE = '22023';
      END IF;
      UPDATE public.users SET password_hash = p_password_hash WHERE id = v_user;
    ELSIF v_user IS NOT NULL THEN
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
CREATE OR REPLACE FUNCTION app.auth_accept_invite(p_token_hash bytea, p_password_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_tenant uuid; v_prev text := current_setting('app.tenant_id', true);
BEGIN
  SELECT o_user, o_tenant INTO v_user, v_tenant FROM app._consume_token('invite', p_token_hash);
  IF v_user IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  -- Mobile-only accounts get their invite link through the school, not the person: once the
  -- account has a password (e.g. activated as a parent), the link must not sign anyone in.
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_user AND u.email IS NULL
               AND u.password_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'account already active; sign in instead' USING ERRCODE = '42501';
  END IF;
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
