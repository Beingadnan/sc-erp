-- Phase 6a: RLS, append-only money tables, balanced journals and fee permissions.
SELECT app.enable_tenant_rls('ledger_accounts');
--> statement-breakpoint
SELECT app.enable_tenant_rls('ledger_journals');
--> statement-breakpoint
SELECT app.enable_tenant_rls('ledger_entries');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_heads');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_structures');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_structure_classes');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_installments');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_structure_items');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_assignments');
--> statement-breakpoint
SELECT app.enable_tenant_rls('concession_types');
--> statement-breakpoint
SELECT app.enable_tenant_rls('student_concessions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_invoices');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_invoice_lines');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_adjustments');
--> statement-breakpoint

-- Every journal balances and has at least two entries; checked when the transaction commits.
CREATE FUNCTION app.check_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  j uuid;
  t uuid := NEW.tenant_id;
  n int;
  d bigint;
  c bigint;
BEGIN
  -- Only the branch that runs is evaluated, so each table's own column is read.
  IF TG_TABLE_NAME = 'ledger_journals' THEN
    j := NEW.id;
  ELSE
    j := NEW.journal_id;
  END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, d, c
  FROM ledger_entries WHERE tenant_id = t AND journal_id = j;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'Journal % does not balance (% entries, debit %, credit %)', j, n, d, c
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_journals_balanced
  AFTER INSERT ON ledger_journals DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_journal_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_journal_balanced();
--> statement-breakpoint

-- A reversal undoes exactly one journal.
CREATE FUNCTION app.check_journal_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM ledger_journals WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_id AND reverses_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A reversal cannot itself be reversed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_journals_reversal BEFORE INSERT ON ledger_journals
  FOR EACH ROW EXECUTE FUNCTION app.check_journal_reversal();
--> statement-breakpoint

-- Money records are append-only for the app.
REVOKE UPDATE, DELETE ON ledger_journals FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON ledger_entries FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_invoice_lines FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_invoices FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, cancel_reason, cancelled_by, cancelled_at) ON fee_invoices TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_adjustments FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, decision_note, journal_id) ON fee_adjustments TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON student_concessions FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, decision_note) ON student_concessions TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_assignments FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (removed_by, removed_at) ON fee_assignments TO erp_app;
--> statement-breakpoint
REVOKE DELETE ON ledger_accounts FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE ON ledger_accounts FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (name, active, updated_at) ON ledger_accounts TO erp_app;
--> statement-breakpoint
REVOKE DELETE ON fee_heads FROM erp_app;
--> statement-breakpoint
REVOKE DELETE ON concession_types FROM erp_app;
--> statement-breakpoint

-- A demand line's amount is fixed: no adjustment may exceed what is left on it.
CREATE FUNCTION app.check_adjustment_within_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_amount bigint;
  taken bigint;
BEGIN
  IF NEW.status NOT IN ('pending', 'approved') THEN RETURN NEW; END IF;
  -- Serialise reductions of the same line (the app role cannot take row locks on lines).
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.line_id::text, 0));
  SELECT amount INTO line_amount FROM fee_invoice_lines
    WHERE tenant_id = NEW.tenant_id AND id = NEW.line_id;
  SELECT coalesce(sum(amount), 0) INTO taken FROM fee_adjustments
    WHERE tenant_id = NEW.tenant_id AND line_id = NEW.line_id AND id <> NEW.id
      AND status = 'approved';
  IF NEW.status = 'approved' AND taken + NEW.amount > line_amount THEN
    RAISE EXCEPTION 'Reductions exceed the fee line' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fee_adjustments_within_line BEFORE INSERT OR UPDATE OF status ON fee_adjustments
  FOR EACH ROW EXECUTE FUNCTION app.check_adjustment_within_line();
--> statement-breakpoint

INSERT INTO permissions (key, module, description, sort_order) VALUES
  ('fees.view',               'fees', 'See fee setup, demands, concessions and student fee accounts', 90),
  ('fees.configure',          'fees', 'Set up fee heads, structures and concession types; generate and cancel demands', 91),
  ('fees.collect',            'fees', 'Take fee payments at the counter and issue receipts', 92),
  ('fees.concession.approve', 'fees', 'Approve concessions and waivers', 93),
  ('fees.refund',             'fees', 'Refund fees', 94),
  ('fees.cancel_receipt',     'fees', 'Cancel receipts (creates a reversal)', 95);
--> statement-breakpoint
INSERT INTO system_role_template_permissions (role_key, permission_key) VALUES
  ('owner', 'fees.view'), ('owner', 'fees.configure'), ('owner', 'fees.concession.approve'),
  ('owner', 'fees.refund'), ('owner', 'fees.cancel_receipt'),
  ('school_admin', 'fees.view'), ('school_admin', 'fees.configure'), ('school_admin', 'fees.collect'),
  ('school_admin', 'fees.concession.approve'), ('school_admin', 'fees.cancel_receipt'),
  ('principal', 'fees.view'), ('principal', 'fees.concession.approve'),
  ('accountant', 'fees.view'), ('accountant', 'fees.configure'), ('accountant', 'fees.collect'),
  ('accountant', 'fees.refund');
--> statement-breakpoint
SELECT app.sync_system_role_permissions();
