-- Phase 3b: RLS, grants and public access functions for the school website and inquiries.
SELECT app.enable_tenant_rls('cms_pages');
--> statement-breakpoint
SELECT app.enable_tenant_rls('cms_page_versions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('admission_inquiries');
--> statement-breakpoint
ALTER TABLE cms_pages ADD CONSTRAINT cms_pages_published_version_fk
  FOREIGN KEY (tenant_id, published_version_id)
  REFERENCES cms_page_versions (tenant_id, id);
--> statement-breakpoint

-- Versions are history: insert-only for the app (removed only with their page).
REVOKE UPDATE, DELETE ON cms_page_versions FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE ON cms_pages FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (slug, title, published_version_id, show_in_nav, sort_order, updated_at) ON cms_pages TO erp_app;
--> statement-breakpoint
-- Inquiries are personal data submitted by parents: staff change the status only, and
-- nobody deletes them through the app (erasure requests are handled by a later phase).
REVOKE UPDATE, DELETE ON admission_inquiries FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, updated_at) ON admission_inquiries TO erp_app;
--> statement-breakpoint

-- Public site of an active school: name, active campuses, published pages in the menu.
CREATE FUNCTION app.public_site(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant record;
  v_prev text := current_setting('app.tenant_id', true);
  v_result jsonb;
BEGIN
  SELECT t.id, t.name, t.slug INTO v_tenant
    FROM public.tenants t WHERE t.slug = p_slug::citext AND t.status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.tenant_id', v_tenant.id::text, true);
  SELECT jsonb_build_object(
    'name', v_tenant.name,
    'slug', v_tenant.slug,
    'campuses', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'board', c.board,
               'address', c.address, 'phone', c.phone, 'email', c.email) ORDER BY c.name)
        FROM public.campuses c WHERE c.tenant_id = v_tenant.id AND c.status = 'active'), '[]'::jsonb),
    'pages', coalesce((
      SELECT jsonb_agg(jsonb_build_object('slug', p.slug, 'title', v.title)
               ORDER BY p.sort_order, v.title)
        FROM public.cms_pages p
        JOIN public.cms_page_versions v ON v.tenant_id = p.tenant_id AND v.id = p.published_version_id
       WHERE p.tenant_id = v_tenant.id AND p.show_in_nav), '[]'::jsonb)
  ) INTO v_result;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v_result;
END
$$;
--> statement-breakpoint

-- Published version of one page, or NULL.
CREATE FUNCTION app.public_page(p_slug text, p_page text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant uuid;
  v_prev text := current_setting('app.tenant_id', true);
  v_result jsonb;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.slug = p_slug::citext AND t.status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  SELECT jsonb_build_object('title', v.title, 'body', v.body, 'publishedAt', v.created_at)
    INTO v_result
    FROM public.cms_pages p
    JOIN public.cms_page_versions v ON v.tenant_id = p.tenant_id AND v.id = p.published_version_id
   WHERE p.tenant_id = v_tenant AND p.slug = p_page;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v_result;
END
$$;
--> statement-breakpoint

-- Records a website inquiry for an active school. Returns false (without saying why) when
-- the school or campus does not exist or is inactive, or the school's hourly cap is hit.
CREATE FUNCTION app.public_inquiry_create(
  p_slug text, p_campus_id uuid, p_parent_name text, p_phone text, p_email text,
  p_student_name text, p_class_sought text, p_message text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant uuid;
  v_prev text := current_setting('app.tenant_id', true);
  v_recent int;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.slug = p_slug::citext AND t.status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  IF p_campus_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.campuses c
       WHERE c.tenant_id = v_tenant AND c.id = p_campus_id AND c.status = 'active') THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
    RETURN false;
  END IF;
  SELECT count(*) INTO v_recent FROM public.admission_inquiries i
   WHERE i.tenant_id = v_tenant AND i.source = 'website' AND i.created_at > now() - interval '1 hour';
  IF v_recent >= 200 THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
    RETURN false;
  END IF;
  INSERT INTO public.admission_inquiries
    (tenant_id, campus_id, parent_name, phone, email, student_name, class_sought, message, source, consent_at)
  VALUES (v_tenant, p_campus_id, p_parent_name, p_phone, p_email, p_student_name, p_class_sought,
          coalesce(p_message, ''), 'website', now());
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_site(text), app.public_page(text, text),
  app.public_inquiry_create(text, uuid, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_site(text), app.public_page(text, text),
  app.public_inquiry_create(text, uuid, text, text, text, text, text, text) TO erp_app;
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('cms.manage',        'website',    'Edit and publish the school website pages', 50),
  ('admissions.view',   'admissions', 'See admission inquiries', 60),
  ('admissions.manage', 'admissions', 'Record inquiries and update their status', 61);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'cms.manage'), ('school_admin', 'cms.manage'), ('principal', 'cms.manage'),
  ('owner', 'admissions.view'), ('school_admin', 'admissions.view'), ('principal', 'admissions.view'),
  ('vice_principal', 'admissions.view'), ('accountant', 'admissions.view'),
  ('admission_officer', 'admissions.view'), ('receptionist', 'admissions.view'),
  ('owner', 'admissions.manage'), ('school_admin', 'admissions.manage'), ('principal', 'admissions.manage'),
  ('admission_officer', 'admissions.manage'), ('receptionist', 'admissions.manage');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
