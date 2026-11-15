-- Phase 6c: paying the school's account directly (payment links, proofs), refunds.
SELECT app.enable_tenant_rls('fee_payment_settings');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_payment_requests');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_payment_proofs');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_refunds');
--> statement-breakpoint
SELECT app.enable_tenant_rls('fee_refund_parts');
--> statement-breakpoint
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_proof_fk
  FOREIGN KEY (tenant_id, proof_id) REFERENCES fee_payment_proofs (tenant_id, id);
--> statement-breakpoint

REVOKE DELETE ON fee_payment_settings FROM erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_payment_requests FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, paid_at, cancelled_by, cancelled_at) ON fee_payment_requests TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_payment_proofs FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, decision_note, payment_id) ON fee_payment_proofs TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_refunds FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (refund_number, status, decided_by, decided_at, decision_note, paid_on, journal_id, reference)
  ON fee_refunds TO erp_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_refund_parts FROM erp_app;
--> statement-breakpoint
GRANT UPDATE (released_at, release_journal_id) ON fee_allocations TO erp_app;
--> statement-breakpoint

-- Statuses only move forward.
CREATE FUNCTION app.check_forward_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := TG_ARGV::text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status || '>' || NEW.status) = ANY (allowed)) THEN
    RAISE EXCEPTION 'Status cannot change from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fee_payment_requests_status BEFORE UPDATE ON fee_payment_requests
  FOR EACH ROW EXECUTE FUNCTION app.check_forward_status('open>paid', 'open>cancelled');
--> statement-breakpoint
CREATE TRIGGER fee_payment_proofs_status BEFORE UPDATE ON fee_payment_proofs
  FOR EACH ROW EXECUTE FUNCTION app.check_forward_status('pending>approved', 'pending>rejected');
--> statement-breakpoint
CREATE TRIGGER fee_refunds_status BEFORE UPDATE ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION app.check_forward_status('requested>paid', 'requested>rejected');
--> statement-breakpoint

-- An allocation is released (money back to advance) at most once.
CREATE FUNCTION app.check_allocation_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'The allocation is already released' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fee_allocations_release BEFORE UPDATE ON fee_allocations
  FOR EACH ROW EXECUTE FUNCTION app.check_allocation_release();
--> statement-breakpoint

-- What settles a line: approved reductions plus live, unreleased allocations.
CREATE OR REPLACE FUNCTION app.line_taken(t uuid, line uuid, skip_adjustment uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(amount) FROM fee_adjustments
      WHERE tenant_id = t AND line_id = line AND status = 'approved'
        AND (skip_adjustment IS NULL OR id <> skip_adjustment)), 0)
    + coalesce((SELECT sum(a.amount) FROM fee_allocations a
      JOIN fee_payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
      WHERE a.tenant_id = t AND a.line_id = line AND a.released_at IS NULL
        AND p.status IN ('cleared', 'pending')), 0)
$$;
--> statement-breakpoint

-- How much of a receipt is already used: unreleased allocations plus refunds drawn on it.
CREATE FUNCTION app.payment_used(t uuid, payment uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(amount) FROM fee_allocations
      WHERE tenant_id = t AND payment_id = payment AND released_at IS NULL), 0)
    + coalesce((SELECT sum(rp.amount) FROM fee_refund_parts rp
      JOIN fee_refunds r ON r.tenant_id = rp.tenant_id AND r.id = rp.refund_id
      WHERE rp.tenant_id = t AND rp.payment_id = payment AND r.status <> 'rejected'), 0)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.check_allocation_within_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_amount bigint;
  paid bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.line_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.payment_id::text, 0));
  SELECT amount INTO line_amount FROM fee_invoice_lines WHERE tenant_id = NEW.tenant_id AND id = NEW.line_id;
  IF app.line_taken(NEW.tenant_id, NEW.line_id, NULL) + NEW.amount > line_amount THEN
    RAISE EXCEPTION 'Payments exceed the fee line' USING ERRCODE = 'check_violation';
  END IF;
  SELECT amount INTO paid FROM fee_payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
  IF app.payment_used(NEW.tenant_id, NEW.payment_id) + NEW.amount > paid THEN
    RAISE EXCEPTION 'Allocations exceed the receipt' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- A refund never draws more than a receipt has left, or more than was paid on a deposit.
CREATE FUNCTION app.check_refund_part() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid bigint;
  pstatus text;
  refunded bigint;
BEGIN
  IF NEW.payment_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.payment_id::text, 0));
    SELECT amount, status INTO paid, pstatus FROM fee_payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
    IF pstatus <> 'cleared' THEN
      RAISE EXCEPTION 'Only received money can be refunded' USING ERRCODE = 'check_violation';
    END IF;
    IF app.payment_used(NEW.tenant_id, NEW.payment_id) + NEW.amount > paid THEN
      RAISE EXCEPTION 'The refund is more than is held from this receipt' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.line_id::text, 0));
    SELECT coalesce(sum(a.amount), 0) INTO paid FROM fee_allocations a
      JOIN fee_payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
      WHERE a.tenant_id = NEW.tenant_id AND a.line_id = NEW.line_id AND a.released_at IS NULL AND p.status = 'cleared';
    SELECT coalesce(sum(rp.amount), 0) INTO refunded FROM fee_refund_parts rp
      JOIN fee_refunds r ON r.tenant_id = rp.tenant_id AND r.id = rp.refund_id
      WHERE rp.tenant_id = NEW.tenant_id AND rp.line_id = NEW.line_id AND r.status <> 'rejected';
    IF refunded + NEW.amount > paid THEN
      RAISE EXCEPTION 'The refund is more than was paid on this deposit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fee_refund_parts_within BEFORE INSERT ON fee_refund_parts
  FOR EACH ROW EXECUTE FUNCTION app.check_refund_part();
--> statement-breakpoint

-- Payment links are opened without signing in: find the school from the token's hash only.
-- Tables FORCE row security, so this definer may see a request only through this policy,
-- which is limited to the migration (owner) role and to the one hash being looked up.
CREATE POLICY payment_link_lookup ON fee_payment_requests FOR SELECT TO CURRENT_USER
  USING (token_hash = current_setting('app.payment_link_hash', true));
--> statement-breakpoint
CREATE FUNCTION app.payment_request_lookup(p_token_hash text)
RETURNS TABLE (tenant_id uuid, request_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev text := current_setting('app.payment_link_hash', true);
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN RETURN; END IF;
  PERFORM set_config('app.payment_link_hash', p_token_hash, true);
  RETURN QUERY SELECT r.tenant_id, r.id FROM public.fee_payment_requests r
    JOIN public.tenants t ON t.id = r.tenant_id AND t.status = 'active'
   WHERE r.token_hash = p_token_hash;
  PERFORM set_config('app.payment_link_hash', coalesce(v_prev, ''), true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.payment_request_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.payment_request_lookup(text) TO erp_app;
