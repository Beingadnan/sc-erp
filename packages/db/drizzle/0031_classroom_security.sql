-- Phase 10: timetable, substitutions, homework, notices.
SELECT app.enable_tenant_rls('period_slots');
--> statement-breakpoint
SELECT app.enable_tenant_rls('timetable_entries');
--> statement-breakpoint
SELECT app.enable_tenant_rls('substitutions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('homework');
--> statement-breakpoint
SELECT app.enable_tenant_rls('notices');
--> statement-breakpoint
SELECT app.enable_tenant_rls('notice_reads');
--> statement-breakpoint
REVOKE ALL ON period_slots, timetable_entries, substitutions, homework, notices, notice_reads FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON period_slots, timetable_entries, substitutions TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON homework TO erp_app;
--> statement-breakpoint
GRANT UPDATE (status) ON homework TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON notices TO erp_app;
--> statement-breakpoint
GRANT UPDATE (title, body, audience, grade_level_ids, section_ids, status, pinned, published_at, expires_on, updated_at)
  ON notices TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON notice_reads TO erp_app;
--> statement-breakpoint
GRANT UPDATE (views) ON notice_reads TO erp_app;
--> statement-breakpoint
CREATE TRIGGER notices_forward BEFORE UPDATE OF status ON notices
  FOR EACH ROW EXECUTE FUNCTION app.check_forward_status('draft>published', 'published>archived', 'draft>archived');
--> statement-breakpoint
CREATE TRIGGER homework_forward BEFORE UPDATE OF status ON homework
  FOR EACH ROW EXECUTE FUNCTION app.check_forward_status('active>removed');
--> statement-breakpoint
INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('timetable.manage', 'academic', 'Edit the bell schedule, timetables and substitutions', 46),
  ('notices.manage', 'communication', 'Write and publish notices to parents and staff', 140);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'timetable.manage'), ('school_admin', 'timetable.manage'), ('principal', 'timetable.manage'),
  ('owner', 'notices.manage'), ('school_admin', 'notices.manage'), ('principal', 'notices.manage'),
  ('receptionist', 'notices.manage');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
