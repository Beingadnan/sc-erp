-- Phase 9a: setup workbook imports.
SELECT app.enable_tenant_rls('setup_imports');
--> statement-breakpoint
REVOKE ALL ON setup_imports FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON setup_imports TO erp_app;
--> statement-breakpoint
GRANT UPDATE (status, summary, created, applied_at, undone_at) ON setup_imports TO erp_app;
--> statement-breakpoint
-- Statuses only move forward.
CREATE TRIGGER setup_imports_forward BEFORE UPDATE OF status ON setup_imports
  FOR EACH ROW EXECUTE FUNCTION app.check_forward_status('previewed>applied', 'previewed>cancelled', 'applied>undone');
