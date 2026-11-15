-- Phase 11: exams, marks and report cards.
SELECT app.enable_tenant_rls('exams');
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_papers');
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_marks');
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_mark_submissions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_remarks');
--> statement-breakpoint
REVOKE ALL ON exams, exam_papers, exam_marks, exam_mark_submissions, exam_remarks FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON exams TO erp_app;
--> statement-breakpoint
GRANT UPDATE (term_id, name, starts_on, ends_on, status, published_at, updated_at) ON exams TO erp_app;
--> statement-breakpoint
GRANT DELETE ON exams TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON exam_papers, exam_mark_submissions TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON exam_marks, exam_remarks TO erp_app;
--> statement-breakpoint
GRANT UPDATE (marks, status, updated_by, updated_at) ON exam_marks TO erp_app;
--> statement-breakpoint
GRANT UPDATE (remark, updated_by, updated_at) ON exam_remarks TO erp_app;
--> statement-breakpoint
GRANT DELETE ON exam_remarks TO erp_app;
--> statement-breakpoint
INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('exams.manage', 'academic', 'Create exams and date sheets, reopen marks and publish results', 47);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'exams.manage'), ('school_admin', 'exams.manage'), ('principal', 'exams.manage'),
  ('vice_principal', 'exams.manage'), ('academic_coordinator', 'exams.manage');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
