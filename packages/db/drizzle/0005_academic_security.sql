-- Phase 3a: RLS for the school-structure tables, new permissions, role templates.
SELECT app.enable_tenant_rls('academic_years');
--> statement-breakpoint
SELECT app.enable_tenant_rls('academic_terms');
--> statement-breakpoint
SELECT app.enable_tenant_rls('grading_scales');
--> statement-breakpoint
SELECT app.enable_tenant_rls('grading_bands');
--> statement-breakpoint
SELECT app.enable_tenant_rls('grade_levels');
--> statement-breakpoint
SELECT app.enable_tenant_rls('sections');
--> statement-breakpoint
SELECT app.enable_tenant_rls('subjects');
--> statement-breakpoint
SELECT app.enable_tenant_rls('class_subjects');
--> statement-breakpoint
SELECT app.enable_tenant_rls('calendar_events');
--> statement-breakpoint

-- Ownership columns never move once a row exists (re-parenting would bypass the
-- campus checks done when the row was created).
REVOKE UPDATE ON academic_years, academic_terms, grade_levels, sections, class_subjects,
  grading_bands, calendar_events FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (name, starts_on, ends_on, is_current, status, weekly_off_days, saturday_off_weeks, updated_at)
  ON academic_years TO erp_app;
--> statement-breakpoint
GRANT UPDATE (name, starts_on, ends_on, updated_at) ON academic_terms TO erp_app;
--> statement-breakpoint
GRANT UPDATE (name, stage, sort_order, grading_scale_id, status, updated_at) ON grade_levels TO erp_app;
--> statement-breakpoint
GRANT UPDATE (name, capacity, room, class_teacher_membership_id, updated_at) ON sections TO erp_app;
--> statement-breakpoint
GRANT UPDATE (is_optional, sort_order) ON class_subjects TO erp_app;
--> statement-breakpoint
GRANT UPDATE (label, min_percent, max_percent, grade_point, remark, sort_order) ON grading_bands TO erp_app;
--> statement-breakpoint
GRANT UPDATE (campus_id, title, kind, starts_on, ends_on, description, updated_at) ON calendar_events TO erp_app;
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('academic.view',   'academics', 'View academic years, classes, sections, subjects and grading', 40),
  ('academic.manage', 'academics', 'Set up academic years, classes, sections, subjects and grading', 41),
  ('calendar.manage', 'academics', 'Add holidays, vacations, exams and events to the calendar', 42);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'academic.view'), ('owner', 'academic.manage'), ('owner', 'calendar.manage'),
  ('school_admin', 'academic.view'), ('school_admin', 'academic.manage'), ('school_admin', 'calendar.manage'),
  ('principal', 'academic.view'), ('principal', 'academic.manage'), ('principal', 'calendar.manage'),
  ('vice_principal', 'academic.view'), ('vice_principal', 'calendar.manage'),
  ('academic_coordinator', 'academic.view'), ('academic_coordinator', 'academic.manage'),
  ('academic_coordinator', 'calendar.manage'),
  ('teacher', 'academic.view'), ('accountant', 'academic.view'),
  ('admission_officer', 'academic.view'), ('receptionist', 'academic.view');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
