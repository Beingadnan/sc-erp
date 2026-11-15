-- Phase 4a: RLS, column grants and permissions for students and guardians.
SELECT app.enable_tenant_rls('admission_number_settings');
--> statement-breakpoint
SELECT app.enable_tenant_rls('number_counters');
--> statement-breakpoint
SELECT app.enable_tenant_rls('students');
--> statement-breakpoint
SELECT app.enable_tenant_rls('guardians');
--> statement-breakpoint
SELECT app.enable_tenant_rls('student_guardians');
--> statement-breakpoint
SELECT app.enable_tenant_rls('student_enrollments');
--> statement-breakpoint
SELECT app.enable_tenant_rls('privacy_acknowledgements');
--> statement-breakpoint

-- Students are never deleted by the app (they are withdrawn or become alumni), and their
-- admission number, campus and owning school never change.
REVOKE UPDATE, DELETE ON students FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (first_name, last_name, name_local, date_of_birth, gender, blood_group, address,
  pen, apaar_id, aadhaar_sealed, aadhaar_last4, aadhaar_index, status, updated_at) ON students TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON student_enrollments FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (section_id, roll_number, status, left_on, updated_at) ON student_enrollments TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON guardians FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (full_name, phone, email, occupation, updated_at) ON guardians TO erp_app;
--> statement-breakpoint
REVOKE UPDATE ON student_guardians FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (relationship, is_primary, is_fee_payer) ON student_guardians TO erp_app;
--> statement-breakpoint
-- Consent records are evidence: insert-only.
REVOKE UPDATE, DELETE ON privacy_acknowledgements FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON number_counters FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (last_value) ON number_counters TO erp_app;
--> statement-breakpoint
REVOKE DELETE ON admission_number_settings FROM erp_app;
--> statement-breakpoint
-- Counters only move forward, so a number is never handed out twice.
CREATE FUNCTION app.number_counters_forward_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.last_value < OLD.last_value THEN
    RAISE EXCEPTION 'counter % cannot go backwards', OLD.counter_key USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER number_counters_forward_only BEFORE UPDATE ON number_counters
  FOR EACH ROW EXECUTE FUNCTION app.number_counters_forward_only();
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('students.view',           'students', 'See student records of their campuses', 70),
  ('students.view_assigned',  'students', 'See students of sections they teach (class teacher)', 71),
  ('students.manage',         'students', 'Admit students, edit records, guardians and sections', 72),
  ('students.sensitive.view', 'students', 'See full Aadhaar numbers (every view is logged)', 73);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'students.view'), ('owner', 'students.manage'), ('owner', 'students.sensitive.view'),
  ('school_admin', 'students.view'), ('school_admin', 'students.manage'), ('school_admin', 'students.sensitive.view'),
  ('principal', 'students.view'), ('principal', 'students.manage'), ('principal', 'students.sensitive.view'),
  ('vice_principal', 'students.view'), ('academic_coordinator', 'students.view'),
  ('accountant', 'students.view'), ('admission_officer', 'students.view'),
  ('admission_officer', 'students.manage'), ('receptionist', 'students.view'),
  ('librarian', 'students.view'), ('transport_manager', 'students.view'),
  ('teacher', 'students.view_assigned');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
