-- Phase 4b: RLS and grants for applications, their history and documents.
SELECT app.enable_tenant_rls('admission_applications');
--> statement-breakpoint
SELECT app.enable_tenant_rls('application_events');
--> statement-breakpoint
SELECT app.enable_tenant_rls('documents');
--> statement-breakpoint

-- Applications are never deleted (withdrawn instead); class, year, campus and number are fixed.
REVOKE UPDATE, DELETE ON admission_applications FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (first_name, last_name, date_of_birth, gender, previous_school, guardian_name,
  guardian_phone, guardian_email, guardian_relationship, notes, status, assessment_at,
  student_id, updated_at) ON admission_applications TO erp_app;
--> statement-breakpoint
-- History is evidence: insert-only.
REVOKE UPDATE, DELETE ON application_events FROM erp_app;
--> statement-breakpoint
-- Document records are kept (soft delete); a document can move to the admitted student.
REVOKE UPDATE, DELETE ON documents FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (student_id, doc_type, deleted_at, deleted_by) ON documents TO erp_app;
