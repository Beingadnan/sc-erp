-- Phase 6b: payments, allocations and day closings.
SELECT app.enable_tenant_rls('fee_payments');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_allocations');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_day_closings');
--> statement-breakpoint
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_closing_fk
  FOREIGN KEY (tenant_id, closing_id) REFERENCES fee_day_closings (tenant_id, id);
--> statement-breakpoint

-- Receipts change only in status; allocations and closings are never changed or removed.
REVOKE UPDATE, DELETE ON fee_payments FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, cleared_on, bounced_on, bounce_reason, cancel_reason, cancelled_by, cancelled_at, closing_id)
  ON fee_payments TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_allocations FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_day_closings FROM erp_app;
--> statement-breakpoint

-- A receipt moves only forward: pending → cleared | bounced | cancelled, cleared → cancelled.
CREATE FUNCTION app.check_payment_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('cleared', 'bounced', 'cancelled')) OR
    (OLD.status = 'cleared' AND NEW.status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'A % receipt cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closing_id IS NOT NULL AND NEW.closing_id IS DISTINCT FROM OLD.closing_id THEN
    RAISE EXCEPTION 'The receipt is already in a closed day' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fee_payments_status BEFORE UPDATE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION app.check_payment_status();
--> statement-breakpoint

-- Nothing settles or reduces a demand line beyond its amount: approved concessions and
-- waivers plus allocations of live receipts (pending cheques count until they bounce).
CREATE OR REPLACE FUNCTION app.line_taken(t uuid, line uuid, skip_adjustment uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(amount) FROM fee_adjustments
      WHERE tenant_id = t AND line_id = line AND status = 'approved'
        AND (skip_adjustment IS NULL OR id <> skip_adjustment)), 0)
    + coalesce((SELECT sum(a.amount) FROM fee_allocations a
      JOIN fee_payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
      WHERE a.tenant_id = t AND a.line_id = line AND p.status IN ('cleared', 'pending')), 0)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.check_adjustment_within_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_amount bigint;
BEGIN
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.line_id::text, 0));
  SELECT amount INTO line_amount FROM fee_invoice_lines WHERE tenant_id = NEW.tenant_id AND id = NEW.line_id;
  IF app.line_taken(NEW.tenant_id, NEW.line_id, NEW.id) + NEW.amount > line_amount THEN
    RAISE EXCEPTION 'Reductions exceed the fee line' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.check_allocation_within_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_amount bigint;
  paid bigint;
  allocated bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.line_id::text, 0));
  SELECT amount INTO line_amount FROM fee_invoice_lines WHERE tenant_id = NEW.tenant_id AND id = NEW.line_id;
  IF app.line_taken(NEW.tenant_id, NEW.line_id, NULL) + NEW.amount > line_amount THEN
    RAISE EXCEPTION 'Payments exceed the fee line' USING ERRCODE = 'check_violation';
  END IF;
  -- Nor may a receipt be allocated beyond its own amount.
  SELECT amount INTO paid FROM fee_payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
  SELECT coalesce(sum(amount), 0) INTO allocated FROM fee_allocations
    WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id;
  IF allocated + NEW.amount > paid THEN
    RAISE EXCEPTION 'Allocations exceed the receipt' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fee_allocations_within_line BEFORE INSERT ON fee_allocations
  FOR EACH ROW EXECUTE FUNCTION app.check_allocation_within_line();
