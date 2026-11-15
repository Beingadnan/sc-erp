-- Phase 4c: RLS, grants and permissions for TCs, imports and custom fields.
SELECT app.enable_tenant_rls('transfer_certificates');
--> statement-breakpoint
SELECT app.enable_tenant_rls('import_jobs');
--> statement-breakpoint
SELECT app.enable_tenant_rls('custom_field_definitions');
--> statement-breakpoint
GRANT UPDATE (custom_fields) ON students TO erp_app;
--> statement-breakpoint
GRANT UPDATE (custom_fields) ON guardians TO erp_app;
--> statement-breakpoint
GRANT UPDATE (exit_reason) ON student_enrollments TO erp_app;
--> statement-breakpoint
-- A TC is a legal record: never deleted or rewritten, only cancelled with a reason.
REVOKE UPDATE, DELETE ON transfer_certificates FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, cancelled_reason, cancelled_at) ON transfer_certificates TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON import_jobs FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, rows, report, finished_at) ON import_jobs TO erp_app;
--> statement-breakpoint
-- Custom fields are archived, not deleted, so stored values keep their meaning.
REVOKE UPDATE, DELETE ON custom_field_definitions FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (label, options, required, sort_order, archived) ON custom_field_definitions TO erp_app;
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('students.promote',  'students', 'Move students to the next class at the end of the year', 74),
  ('students.withdraw', 'students', 'Withdraw students and issue transfer certificates', 75),
  ('students.export',   'students', 'Download student lists (every export is logged)', 76),
  ('students.import',   'students', 'Import students from a spreadsheet', 77);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'students.promote'), ('owner', 'students.withdraw'), ('owner', 'students.export'), ('owner', 'students.import'),
  ('school_admin', 'students.promote'), ('school_admin', 'students.withdraw'),
  ('school_admin', 'students.export'), ('school_admin', 'students.import'),
  ('principal', 'students.promote'), ('principal', 'students.withdraw'), ('principal', 'students.export'),
  ('academic_coordinator', 'students.promote');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
