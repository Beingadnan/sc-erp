-- Phase 5: RLS, integrity and permissions for attendance.
SELECT app.enable_tenant_rls('attendance_settings');
--> statement-breakpoint
SELECT app.enable_tenant_rls('attendance_sessions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('student_attendance');
--> statement-breakpoint
SELECT app.enable_tenant_rls('attendance_corrections');
--> statement-breakpoint
SELECT app.enable_tenant_rls('leave_requests');
--> statement-breakpoint

-- A record's student must be the student of its enrollment.
ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_tenant_id_student_uq
  UNIQUE (tenant_id, id, student_id);
--> statement-breakpoint
ALTER TABLE student_attendance ADD CONSTRAINT student_attendance_enrollment_student_fk
  FOREIGN KEY (tenant_id, enrollment_id, student_id)
  REFERENCES student_enrollments (tenant_id, id, student_id);
--> statement-breakpoint

-- Registers are never deleted by the app; only status and remark change, with history.
REVOKE UPDATE, DELETE ON attendance_sessions FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (updated_by, updated_at) ON attendance_sessions TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON student_attendance FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, remark) ON student_attendance TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON attendance_corrections FROM erp_app;
--> statement-breakpoint
REVOKE DELETE ON leave_requests FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE ON leave_requests FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, decision_note) ON leave_requests TO erp_app;
--> statement-breakpoint
REVOKE DELETE ON attendance_settings FROM erp_app;
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('attendance.view',    'attendance', 'See attendance registers and reports of their campuses', 80),
  ('attendance.mark',    'attendance', 'Mark attendance and approve leave for sections they are class teacher of', 81),
  ('attendance.correct', 'attendance', 'Mark any section and correct attendance after the cut-off, with a reason', 82);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'attendance.view'), ('owner', 'attendance.correct'),
  ('school_admin', 'attendance.view'), ('school_admin', 'attendance.mark'), ('school_admin', 'attendance.correct'),
  ('principal', 'attendance.view'), ('principal', 'attendance.correct'),
  ('vice_principal', 'attendance.view'), ('vice_principal', 'attendance.correct'),
  ('academic_coordinator', 'attendance.view'),
  ('teacher', 'attendance.mark'),
  ('receptionist', 'attendance.view');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
